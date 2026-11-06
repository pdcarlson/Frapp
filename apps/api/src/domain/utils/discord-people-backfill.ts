/**
 * The decisions behind `backfill-discord-import-people.ts`, kept apart from
 * its I/O so they are testable: what a bot import written before the importer
 * read members (2026-11-06) should have said about the people in it.
 *
 * Those imports named everyone by their Discord account (`global_name`, else
 * `username`), never by the server nickname everyone in the server saw. They
 * wrote mentions as `@` plus that name with its spaces kept, which a chat
 * client chips only up to the first space, and role mentions as the Frapp role
 * the Discord role was mapped to. The importer now writes the nickname, the
 * compact `@Handle` form ({@link mentionText}) and the Discord role name.
 *
 * Mentions are fixed by text, because the rewrite kept no token to fix them
 * from (see `discord-mentions.ts`): each name the old importer could have
 * written is replaced with what the new one writes for the same person. That
 * reaches only people whose old name is known, which is everyone who posted in
 * the import (their own rows record it). A mentioned person who never posted
 * keeps their old text. A name two people or roles share is left alone, since
 * the text cannot say which was meant.
 */
import type { DiscordGuildMemberProfile } from '../adapters/discord.interface';
import type { DiscordRoleMapping } from '../entities/discord-import.entity';
import { inertName, mentionText } from './discord-mentions';

/** One author of the import, as their own rows recorded them. */
export interface RecordedAuthor {
  discordUserId: string;
  /** `payload.author_username`: the account name the old importer used. */
  recordedName: string;
}

export interface PeopleRemap {
  /** New `author_name` per Discord user id, only where it changes. */
  authorNames: Map<string, string>;
  /** Mention text the old importer wrote → what the importer writes now. */
  mentions: Map<string, string>;
}

/**
 * What changes for this import's authors and roles.
 *
 * `profiles` holds each author's member read: `null` for someone no longer in
 * the server, who keeps their account name, as Discord shows them; absent for
 * a read that failed, who is left as they are.
 */
export function planPeopleRemap(args: {
  authors: readonly RecordedAuthor[];
  profiles: ReadonlyMap<string, DiscordGuildMemberProfile | null>;
  roleMapping: readonly DiscordRoleMapping[];
  frappRoleNames: ReadonlyMap<string, string>;
}): PeopleRemap {
  const authorNames = new Map<string, string>();
  /** Old text → every new text claimed for it; more than one is ambiguous. */
  const claims = new Map<string, Set<string>>();
  const claim = (oldName: string | null, newName: string | null) => {
    const from = oldName ? inertName(oldName) : null;
    const to = newName ? mentionText(newName) : null;
    if (!from || !to) return;
    const key = `@${from}`;
    const set = claims.get(key) ?? new Set<string>();
    set.add(to);
    claims.set(key, set);
  };

  for (const author of args.authors) {
    if (!args.profiles.has(author.discordUserId)) continue;
    const profile = args.profiles.get(author.discordUserId);
    const shown = profile?.nick ?? author.recordedName;
    if (shown !== author.recordedName) {
      authorNames.set(author.discordUserId, shown);
    }
    claim(author.recordedName, shown);
  }

  for (const entry of args.roleMapping) {
    const discordName =
      entry.discord_role_name === entry.discord_role_id
        ? null
        : entry.discord_role_name;
    // What the old importer named it: the mapped Frapp role first.
    const mapped =
      entry.action === 'ignore' || !entry.frapp_role_id
        ? null
        : (args.frappRoleNames.get(entry.frapp_role_id) ?? null);
    const oldName =
      mapped ??
      (entry.action === 'new' ? entry.new_role_name : null) ??
      discordName;
    claim(oldName, discordName ?? oldName);
  }

  const mentions = new Map<string, string>();
  for (const [from, targets] of claims) {
    if (targets.size !== 1) continue;
    const [to] = targets;
    if (to !== from) mentions.set(from, to);
  }
  return { authorNames, mentions };
}

/** Characters that continue a name; a mention must not end inside one. */
const NAME_CHAR = '[\\p{L}\\p{M}\\p{N}]';

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * A rewrite of `content` replacing each old mention with its new text, in one
 * pass, so a replacement is never itself replaced. The longest old text wins
 * where two start at the same place (`@New Member` over `@New`), and a match
 * must stand alone: not inside a longer word or email address, and not
 * running on into more letters (`@Member` does not touch `@Members`).
 */
export function mentionRewriter(
  mentions: ReadonlyMap<string, string>,
): (content: string) => string {
  if (mentions.size === 0) return (content) => content;
  const alternatives = [...mentions.keys()]
    .sort((a, b) => b.length - a.length)
    .map(escapeRegExp)
    .join('|');
  const pattern = new RegExp(
    `(?<![\\p{L}\\p{N}\\p{M}_@])(?:${alternatives})(?!${NAME_CHAR})`,
    'gu',
  );
  return (content) =>
    content.replace(pattern, (match) => mentions.get(match) ?? match);
}
