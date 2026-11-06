/**
 * Names the people in a bot import the way the Discord server showed them.
 *
 * Bot imports written before 2026-11-06 named every author and mentioned user
 * by their Discord account ("Pinstripe") rather than the server nickname
 * everyone saw ("Moiz Steenhuis"), stored no avatars, wrote `@Tristan Hatton`
 * with a space a chat client chips only up to, and wrote a role mention as the
 * Frapp role it was mapped to (`@Member` for `@Brothers`). The importer now
 * reads each member; this applies the same answer to the rows such an import
 * already wrote:
 *
 * - `author_name` ← the member's server nickname, else their account name;
 * - `author_avatar_path` ← their server avatar, else their account's, copied
 *   into the import's archive like the importer does (rows that have none);
 * - `content` ← each mention the old importer wrote, rewritten to what it
 *   writes now (`planPeopleRemap` says which mentions it can and cannot reach).
 *
 * Bot imports only: an upload's names come from DiscordChatExporter, which
 * already recorded nicknames. Runs only on an import that has stopped, since a
 * running one may be writing rows beside it. Re-runnable: a second run finds
 * nothing left to change. `--dry-run` writes nothing and may run at any time.
 *
 * Env: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY (bypasses RLS; never logged),
 * DISCORD_BOT_TOKEN.
 *
 * Usage, from apps/api:
 *   node --conditions=source -r ts-node/register \
 *     src/backfill-discord-import-people.ts \
 *     --chapter <chapter id> --import <import id> [--dry-run]
 */
import { createClient } from '@supabase/supabase-js';
import type { ConfigService } from '@nestjs/config';
import type { Database } from './infrastructure/supabase/database.types';
import { SupabaseDiscordImportRepository } from './infrastructure/supabase/repositories/supabase-discord-import.repository';
import { SupabaseDiscordConnectionRepository } from './infrastructure/supabase/repositories/supabase-discord-connection.repository';
import { SupabaseRoleRepository } from './infrastructure/supabase/repositories/supabase-role.repository';
import { DiscordBotGatewayService } from './infrastructure/discord/discord-bot-gateway.service';
import { SupabaseArchiveMediaCopier } from './infrastructure/storage/supabase-archive-media-copier.service';
import type { DiscordGuildMemberProfile } from '#domain/adapters/discord.interface';
import { discordAvatarAsset } from '#domain/utils/discord-api-message';
import {
  mentionRewriter,
  planPeopleRemap,
  type RecordedAuthor,
} from '#domain/utils/discord-people-backfill';
import { parseRoleMapping } from '#domain/utils/discord-role-gates';
import { asRecord, asString } from '#domain/utils/json-guards';
import {
  CHAT_ARCHIVE_BUCKET,
  archiveMediaObjectPath,
} from '#domain/constants/storage';
import {
  MAX_ARCHIVE_CHAPTER_BYTES,
  MAX_ARCHIVE_IMPORT_BYTES,
} from '#domain/constants/discord-archive-limits';
import { SupabaseQueryError } from './infrastructure/supabase/supabase-query-error';
import { toReportableError } from './infrastructure/observability/reportable-error';

/** Rows read per round trip. */
const PAGE_SIZE = 1000;

/** Writes or Discord reads in flight at once. */
const IN_FLIGHT = 5;

function argValue(name: string): string | null {
  const at = process.argv.indexOf(name);
  return at === -1 ? null : (process.argv[at + 1] ?? null);
}

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Missing required environment variable ${name}`);
  return value;
}

async function inBatches<T>(
  items: readonly T[],
  run: (item: T) => Promise<void>,
): Promise<void> {
  for (let at = 0; at < items.length; at += IN_FLIGHT) {
    await Promise.all(items.slice(at, at + IN_FLIGHT).map(run));
  }
}

async function main(): Promise<void> {
  const chapterId = argValue('--chapter');
  const importId = argValue('--import');
  const dryRun = process.argv.includes('--dry-run');
  if (!chapterId || !importId) {
    throw new Error(
      'Usage: backfill-discord-import-people --chapter <id> --import <id> [--dry-run]',
    );
  }

  const supabase = createClient<Database>(
    requireEnv('SUPABASE_URL'),
    requireEnv('SUPABASE_SERVICE_ROLE_KEY'),
    { auth: { persistSession: false, autoRefreshToken: false } },
  );
  const imports = new SupabaseDiscordImportRepository(supabase);
  const bot = new DiscordBotGatewayService({
    get: (key: string) => process.env[key],
  } as unknown as ConfigService);
  if (!bot.isConfigured()) throw new Error('DISCORD_BOT_TOKEN is not set.');

  // Chapter-scoped, so a mistyped import id from another chapter finds nothing.
  const job = await imports.findById(importId, chapterId);
  if (!job) throw new Error(`No import ${importId} in chapter ${chapterId}.`);
  if (job.source !== 'bot') {
    throw new Error(
      `Import ${importId} is an upload; its names came from the export.`,
    );
  }
  // A dry run writes nothing, so it may preview an import still running.
  if (!dryRun && !['completed', 'failed', 'cancelled'].includes(job.status)) {
    throw new Error(
      `Import ${importId} is ${job.status}. Run this once it has completed, failed or been cancelled.`,
    );
  }
  // The guild is read from the chapter's connection, as the importer does,
  // and must be the one the import was made from.
  const connection = await new SupabaseDiscordConnectionRepository(
    supabase,
  ).findByChapter(chapterId);
  const guildId = connection?.guild_id ?? null;
  if (!guildId || (job.guild_id && job.guild_id !== guildId)) {
    throw new Error(
      `Chapter ${chapterId} is no longer connected to the Discord server import ${importId} came from.`,
    );
  }

  // ── who wrote in this import, as their own rows recorded them ────────────
  const recorded = new Map<string, string>();
  let after: string | null = null;
  for (;;) {
    let query = supabase
      .from('chat_messages')
      .select('id, author_external_id, payload')
      .eq('kind', 'imported')
      .eq('metadata->>discord_import_id', importId)
      .not('author_external_id', 'is', null)
      .order('id', { ascending: true })
      .limit(PAGE_SIZE);
    if (after) query = query.gt('id', after);
    const { data: rows, error } = await query;
    if (error) throw new SupabaseQueryError(error);
    if (!rows || rows.length === 0) break;
    after = rows[rows.length - 1].id;
    for (const row of rows) {
      const id = row.author_external_id;
      const name = asString(asRecord(row.payload)?.author_username);
      if (id && name && !recorded.has(id)) recorded.set(id, name);
    }
  }
  const authors: RecordedAuthor[] = [...recorded].map(
    ([discordUserId, recordedName]) => ({ discordUserId, recordedName }),
  );

  // ── each author as a member of the server ────────────────────────────────
  const profiles = new Map<string, DiscordGuildMemberProfile | null>();
  let unreadable = 0;
  await inBatches(authors, async ({ discordUserId }) => {
    try {
      profiles.set(
        discordUserId,
        await bot.fetchGuildMember(guildId, discordUserId),
      );
    } catch {
      unreadable += 1;
    }
  });

  const frappRoles = await new SupabaseRoleRepository(supabase).findByChapter(
    chapterId,
  );
  const plan = planPeopleRemap({
    authors,
    profiles,
    roleMapping: parseRoleMapping(job.role_mapping),
    frappRoleNames: new Map(frappRoles.map((role) => [role.id, role.name])),
  });

  console.log(
    `${authors.length} authors: ${profiles.size - [...profiles.values()].filter((p) => p === null).length} in the server, ` +
      `${[...profiles.values()].filter((p) => p === null).length} gone, ${unreadable} unreadable.`,
  );
  for (const [id, name] of plan.authorNames) {
    console.log(`  author ${recorded.get(id)} → ${name}`);
  }
  for (const [from, to] of plan.mentions) {
    console.log(`  mention ${from} → ${to}`);
  }

  // ── author names ──────────────────────────────────────────────────────────
  if (!dryRun) {
    await inBatches([...plan.authorNames], async ([id, name]) => {
      const { error } = await supabase
        .from('chat_messages')
        .update({ author_name: name })
        .eq('kind', 'imported')
        .eq('metadata->>discord_import_id', importId)
        .eq('author_external_id', id);
      if (error) throw new SupabaseQueryError(error);
    });
  }

  // ── avatars ───────────────────────────────────────────────────────────────
  const avatars = authors
    .map(({ discordUserId }) => {
      const profile = profiles.get(discordUserId);
      if (!profile) return null;
      const asset = discordAvatarAsset(
        {
          author: { id: discordUserId, avatar: profile.avatar },
          member: { avatar: profile.guildAvatar },
        },
        guildId,
      );
      return asset ? { discordUserId, ...asset } : null;
    })
    .filter((entry) => entry !== null);
  console.log(`${avatars.length} authors have an avatar to copy.`);

  if (!dryRun && avatars.length > 0) {
    const copier = new SupabaseArchiveMediaCopier(supabase);
    const files = await imports.registerFiles(
      chapterId,
      importId,
      avatars.map((avatar) => ({
        import_id: importId,
        chapter_id: chapterId,
        kind: 'media' as const,
        part_index: null,
        relative_path: avatar.key,
        bucket: CHAT_ARCHIVE_BUCKET,
        storage_path: archiveMediaObjectPath(chapterId, importId, avatar.key),
        content_type: 'image/png',
        byte_size: null,
      })),
      {
        importBytes: MAX_ARCHIVE_IMPORT_BYTES,
        chapterBytes: MAX_ARCHIVE_CHAPTER_BYTES,
      },
    );
    const byKey = new Map(files.map((file) => [file.relative_path, file]));
    let queue = avatars.filter((avatar) => byKey.has(avatar.key));
    const stored: typeof avatars = [];
    while (queue.length > 0) {
      const batch = queue.slice(0, 50);
      const results = await copier.copy(
        batch.map((avatar) => ({
          url: avatar.url,
          bucket: CHAT_ARCHIVE_BUCKET,
          path: byKey.get(avatar.key)!.storage_path,
          contentType: 'image/png',
          declaredSize: null,
        })),
      );
      const deferred = batch.filter(
        (_, index) => results[index]?.status === 'deferred',
      );
      if (deferred.length === batch.length) {
        throw new Error('The copy service copied none of a batch of avatars.');
      }
      stored.push(
        ...batch.filter((_, index) => results[index]?.status === 'stored'),
      );
      queue = [...deferred, ...queue.slice(batch.length)];
    }
    await imports.markFilesUploaded(
      importId,
      chapterId,
      stored.map((avatar) => byKey.get(avatar.key)!.storage_path),
      new Date().toISOString(),
    );
    await inBatches(stored, async (avatar) => {
      const { error } = await supabase
        .from('chat_messages')
        .update({ author_avatar_path: byKey.get(avatar.key)!.storage_path })
        .eq('kind', 'imported')
        .eq('metadata->>discord_import_id', importId)
        .eq('author_external_id', avatar.discordUserId)
        .is('author_avatar_path', null);
      if (error) throw new SupabaseQueryError(error);
    });
    console.log(`${stored.length} avatars stored.`);
  }

  // ── mentions ──────────────────────────────────────────────────────────────
  const rewrite = mentionRewriter(plan.mentions);
  let scanned = 0;
  let changed = 0;
  const samples: { before: string; after: string }[] = [];
  after = null;
  for (;;) {
    let query = supabase
      .from('chat_messages')
      .select('id, content')
      .eq('kind', 'imported')
      .eq('is_deleted', false)
      .eq('metadata->>discord_import_id', importId)
      .like('content', '%@%')
      .order('id', { ascending: true })
      .limit(PAGE_SIZE);
    if (after) query = query.gt('id', after);
    const { data: rows, error } = await query;
    if (error) throw new SupabaseQueryError(error);
    if (!rows || rows.length === 0) break;
    after = rows[rows.length - 1].id;
    scanned += rows.length;

    const updates = rows
      .map((row) => ({
        id: row.id,
        before: row.content,
        content: rewrite(row.content),
      }))
      .filter((row) => row.content !== row.before);
    for (const update of updates) {
      if (samples.length >= 8) break;
      samples.push({ before: update.before, after: update.content });
    }
    if (!dryRun) {
      await inBatches(updates, async (update) => {
        const { error: updateError } = await supabase
          .from('chat_messages')
          .update({ content: update.content })
          .eq('id', update.id)
          .eq('kind', 'imported');
        if (updateError) throw new SupabaseQueryError(updateError);
      });
    }
    changed += updates.length;
  }

  for (const sample of samples) {
    console.log(`\n- ${sample.before}\n+ ${sample.after}`);
  }
  console.log(
    `\n${dryRun ? '[dry run] ' : ''}Import ${importId}: ${plan.authorNames.size} author names, ` +
      `${scanned} rows with an @ read, ${changed} ${dryRun ? 'would change' : 'changed'}.`,
  );
}

main().catch((error: unknown) => {
  console.error(toReportableError(error).message);
  process.exit(1);
});
