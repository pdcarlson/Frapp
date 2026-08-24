import { Inject, Injectable } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { SUPABASE_CLIENT } from '../supabase.provider';
import type { FrappSupabaseClient, TablesInsert } from '../database.types';
import type {
  ClaimedDiscordImport,
  DiscordImportProgressPatch,
  IDiscordImportRepository,
} from '../../../domain/repositories/discord-import.repository.interface';
import type {
  DiscordImport,
  DiscordImportChannel,
  DiscordImportFile,
  DiscordImportStatus,
} from '../../../domain/entities/discord-import.entity';
import type {
  ImportedAttachmentRow,
  ImportedMessageRow,
} from '../../../domain/utils/discord-export';

/**
 * PostgREST caps a response at `max_rows` (1000 — `supabase/config.toml`) and
 * signals truncation with a plain 200 and a null error, so an unpaged read
 * drops rows silently. Every batch here stays comfortably below the cap, and
 * with headroom rather than at it: a short page then unambiguously means the
 * rows ran out. Same reasoning as `SupabaseScheduledJobsRepository`.
 */
const MESSAGE_BATCH_SIZE = 200;

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
          'created_by' | 'guild_id' | 'guild_name' | 'storage_prefix'
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
    };
    const { data: created, error } = await this.supabase
      .from('discord_imports')
      .insert(row)
      .select()
      .single();
    if (error) throw error;
    return created;
  }

  async findById(id: string, chapterId: string): Promise<DiscordImport | null> {
    const { data, error } = await this.supabase
      .from('discord_imports')
      .select('*')
      .eq('id', id)
      .eq('chapter_id', chapterId)
      .maybeSingle();
    if (error) throw error;
    return data ?? null;
  }

  async findByChapter(chapterId: string): Promise<DiscordImport[]> {
    const { data, error } = await this.supabase
      .from('discord_imports')
      .select('*')
      .eq('chapter_id', chapterId)
      .order('created_at', { ascending: false });
    if (error) throw error;
    return data ?? [];
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
    if (error) throw error;
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
    if (error) throw error;
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
    if (deleteError) throw deleteError;

    if (rows.length === 0) return [];

    const payload: TablesInsert<'discord_import_channels'>[] = rows.map(
      (row) => ({ ...row, import_id: importId }),
    );
    const { data, error } = await this.supabase
      .from('discord_import_channels')
      .insert(payload)
      .select();
    if (error) throw error;
    return data ?? [];
  }

  async findChannels(
    importId: string,
    chapterId: string,
  ): Promise<DiscordImportChannel[]> {
    const { data, error } = await this.supabase
      .from('discord_import_channels')
      .select('*, discord_imports!inner(chapter_id)')
      .eq('import_id', importId)
      .eq('discord_imports.chapter_id', chapterId)
      .order('discord_channel_name', { ascending: true });
    if (error) throw error;
    return (data ?? []).map(stripImportEmbed);
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
    if (error) throw error;
  }

  // ── uploaded files ────────────────────────────────────────────────────────

  async createFiles(
    rows: Omit<DiscordImportFile, 'id' | 'created_at' | 'uploaded_at'>[],
  ): Promise<DiscordImportFile[]> {
    if (rows.length === 0) return [];
    // Upsert on the manifest's natural key so re-requesting an upload URL for a
    // file the admin already registered is a no-op rather than a 23505. That is
    // the normal path when an interrupted upload is resumed.
    const { data, error } = await this.supabase
      .from('discord_import_files')
      .upsert(rows as TablesInsert<'discord_import_files'>[], {
        onConflict: 'import_id,relative_path',
      })
      .select();
    if (error) throw error;
    return data ?? [];
  }

  async findFiles(
    importId: string,
    chapterId: string,
  ): Promise<DiscordImportFile[]> {
    const { data, error } = await this.supabase
      .from('discord_import_files')
      .select('*')
      .eq('import_id', importId)
      .eq('chapter_id', chapterId)
      .order('part_index', { ascending: true });
    if (error) throw error;
    return data ?? [];
  }

  async markFilesUploaded(
    importId: string,
    chapterId: string,
    storagePaths: string[],
    at: string,
  ): Promise<number> {
    if (storagePaths.length === 0) return 0;
    const { data, error } = await this.supabase
      .from('discord_import_files')
      .update({ uploaded_at: at })
      .eq('import_id', importId)
      .eq('chapter_id', chapterId)
      .in('storage_path', storagePaths)
      .select('id');
    if (error) throw error;
    return (data ?? []).length;
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
    if (error) throw error;

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
      if (claimError) throw claimError;
      if (claimed) return { job: claimed, lockToken };
    }
    return null;
  }

  async renewLease(
    id: string,
    lockToken: string,
    now: Date,
    leaseMs: number,
  ): Promise<boolean> {
    const { data, error } = await this.supabase
      .from('discord_imports')
      .update({
        lease_expires_at: new Date(now.getTime() + leaseMs).toISOString(),
        updated_at: now.toISOString(),
      })
      .eq('id', id)
      .eq('lock_token', lockToken)
      .select('id');
    if (error) throw error;
    return (data ?? []).length > 0;
  }

  async releaseLease(id: string, lockToken: string): Promise<void> {
    const { error } = await this.supabase
      .from('discord_imports')
      .update({ lock_token: null, locked_by: null, lease_expires_at: null })
      .eq('id', id)
      .eq('lock_token', lockToken);
    if (error) throw error;
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
      if (error) throw error;
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
      .insert(deduped as unknown as TablesInsert<'chat_messages'>[])
      .select('id, external_message_id');
    if (error) throw error;
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
      if (error) throw error;
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
      .upsert(rows as unknown as TablesInsert<'chat_message_attachments'>[], {
        onConflict: 'message_id,bucket,storage_path',
        ignoreDuplicates: true,
      })
      .select('id');
    if (error) throw error;
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
    if (selectError) throw selectError;

    const ids = (candidates ?? []).map((row) => row.id);
    if (ids.length === 0) return 0;

    const { error: deleteError } = await this.supabase
      .from('chat_messages')
      .delete()
      .in('id', ids);
    if (deleteError) throw deleteError;
    return ids.length;
  }
}

/** Drops the `discord_imports` embed that carried the tenant filter. */
function stripImportEmbed(row: DiscordImportChannel): DiscordImportChannel {
  const rest = { ...row } as DiscordImportChannel & {
    discord_imports?: unknown;
  };
  delete rest.discord_imports;
  return rest;
}
