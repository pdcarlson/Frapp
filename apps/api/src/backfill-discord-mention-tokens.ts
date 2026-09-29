/**
 * Names the Discord tokens in messages a bot import already wrote (#2875).
 *
 * Bot imports that ran before the importer learned to name `<@id>`, `<@&id>`,
 * `<#id>`, custom emoji and the rest stored them verbatim. This applies the
 * importer's own rewrite (`rewriteDiscordMentions`) to those rows. A re-import
 * would also fix them, but it re-reads every message from Discord and copies
 * every attachment again; this touches only the rows that carry a token.
 *
 * Bot imports only. An upload's text was already named by DiscordChatExporter,
 * and an upload records no role mapping to name roles from.
 *
 * What it names things from, and how that compares with a fresh import:
 * - roles and channels: the same lookups the worker uses, read now. By now
 *   every channel of the import exists, so every mention of an imported
 *   channel links, as it does in a fresh bot import. A role renamed in Frapp
 *   since the import reads as its current name.
 * - users: the display name the import stored on that user's own messages
 *   (`payload.author_username`, newest first). A fresh import reads the
 *   display name from the message's own `mentions`, which were never stored,
 *   so a mentioned user who never posted in the import reads `@unknown-user`
 *   here.
 *
 * `content` is rewritten in place and nothing else changes; like the importer,
 * it keeps no copy of the original text (see `discord-mentions.ts`).
 * Re-runnable: a row it already fixed has no token left, so a second run
 * leaves it alone.
 *
 * Env: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY (bypasses RLS; never logged).
 *
 * Usage, from apps/api:
 *   node --conditions=source -r ts-node/register \
 *     src/backfill-discord-mention-tokens.ts \
 *     --chapter <chapter id> --import <import id> [--dry-run]
 */
import { createClient } from '@supabase/supabase-js';
import type { Database } from './infrastructure/supabase/database.types';
import { SupabaseDiscordImportRepository } from './infrastructure/supabase/repositories/supabase-discord-import.repository';
import { SupabaseRoleRepository } from './infrastructure/supabase/repositories/supabase-role.repository';
import {
  importChannelMentions,
  rewriteDiscordMentions,
  roleMentionNames,
} from '#domain/utils/discord-mentions';
import { parseRoleMapping } from '#domain/utils/discord-role-gates';
import { asRecord, asString } from '#domain/utils/json-guards';

/** Rows read per round trip. */
const PAGE_SIZE = 500;

/** Updates in flight at once: quicker than one at a time, gentle on PostgREST. */
const CONCURRENT_UPDATES = 10;

/**
 * A row worth reading: one whose text has a `<` followed by something a token
 * can start with. The rewrite decides for certain; this only keeps the scan
 * off the rows that plainly have none.
 */
const MAY_HOLD_TOKEN = '<(@|#|a?:|t:|/)';

function argValue(name: string): string | null {
  const at = process.argv.indexOf(name);
  return at === -1 ? null : (process.argv[at + 1] ?? null);
}

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Missing required environment variable ${name}`);
  return value;
}

async function main(): Promise<void> {
  const chapterId = argValue('--chapter');
  const importId = argValue('--import');
  const dryRun = process.argv.includes('--dry-run');
  if (!chapterId || !importId) {
    throw new Error(
      'Usage: backfill-discord-mention-tokens --chapter <id> --import <id> [--dry-run]',
    );
  }

  const supabase = createClient<Database>(
    requireEnv('SUPABASE_URL'),
    requireEnv('SUPABASE_SERVICE_ROLE_KEY'),
    { auth: { persistSession: false, autoRefreshToken: false } },
  );
  const imports = new SupabaseDiscordImportRepository(supabase);

  // Chapter-scoped, so a mistyped import id from another chapter finds nothing.
  const job = await imports.findById(importId, chapterId);
  if (!job) throw new Error(`No import ${importId} in chapter ${chapterId}.`);
  if (job.source !== 'bot') {
    throw new Error(
      `Import ${importId} is an upload; DiscordChatExporter already named its tokens.`,
    );
  }
  if (job.status === 'purging' || job.status === 'purged') {
    throw new Error(`Import ${importId} is ${job.status}; nothing to fix.`);
  }

  const frappRoles = await new SupabaseRoleRepository(supabase).findByChapter(
    chapterId,
  );
  const roleNames = roleMentionNames({
    roleMapping: parseRoleMapping(job.role_mapping),
    frappRoleNames: new Map(frappRoles.map((role) => [role.id, role.name])),
    guildId: job.guild_id,
  });
  const channel = importChannelMentions(
    await imports.findChannels(importId, chapterId),
  );

  // Looked up on demand, once per user: a server has far fewer mentioned
  // people than messages mentioning them.
  const userNames = new Map<string, string | null>();
  const knownUser = async (discordUserId: string): Promise<void> => {
    if (userNames.has(discordUserId)) return;
    const { data, error } = await supabase
      .from('chat_messages')
      .select('payload')
      .eq('kind', 'imported')
      .eq('metadata->>discord_import_id', importId)
      .eq('author_external_id', discordUserId)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();
    if (error) throw error;
    userNames.set(
      discordUserId,
      asString(asRecord(data?.payload)?.author_username),
    );
  };

  let scanned = 0;
  let changed = 0;
  const samples: { before: string; after: string }[] = [];
  // Keyset on id rather than an offset: a row this run fixes drops out of the
  // token filter, which would shift an offset past rows never read.
  let after: string | null = null;

  for (;;) {
    let query = supabase
      .from('chat_messages')
      .select('id, content')
      .eq('kind', 'imported')
      .eq('metadata->>discord_import_id', importId)
      .filter('content', 'match', MAY_HOLD_TOKEN)
      .order('id', { ascending: true })
      .limit(PAGE_SIZE);
    if (after) query = query.gt('id', after);
    const { data: rows, error } = await query;
    if (error) throw error;
    if (!rows || rows.length === 0) break;
    after = rows[rows.length - 1].id;

    const updates: { id: string; content: string }[] = [];
    for (const row of rows) {
      scanned += 1;
      for (const match of row.content.matchAll(/<@!?(\d{1,25})>/g)) {
        await knownUser(match[1]);
      }
      const rewritten = rewriteDiscordMentions(row.content, {
        userName: (id) => userNames.get(id) ?? null,
        roleName: (id) => roleNames.get(id) ?? null,
        channel,
      });
      if (rewritten === row.content) continue;
      if (samples.length < 5) {
        samples.push({ before: row.content, after: rewritten });
      }
      updates.push({ id: row.id, content: rewritten });
    }

    if (!dryRun) {
      for (let at = 0; at < updates.length; at += CONCURRENT_UPDATES) {
        await Promise.all(
          updates.slice(at, at + CONCURRENT_UPDATES).map(async (update) => {
            const { error: updateError } = await supabase
              .from('chat_messages')
              .update({ content: update.content })
              .eq('id', update.id)
              .eq('kind', 'imported');
            if (updateError) throw updateError;
          }),
        );
      }
    }
    changed += updates.length;
    console.log(`…${scanned} read, ${changed} ${dryRun ? 'to fix' : 'fixed'}`);
  }

  for (const sample of samples) {
    console.log(`\n- ${sample.before}\n+ ${sample.after}`);
  }
  console.log(
    `\n${dryRun ? '[dry run] ' : ''}Import ${importId}: ${scanned} rows with a possible token, ${changed} ${dryRun ? 'would change' : 'changed'}.`,
  );
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
