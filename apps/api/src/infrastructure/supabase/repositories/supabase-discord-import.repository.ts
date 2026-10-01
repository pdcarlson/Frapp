import { Inject, Injectable } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { SUPABASE_CLIENT } from '../supabase.provider';
import { fetchAllPages } from '../supabase.utils';
import type { FrappSupabaseClient, TablesInsert } from '../database.types';
import type {
  ArchiveQuotaScope,
  ClaimedDiscordImport,
  DiscordImportProgressPatch,
  IDiscordImportRepository,
} from '#domain/repositories/discord-import.repository.interface';
import { ArchiveQuotaExceededError } from '#domain/repositories/discord-import.repository.interface';
import type {
  DiscordImport,
  DiscordImportChannel,
  DiscordImportChannelProgress,
  DiscordImportChannelProgressRow,
  DiscordImportChannelStatus,
  DiscordImportFile,
  DiscordImportStatus,
} from '#domain/entities/discord-import.entity';
import { DISCORD_IMPORT_PROGRESS_LIMITS } from '#domain/entities/discord-import.entity';
import type {
  ImportedAttachmentRow,
  ImportedMessageRow,
} from '#domain/utils/discord-export';
import { chunkByEncodedLength, chunkIds } from '#domain/utils/chunk-ids';
import { SupabaseQueryError } from '../supabase-query-error';

/**
 * PostgREST caps a response at `max_rows` (1000 — `supabase/config.toml`) and
 * signals truncation with a plain 200 and a null error, so an unpaged read
 * drops rows silently. Paged reads here go through the shared `fetchAllPages`
 * (`infrastructure/supabase/supabase.utils.ts`), which stops only on an *empty*
 * page and advances by the rows actually returned.
 *
 * For the *paged* reads the batch sizes below are therefore throughput choices
 * rather than correctness ones. An earlier version of this note argued they had
 * to keep headroom below the cap because "a short page then unambiguously means
 * the rows ran out" — that rule was the bug (#1628), not the safeguard, and it
 * also named a class (`SupabaseScheduledJobsRepository`) that does not exist.
 *
 * `MESSAGE_BATCH_SIZE` is the narrower case and still carries a real
 * assumption: besides chunking inserts it bounds the `.in()` slice in
 * `findExistingExternalIds`, which is *not* paged, so its result is silently
 * truncated if `max_rows` ever drops below it. Tracked separately (#1722).
 */
const MESSAGE_BATCH_SIZE = 200;

/** Manifest rows read per round trip. See the note above. */
const FILE_PAGE_SIZE = 500;

/**
 * Channel-mapping rows read per round trip. A bot import holds a row per
 * thread as well as per channel, so a chapter's first real server already had
 * 945 of them, within sight of the cap; see the note above.
 */
const CHANNEL_PAGE_SIZE = 500;

/**
 * The message `discord_import_register_files` raises on a ceiling, parsed back
 * into the domain error.
 *
 * The numbers travel in the message because PostgREST surfaces a raised
 * exception as `{ code, message, details, hint }` and gives no structured
 * channel for them. Matching is anchored on a literal prefix the function owns,
 * so an unrelated `check_violation` from a table constraint cannot be mistaken
 * for a quota refusal and reported to an admin as one.
 */
const ARCHIVE_QUOTA_MESSAGE =
  /^discord_import_archive_quota: (import|chapter) \S+ would hold (\d+) bytes, past its (\d+) byte ceiling/;

function parseArchiveQuotaError(error: {
  message?: string | null;
}): ArchiveQuotaExceededError | null {
  const match = ARCHIVE_QUOTA_MESSAGE.exec(error?.message ?? '');
  if (!match) return null;
  const [, scope, wouldHold, cap] = match;
  return new ArchiveQuotaExceededError(
    scope as ArchiveQuotaScope,
    Number(wouldHold),
    Number(cap),
  );
}

@Injectable()
export class SupabaseDiscordImportRepository implements IDiscordImportRepository {
  constructor(
    @Inject(SUPABASE_CLIENT)
    private readonly supabase: FrappSupabaseClient,
  ) {}

  async create(
    data: Pick<DiscordImport, 'chapter_id' | 'consent_acknowledged_at'> &
      Partial<
        Pick<
          DiscordImport,
          'created_by' | 'guild_id' | 'guild_name' | 'storage_prefix' | 'source'
        >
      >,
  ): Promise<DiscordImport> {
    const row: TablesInsert<'discord_imports'> = {
      chapter_id: data.chapter_id,
      consent_acknowledged_at: data.consent_acknowledged_at,
      created_by: data.created_by ?? null,
      guild_id: data.guild_id ?? null,
      guild_name: data.guild_name ?? null,
      storage_prefix: data.storage_prefix ?? null,
      // Omitted rather than defaulted in TypeScript: the column's own DEFAULT
      // is 'upload', so a caller that says nothing gets the phase-2 behaviour
      // from the database rather than from a constant here that could drift
      // from it.
      ...(data.source ? { source: data.source } : {}),
    };
    const { data: created, error } = await this.supabase
      .from('discord_imports')
      .insert(row)
      .select()
      .single();
    if (error) throw new SupabaseQueryError(error);
    return created;
  }

  async findById(id: string, chapterId: string): Promise<DiscordImport | null> {
    const { data, error } = await this.supabase
      .from('discord_imports')
      .select('*')
      .eq('id', id)
      .eq('chapter_id', chapterId)
      .maybeSingle();
    if (error) throw new SupabaseQueryError(error);
    return data ?? null;
  }

  async findByChapter(chapterId: string): Promise<DiscordImport[]> {
    const { data, error } = await this.supabase
      .from('discord_imports')
      .select('*')
      .eq('chapter_id', chapterId)
      .is('cleared_at', null)
      .order('created_at', { ascending: false });
    if (error) throw new SupabaseQueryError(error);
    return data ?? [];
  }

  async markCleared(
    id: string,
    chapterId: string,
    clearable: DiscordImportStatus[],
    at: string,
  ): Promise<DiscordImport | null> {
    const { data, error } = await this.supabase
      .from('discord_imports')
      .update({ cleared_at: at, updated_at: at })
      .eq('id', id)
      .eq('chapter_id', chapterId)
      .in('status', clearable)
      .select()
      .maybeSingle();
    if (error) throw new SupabaseQueryError(error);
    return data ?? null;
  }

  async update(
    id: string,
    chapterId: string,
    patch: DiscordImportProgressPatch &
      Partial<Pick<DiscordImport, 'role_mapping' | 'storage_prefix'>>,
  ): Promise<DiscordImport> {
    const { data, error } = await this.supabase
      .from('discord_imports')
      .update({ ...patch, updated_at: new Date().toISOString() })
      .eq('id', id)
      .eq('chapter_id', chapterId)
      .select()
      .single();
    if (error) throw new SupabaseQueryError(error);
    return data;
  }

  async updateIfStatus(
    id: string,
    chapterId: string,
    expectedStatuses: DiscordImportStatus[],
    patch: DiscordImportProgressPatch,
  ): Promise<DiscordImport | null> {
    const { data, error } = await this.supabase
      .from('discord_imports')
      .update({ ...patch, updated_at: new Date().toISOString() })
      .eq('id', id)
      .eq('chapter_id', chapterId)
      .in('status', expectedStatuses)
      .select()
      .maybeSingle();
    if (error) throw new SupabaseQueryError(error);
    return data ?? null;
  }

  // ── channels ──────────────────────────────────────────────────────────────

  async replaceChannels(
    importId: string,
    chapterId: string,
    rows: Omit<DiscordImportChannel, 'id' | 'import_id'>[],
  ): Promise<DiscordImportChannel[]> {
    // Scoped through the import, which carries the chapter — the channel rows
    // have no chapter of their own, and re-resolving one here would be a
    // read-then-check rather than a scoped write.
    const owned = await this.findById(importId, chapterId);
    if (!owned) return [];

    const { error: deleteError } = await this.supabase
      .from('discord_import_channels')
      .delete()
      .eq('import_id', importId);
    if (deleteError) throw new SupabaseQueryError(deleteError);

    if (rows.length === 0) return [];

    const payload: TablesInsert<'discord_import_channels'>[] = rows.map(
      (row) => ({ ...row, import_id: importId }),
    );
    // One insert, so the set lands whole or not at all: a partial set would
    // pass every "has the server been scanned" check and silently drop the
    // rest. Read back through the paged read, never from `.insert().select()`,
    // whose answer is capped like any other response and would hand discovery
    // a shortened channel list.
    const { error } = await this.supabase
      .from('discord_import_channels')
      .insert(payload);
    if (error) throw new SupabaseQueryError(error);
    return this.findChannels(importId, chapterId);
  }

  async findChannels(
    importId: string,
    chapterId: string,
  ): Promise<DiscordImportChannel[]> {
    // Paged, because a bot import holds a row per thread: past the cap an
    // unpaged read would drop the tail, the worker would never import those
    // channels, and a re-map (which replaces the set from this read) would
    // delete them.
    const rows = await fetchAllPages(
      (from, to) =>
        this.supabase
          .from('discord_import_channels')
          .select('*, discord_imports!inner(chapter_id)')
          .eq('import_id', importId)
          .eq('discord_imports.chapter_id', chapterId)
          // `position` then name. Upload-path rows all sit at the default 0, so
          // they keep their original name ordering; bot-path rows carry a
          // position pinned at discovery, which is what keeps a thread listed
          // under its parent and keeps a resumed import walking the same
          // sequence. `id` breaks the remaining ties so `.range()` pages over a
          // stable order.
          .order('position', { ascending: true })
          .order('discord_channel_name', { ascending: true })
          .order('id', { ascending: true })
          .range(from, to),
      { pageSize: CHANNEL_PAGE_SIZE },
    );
    return rows.map(stripImportEmbed);
  }

  async countChannels(
    importId: string,
    chapterId: string,
  ): Promise<{ total: number; done: number }> {
    // Counted, not listed: a progress poll every few seconds should not pull
    // every mapping row to add them up.
    const base = () =>
      this.supabase
        .from('discord_import_channels')
        .select('id, discord_imports!inner(chapter_id)', {
          count: 'exact',
          head: true,
        })
        .eq('import_id', importId)
        .eq('discord_imports.chapter_id', chapterId)
        .neq('mapping_action', 'skip');
    // A row the worker skipped (its channel was deleted, or hidden from the
    // bot, by the time it got there) is finished too, or the count would stop
    // short of the total for good.
    const [total, done] = await Promise.all([
      base(),
      base().in('status', ['completed', 'skipped']),
    ]);
    if (total.error) throw new SupabaseQueryError(total.error);
    if (done.error) throw new SupabaseQueryError(done.error);
    return { total: total.count ?? 0, done: done.count ?? 0 };
  }

  async findChannelProgress(
    importId: string,
    chapterId: string,
  ): Promise<DiscordImportChannelProgress> {
    // Counted and capped, never listed: the Watch view polls this every few
    // seconds, and a server can hold over a thousand channels and threads.
    // Scoped through the import embed, like every read of this table.
    const count = (status: DiscordImportChannelStatus) =>
      this.supabase
        .from('discord_import_channels')
        .select('id, discord_imports!inner(chapter_id)', {
          count: 'exact',
          head: true,
        })
        .eq('import_id', importId)
        .eq('discord_imports.chapter_id', chapterId)
        .neq('mapping_action', 'skip')
        .eq('status', status);
    const rows = (status: DiscordImportChannelStatus) =>
      this.supabase
        .from('discord_import_channels')
        .select(
          'discord_channel_id, discord_channel_name, discord_category, parent_discord_channel_id, status, imported_count, error, target_channel_id, discord_imports!inner(chapter_id)',
        )
        .eq('import_id', importId)
        .eq('discord_imports.chapter_id', chapterId)
        .neq('mapping_action', 'skip')
        .eq('status', status);

    const [counts, running, recent, failed] = await Promise.all([
      Promise.all(PROGRESS_STATUSES.map(count)),
      rows('running')
        .order('position', { ascending: true })
        .order('id', { ascending: true })
        .limit(DISCORD_IMPORT_PROGRESS_LIMITS.running),
      // The worker walks rows in `position` order, so the highest finished
      // position is the one finished last.
      rows('completed')
        .order('position', { ascending: false })
        .order('id', { ascending: false })
        .limit(DISCORD_IMPORT_PROGRESS_LIMITS.recent),
      rows('failed')
        .order('position', { ascending: true })
        .order('id', { ascending: true })
        .limit(DISCORD_IMPORT_PROGRESS_LIMITS.failed),
    ]);
    for (const result of [...counts, running, recent, failed]) {
      if (result.error) throw new SupabaseQueryError(result.error);
    }
    const named = (
      data: DiscordImportChannelProgressRow[] | null,
    ): DiscordImportChannelProgressRow[] =>
      (data ?? []).map((row) => ({
        discord_channel_id: row.discord_channel_id,
        discord_channel_name: row.discord_channel_name,
        discord_category: row.discord_category,
        parent_discord_channel_id: row.parent_discord_channel_id,
        status: row.status,
        imported_count: row.imported_count,
        error: row.error,
        target_channel_id: row.target_channel_id,
      }));
    return {
      counts: Object.fromEntries(
        PROGRESS_STATUSES.map((status, index) => [
          status,
          counts[index]?.count ?? 0,
        ]),
      ) as Record<DiscordImportChannelStatus, number>,
      running: named(running.data),
      recent: named(recent.data),
      failed: named(failed.data),
    };
  }

  async updateChannel(
    id: string,
    importId: string,
    patch: Partial<DiscordImportChannel>,
  ): Promise<void> {
    const { error } = await this.supabase
      .from('discord_import_channels')
      .update(patch)
      .eq('id', id)
      .eq('import_id', importId);
    if (error) throw new SupabaseQueryError(error);
  }

  // ── uploaded files ────────────────────────────────────────────────────────

  async registerFiles(
    chapterId: string,
    importId: string,
    rows: Omit<DiscordImportFile, 'id' | 'created_at' | 'uploaded_at'>[],
    caps: { importBytes: number; chapterBytes: number },
  ): Promise<DiscordImportFile[]> {
    if (rows.length === 0) return [];

    // One RPC rather than an upsert here, because the quota check and the write
    // have to share a transaction — see the migration for the concurrent-mint
    // and ledger-rewrite failures that shape forecloses. The upsert on the
    // manifest's natural key still happens, inside the function, so
    // re-requesting a URL for an already-registered file remains the ordinary
    // resume path rather than a 23505.
    const { data, error } = await this.supabase.rpc(
      'discord_import_register_files',
      {
        p_chapter_id: chapterId,
        p_import_id: importId,
        p_rows: rows.map((row) => ({
          relative_path: row.relative_path,
          kind: row.kind,
          part_index: row.part_index,
          bucket: row.bucket,
          storage_path: row.storage_path,
          content_type: row.content_type,
          byte_size: row.byte_size,
        })),
        p_import_cap: caps.importBytes,
        p_chapter_cap: caps.chapterBytes,
      },
    );

    if (error) {
      const quota = parseArchiveQuotaError(error);
      if (quota) throw quota;
      throw new SupabaseQueryError(error);
    }

    // An empty result for a non-empty batch means the function returned no
    // rows, which it cannot do on success — never read that as "registered
    // nothing and that's fine", because the caller would then mint URLs for
    // files with no manifest row and the worker would skip every one of them.
    const created = data ?? [];
    if (created.length === 0) {
      throw new Error(
        'discord_import_register_files returned no rows for a non-empty batch.',
      );
    }
    return created;
  }

  async findFiles(
    importId: string,
    chapterId: string,
  ): Promise<DiscordImportFile[]> {
    // PAGED, and this is a correctness fix rather than a scale nicety.
    //
    // The note at the top of this file states the invariant: PostgREST caps a
    // response at `max_rows` (1000) and signals truncation with a plain 200 and
    // a null error. This read was the one that broke it — and the manifest is
    // exactly the table that grows past 1000, because it holds a row per
    // attachment.
    //
    // What truncation costs is not the same on the two import paths. On the
    // BOT path a missing row is re-fetched from Discord, so the cost is
    // bandwidth. On the UPLOAD path the worker never re-creates media rows —
    // the admin's browser registered them — so a dropped row means
    // `resolveAsset` returns null, the attachment is silently absent, and the
    // message lands with an under-counted `attachment_count` on an import the
    // admin was told succeeded. That is the failure this paging removes.
    return fetchAllPages<DiscordImportFile>(
      (from, to) =>
        this.supabase
          .from('discord_import_files')
          .select('*')
          .eq('import_id', importId)
          .eq('chapter_id', chapterId)
          .order('part_index', { ascending: true })
          // The `id` tiebreaker is load-bearing, not cosmetic. `part_index` is
          // null on every media row, so ordering by it alone leaves one
          // enormous tie — and `.range()` over an unstable order can serve a
          // row on two pages or on none, which is the very failure this paging
          // exists to fix.
          .order('id', { ascending: true })
          .range(from, to),
      { pageSize: FILE_PAGE_SIZE },
    );
  }

  async markFilesUploaded(
    importId: string,
    chapterId: string,
    storagePaths: string[],
    at: string,
  ): Promise<number> {
    // Batched by encoded length: the paths end in Discord filenames, and one
    // slice's worth in a single `in` list outgrew the request line (#2825).
    let marked = 0;
    for (const batch of chunkByEncodedLength(storagePaths)) {
      const { data, error } = await this.supabase
        .from('discord_import_files')
        .update({ uploaded_at: at })
        .eq('import_id', importId)
        .eq('chapter_id', chapterId)
        .in('storage_path', batch)
        .select('id');
      if (error) throw new SupabaseQueryError(error);
      marked += (data ?? []).length;
    }
    return marked;
  }

  // ── the worker's lease ────────────────────────────────────────────────────

  async claimNextRunnable(
    now: Date,
    leaseMs: number,
    workerId: string,
  ): Promise<ClaimedDiscordImport | null> {
    const { data: candidates, error } = await this.supabase
      .from('discord_imports')
      .select('*')
      .in('status', ['ready', 'running', 'purging'])
      .order('created_at', { ascending: true })
      .limit(5);
    if (error) throw new SupabaseQueryError(error);

    const nowIso = now.toISOString();
    for (const candidate of candidates ?? []) {
      const leaseHeld =
        candidate.lock_token !== null &&
        candidate.lease_expires_at !== null &&
        candidate.lease_expires_at > nowIso;
      if (leaseHeld) continue;

      const lockToken = randomUUID();
      // Compare-and-swap: the claim is what decides, not the read above. A
      // worker whose lease expired while it was still running writes with its
      // old token, matches zero rows, and learns it lost — which a
      // `claimed_at < now() - interval` check could not tell it.
      const claim = this.supabase
        .from('discord_imports')
        .update({
          lock_token: lockToken,
          locked_by: workerId,
          lease_expires_at: new Date(now.getTime() + leaseMs).toISOString(),
          attempt_count: candidate.attempt_count + 1,
          updated_at: nowIso,
        })
        .eq('id', candidate.id);

      const { data: claimed, error: claimError } = await (
        candidate.lock_token === null
          ? claim.is('lock_token', null)
          : claim.eq('lock_token', candidate.lock_token)
      )
        .select()
        .maybeSingle();
      if (claimError) throw new SupabaseQueryError(claimError);
      if (claimed) return { job: claimed, lockToken };
    }
    return null;
  }

  async renewLease(
    id: string,
    lockToken: string,
    now: Date,
    leaseMs: number,
    progress?: Pick<DiscordImport, 'purged_messages'>,
  ): Promise<boolean> {
    const { data, error } = await this.supabase
      .from('discord_imports')
      .update({
        ...progress,
        lease_expires_at: new Date(now.getTime() + leaseMs).toISOString(),
        updated_at: now.toISOString(),
      })
      .eq('id', id)
      .eq('lock_token', lockToken)
      .select('id');
    if (error) throw new SupabaseQueryError(error);
    return (data ?? []).length > 0;
  }

  async releaseLease(id: string, lockToken: string): Promise<void> {
    const { error } = await this.supabase
      .from('discord_imports')
      .update({ lock_token: null, locked_by: null, lease_expires_at: null })
      .eq('id', id)
      .eq('lock_token', lockToken);
    if (error) throw new SupabaseQueryError(error);
  }

  // ── the import write path ─────────────────────────────────────────────────

  async findExistingExternalIds(
    channelId: string,
    externalMessageIds: string[],
  ): Promise<Map<string, string>> {
    const found = new Map<string, string>();
    for (let i = 0; i < externalMessageIds.length; i += MESSAGE_BATCH_SIZE) {
      const slice = externalMessageIds.slice(i, i + MESSAGE_BATCH_SIZE);
      if (slice.length === 0) continue;
      const { data, error } = await this.supabase
        .from('chat_messages')
        .select('id, external_message_id')
        .eq('channel_id', channelId)
        .in('external_message_id', slice);
      if (error) throw new SupabaseQueryError(error);
      for (const row of data ?? []) {
        if (row.external_message_id) found.set(row.external_message_id, row.id);
      }
    }
    return found;
  }

  async insertMessages(
    rows: ImportedMessageRow[],
  ): Promise<Map<string, string>> {
    const inserted = new Map<string, string>();
    if (rows.length === 0) return inserted;

    // Collapse duplicates WITHIN the batch before inserting.
    //
    // The caller's pre-insert existence read can only see rows already
    // committed, so two copies of one snowflake inside the same batch both look
    // new. A single `.insert()` of both trips `idx_chat_messages_external_dedupe`
    // with a 23505 that fails the whole batch — and since the cursor has not
    // advanced, the next tick replays the same batch and fails identically. The
    // import wedges permanently on a raw Postgres error.
    //
    // This is not hypothetical for a real export: DCE's own `--after`/`--before`
    // resume workflow produces partitions that overlap at the boundary, and a
    // folder holding two export runs has them wholesale.
    //
    // Deduping here rather than upserting because PostgREST cannot use a PARTIAL
    // unique index as an ON CONFLICT arbiter — `ignoreDuplicates` still answers
    // 409, and naming the arbiter answers 42P10. Verified against the local
    // stack; see `findExistingExternalIds`.
    const seen = new Set<string>();
    const deduped = rows.filter((row) => {
      if (seen.has(row.external_message_id)) return false;
      seen.add(row.external_message_id);
      return true;
    });

    const { data, error } = await this.supabase
      .from('chat_messages')
      .insert(deduped)
      .select('id, external_message_id');
    if (error) throw new SupabaseQueryError(error);
    for (const row of data ?? []) {
      if (row.external_message_id)
        inserted.set(row.external_message_id, row.id);
    }
    return inserted;
  }

  async setReplyTargets(
    pairs: { id: string; reply_to_id: string }[],
  ): Promise<number> {
    if (pairs.length === 0) return 0;
    // One statement per pair: each row gets a different value, which PostgREST
    // cannot express in a single UPDATE. Bounded by the batch size, and only
    // reached for messages that actually reply to something in the same batch.
    let updated = 0;
    for (const pair of pairs) {
      const { data, error } = await this.supabase
        .from('chat_messages')
        .update({ reply_to_id: pair.reply_to_id })
        .eq('id', pair.id)
        .eq('kind', 'imported')
        .select('id');
      if (error) throw new SupabaseQueryError(error);
      // Affected rows, not attempts. The `kind` filter can exclude a row (a
      // moderator hard-deleted the target between the insert and this pass), and
      // a count that says otherwise would make a future caller's retry logic
      // silently wrong.
      updated += (data ?? []).length;
    }
    return updated;
  }

  async insertAttachments(
    rows: (ImportedAttachmentRow & {
      message_id: string;
      channel_id: string;
    })[],
  ): Promise<number> {
    if (rows.length === 0) return 0;
    const { data, error } = await this.supabase
      .from('chat_message_attachments')
      .upsert(rows, {
        onConflict: 'message_id,bucket,storage_path',
        ignoreDuplicates: true,
      })
      .select('id');
    if (error) throw new SupabaseQueryError(error);
    return (data ?? []).length;
  }

  // ── purge ─────────────────────────────────────────────────────────────────

  async deleteImportedMessages(
    importId: string,
    chapterId: string,
    limit: number,
  ): Promise<number> {
    // Two-step rather than one delete with a join: PostgREST cannot express
    // "delete from A where A's parent B has chapter_id = X". Selecting the ids
    // through the tenant-bound embed first, then deleting by id, keeps the
    // tenant predicate in the same statement as the lookup — the rule this
    // repo's multi-tenancy invariant states — and bounds the delete.
    const { data: candidates, error: selectError } = await this.supabase
      .from('chat_messages')
      .select('id, chat_channels!inner(chapter_id)')
      .eq('kind', 'imported')
      .eq('metadata->>discord_import_id', importId)
      .eq('chat_channels.chapter_id', chapterId)
      .limit(limit);
    if (selectError) throw new SupabaseQueryError(selectError);

    const ids = (candidates ?? []).map((row) => row.id);
    // A purge round reads up to 500 ids: ~19 KB in one `in` list. Hosted
    // staging accepted that (a 46k-message purge, 2026-09-28) but refused a
    // 30 KB list (#2825), and the local gateway refuses 250 ids (`chunkIds`),
    // so the margin is thin; batched like the other long id lists.
    for (const batch of chunkIds(ids)) {
      const { error: deleteError } = await this.supabase
        .from('chat_messages')
        .delete()
        .in('id', batch);
      if (deleteError) throw new SupabaseQueryError(deleteError);
    }
    return ids.length;
  }

  async recordCreatedChannel(
    importId: string,
    channelId: string,
  ): Promise<void> {
    // Idempotent: a slice that dies after this insert and before the mapping
    // row learns its target mints a second channel on the retry, and each gets
    // its own row; recording the same pair twice is a no-op.
    const { error } = await this.supabase
      .from('discord_import_created_channels')
      .upsert(
        { import_id: importId, channel_id: channelId },
        { onConflict: 'import_id,channel_id', ignoreDuplicates: true },
      );
    if (error) throw new SupabaseQueryError(error);
  }

  async deleteEmptyCreatedChannels(
    importId: string,
    chapterId: string,
  ): Promise<string[]> {
    // One function call, so each channel's emptiness check and its delete run
    // under the row lock that keeps a send from landing in between
    // (`20260930030000_discord_import_purge_channels.sql`).
    const { data, error } = await this.supabase.rpc(
      'delete_empty_discord_import_channels',
      { p_import_id: importId, p_chapter_id: chapterId },
    );
    if (error) throw new SupabaseQueryError(error);
    return data ?? [];
  }
}

/** Every channel status, in the order the Watch panel counts them (#2857). */
const PROGRESS_STATUSES: readonly DiscordImportChannelStatus[] = [
  'pending',
  'running',
  'completed',
  'failed',
  'skipped',
];

/** Drops the `discord_imports` embed that carried the tenant filter. */
function stripImportEmbed(row: DiscordImportChannel): DiscordImportChannel {
  const rest = { ...row } as DiscordImportChannel & {
    discord_imports?: unknown;
  };
  delete rest.discord_imports;
  return rest;
}
