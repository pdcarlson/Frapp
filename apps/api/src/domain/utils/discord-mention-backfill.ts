/**
 * The decisions behind `backfill-discord-mention-tokens.ts` (#2875), kept
 * apart from its I/O so they are testable: when an import may be backfilled,
 * and what each stored row becomes.
 */
import type {
  DiscordImport,
  DiscordImportChannel,
} from '../entities/discord-import.entity';
import {
  rewriteDiscordMentions,
  type DiscordMentionResolver,
} from './discord-mentions';

/** A user mention token's id, for looking names up before the rewrite. */
const USER_TOKEN = /<@!?(\d{1,25})>/g;

/**
 * Why an import must not be backfilled now, or null when it may be.
 *
 * - Purged: nothing is left to fix.
 * - Still able to import (draft, ready, running): the worker may be writing
 *   rows beside the backfill, and new ones are named as they land.
 * - A new channel of the import not created yet: a mention of it would be
 *   written as an unlinked `#name`, and a rewritten row has no token left for
 *   any later run to link. Rows the old worker never reached are the usual
 *   cause (it made channels lazily). `allowUnlinked` accepts that, for an
 *   import that will never finish, such as a cancelled one.
 */
export function mentionBackfillBlocker(
  job: Pick<DiscordImport, 'id' | 'status'>,
  channels: readonly DiscordImportChannel[],
  allowUnlinked: boolean,
): string | null {
  if (job.status === 'purging' || job.status === 'purged') {
    return `Import ${job.id} is ${job.status}; nothing to fix.`;
  }
  if (
    job.status === 'draft' ||
    job.status === 'ready' ||
    job.status === 'running'
  ) {
    return `Import ${job.id} is ${job.status}. Run this once it has completed, failed or been cancelled.`;
  }
  if (allowUnlinked) return null;
  const missing = channels.filter(
    (row) =>
      !row.parent_discord_channel_id &&
      row.mapping_action === 'create_new' &&
      row.target_channel_id === null &&
      row.status !== 'skipped',
  );
  if (missing.length === 0) return null;
  const names = missing
    .slice(0, 5)
    .map((row) => `#${row.discord_channel_name}`)
    .join(', ');
  return (
    `${missing.length} channel(s) of import ${job.id} have no Frapp channel yet (${names}), ` +
    'so mentions of them would be written unlinked for good. Finish the import first, ' +
    'or pass --allow-unlinked for one that will not finish.'
  );
}

/** How the backfill names what a stored row mentions. */
export interface StoredMentionLookups {
  /** The name a user's own imported messages recorded, or null. */
  userName(discordUserId: string): Promise<string | null>;
  roleName: DiscordMentionResolver['roleName'];
  channel: DiscordMentionResolver['channel'];
}

/**
 * The rows whose text changes, with their new text. A row with nothing to
 * name is left out, which is what makes a second run a no-op. Each user is
 * looked up once, however many rows mention them.
 */
export async function nameStoredTokens(
  rows: readonly { id: string; content: string }[],
  lookups: StoredMentionLookups,
): Promise<{ id: string; content: string }[]> {
  const userNames = new Map<string, string | null>();
  const updates: { id: string; content: string }[] = [];
  for (const row of rows) {
    for (const match of row.content.matchAll(USER_TOKEN)) {
      const id = match[1];
      if (!userNames.has(id)) userNames.set(id, await lookups.userName(id));
    }
    const content = rewriteDiscordMentions(row.content, {
      userName: (id) => userNames.get(id) ?? null,
      roleName: lookups.roleName,
      channel: lookups.channel,
    });
    if (content !== row.content) updates.push({ id: row.id, content });
  }
  return updates;
}
