/**
 * Discord's in-content tokens → the prose a Frapp reader can read (#2875).
 *
 * Discord stores a mention as a token in `content` and draws the name at view
 * time: `<@123>` and `<@!123>` are users, `<@&123>` a role, `<#123>` a channel,
 * `<:name:123>` / `<a:name:123>` a custom emoji, `<t:1727630000:R>` a
 * timestamp and `</name:123>` a slash command. Read over the REST API, a
 * message carries those tokens verbatim, so an import that copied `content`
 * as is wrote `<@&750151182395244584> we need numbers now` into the chapter's
 * record.
 *
 * **Resolved at import, not at render.** The names come from things only the
 * importer holds: the message's own `mentions` users, the role mapping the
 * admin chose (#2818), and the import's channel rows. A render-time resolver
 * would need all three shipped to every client on every read, for rows that
 * never change.
 *
 * **The rewrite is permanent, and nothing keeps the original text.** A copy
 * on `payload` was tried and dropped in review: deleting a message clears
 * `content` and leaves `payload` alone, so a moderator's delete would have
 * left the removed words readable by every member of the channel.
 *
 * The output is native Frapp prose, so nothing downstream learns a new syntax:
 * `@Name` is what a member types, and a channel whose Frapp channel exists
 * becomes an ordinary markdown link.
 *
 * **What the output must never do.** A name is someone else's text, so it is
 * inserted inert (see {@link inertName}): a Discord nickname such as
 * `[Verify](https://ev.il)` must not become a link inside another member's
 * message. And a channel only some members could read is not named at all
 * (see {@link importChannelMentions}), since Discord shows "No Access" there.
 *
 * **Code stays literal.** A token inside a fenced block or an inline code span
 * is someone showing the token, not using it, and Discord draws it raw there
 * too. A span closes on a backtick run of exactly its opening length, as in
 * CommonMark and Discord. A backslash-escaped token (`\<@123>`) is Discord's
 * own way of writing one literally, and stays as written for the same reason.
 *
 * Pure and I/O-free, like the rest of the importer's mapping, so every token
 * shape is testable without Discord.
 */
import type {
  DiscordImportChannel,
  DiscordRoleMapping,
} from '../entities/discord-import.entity';

/** A channel as a mention can name it. */
export interface MentionedChannel {
  /** Without the leading `#`. */
  name: string;
  /** The Frapp channel its messages landed in, once there is one. */
  frappChannelId: string | null;
}

/**
 * A channel some chapter members cannot read. Its mention is written without
 * its name, the way Discord shows such a mention to someone outside it.
 */
export const PRIVATE_CHANNEL = 'private';

/**
 * What the importer knows when it rewrites one message. Every lookup answers
 * null for an id it cannot name, and the rewrite then writes the neutral
 * placeholder rather than the snowflake.
 */
export interface DiscordMentionResolver {
  userName(discordUserId: string): string | null;
  roleName(discordRoleId: string): string | null;
  channel(
    discordChannelId: string,
  ): MentionedChannel | typeof PRIVATE_CHANNEL | null;
}

/** Written for an id nothing could name. Never the snowflake. */
export const UNKNOWN_USER_MENTION = '@unknown-user';
export const UNKNOWN_ROLE_MENTION = '@unknown-role';
export const UNKNOWN_CHANNEL_MENTION = '#unknown-channel';
export const PRIVATE_CHANNEL_MENTION = '#private-channel';

/**
 * One token, matched at a `<`. Snowflakes are digit runs; the bound only stops
 * a pathological run being captured whole.
 *
 * Groups: 1 user id · 2 role id · 3 channel id · 4 emoji name · 5 timestamp
 * seconds · 6 timestamp style · 7 command name.
 */
const TOKEN =
  /<(?:@!?(\d{1,25})|@&(\d{1,25})|#(\d{1,25})|a?:(\w{1,32}):\d{1,25}|t:(-?\d{1,15})(?::([tTdDfFR]))?|\/([^<>:\n]{1,100}):\d{1,25})>/y;

/**
 * Characters in a name that would act on the message around it once web
 * renders `content` as CommonMark: link and autolink brackets (a disguised
 * link), the escape, backticks (which move code-span boundaries) and the
 * asterisk (emphasis that can pair with one later in the message).
 *
 * The underscore stays: it is common in Discord usernames, and CommonMark does
 * not read an underscore inside a word as emphasis. Web renders without GFM,
 * so `~` and `|` are inert.
 */
const MARKUP = /[[\]<>\\`*]/g;

/**
 * A name as inert text, or null when nothing readable is left.
 *
 * Removed rather than backslash-escaped: mobile draws a body as typed, not as
 * markdown, so an escape would show there as a stray backslash. Losing a
 * bracket or an asterisk from a nickname is the smaller cost. Line breaks and
 * other control characters become spaces, so a name cannot start a new block
 * either.
 */
export function inertName(name: string): string | null {
  const plain = name
    .replace(/\p{Cc}/gu, ' ')
    .replace(MARKUP, '')
    .replace(/\s+/g, ' ')
    .trim();
  return plain.length > 0 ? plain : null;
}

function channelMention(
  channel: MentionedChannel | typeof PRIVATE_CHANNEL | null,
): string {
  if (channel === PRIVATE_CHANNEL) return PRIVATE_CHANNEL_MENTION;
  const name = channel ? inertName(channel.name) : null;
  if (!channel || !name) return UNKNOWN_CHANNEL_MENTION;
  const label = `#${name}`;
  if (!channel.frappChannelId) return label;
  return `[${label}](/chat?channel=${encodeURIComponent(channel.frappChannelId)})`;
}

const pad = (value: number) => String(value).padStart(2, '0');

/**
 * A `<t:…>` timestamp, in UTC.
 *
 * Discord draws these in each reader's own time zone, which a stored string
 * cannot do, so the zone is written out rather than implied. `R` (relative,
 * "3 days ago") is written as the absolute time: relative to what the reader's
 * clock says years later it would be wrong. Returns null for a time `Date`
 * cannot represent, and the token is then left as written.
 */
function formatTimestamp(
  seconds: string,
  style: string | undefined,
): string | null {
  const date = new Date(Number(seconds) * 1000);
  if (Number.isNaN(date.getTime())) return null;
  const day = `${date.getUTCFullYear()}-${pad(date.getUTCMonth() + 1)}-${pad(date.getUTCDate())}`;
  const time = `${pad(date.getUTCHours())}:${pad(date.getUTCMinutes())} UTC`;
  if (style === 'd' || style === 'D') return day;
  if (style === 't' || style === 'T') return time;
  return `${day} ${time}`;
}

function replaceToken(
  match: RegExpExecArray,
  resolver: DiscordMentionResolver,
): string {
  const [whole, userId, roleId, channelId, emoji, seconds, style, command] =
    match;
  if (userId !== undefined) {
    const raw = resolver.userName(userId);
    const name = raw === null ? null : inertName(raw);
    return name ? `@${name}` : UNKNOWN_USER_MENTION;
  }
  if (roleId !== undefined) {
    const raw = resolver.roleName(roleId);
    const name = raw === null ? null : inertName(raw);
    return name ? `@${name}` : UNKNOWN_ROLE_MENTION;
  }
  if (channelId !== undefined) {
    return channelMention(resolver.channel(channelId));
  }
  if (emoji !== undefined) return `:${emoji}:`;
  if (seconds !== undefined) return formatTimestamp(seconds, style) ?? whole;
  if (command !== undefined) {
    const name = inertName(command);
    return name ? `/${name}` : whole;
  }
  return whole;
}

/** Length of the backtick run starting at `at`. */
function runLength(content: string, at: number): number {
  let run = 0;
  while (content[at + run] === '`') run += 1;
  return run;
}

/**
 * Where the backtick run of exactly `run` characters that closes a code span
 * starts, searching from `from`, or -1. A longer or shorter run is part of the
 * span's text, not its end.
 */
function findCloser(content: string, from: number, run: number): number {
  let at = content.indexOf('`', from);
  while (at !== -1) {
    const length = runLength(content, at);
    if (length === run) return at;
    at = content.indexOf('`', at + length);
  }
  return -1;
}

/** True when the character at `at` follows an odd number of backslashes. */
function isEscaped(content: string, at: number): boolean {
  let slashes = 0;
  while (content[at - 1 - slashes] === '\\') slashes += 1;
  return slashes % 2 === 1;
}

/**
 * `content` with every Discord token outside code replaced by what it names.
 *
 * Linear in practice: a run length already known to have no closer is not
 * searched for again, so a body full of unmatched backticks costs one search
 * per distinct run length.
 */
export function rewriteDiscordMentions(
  content: string,
  resolver: DiscordMentionResolver,
): string {
  if (!content.includes('<')) return content;

  let out = '';
  const unclosedTicks = new Set<number>();
  let i = 0;
  while (i < content.length) {
    const char = content[i];

    if (char === '`') {
      const run = runLength(content, i);
      const close = unclosedTicks.has(run)
        ? -1
        : findCloser(content, i + run, run);
      if (close === -1) {
        unclosedTicks.add(run);
        out += content.slice(i, i + run);
        i += run;
        continue;
      }
      out += content.slice(i, close + run);
      i = close + run;
      continue;
    }

    if (char === '<' && !isEscaped(content, i)) {
      TOKEN.lastIndex = i;
      const match = TOKEN.exec(content);
      if (match) {
        out += replaceToken(match, resolver);
        i += match[0].length;
        continue;
      }
    }

    out += char;
    i += 1;
  }
  return out;
}

/**
 * Whether every member of the chapter can read what landed from this row.
 *
 * Only then is a mention of it named. Discord shows "No Access" for a channel
 * the reader cannot see, and an imported mention is read by everyone in the
 * channel it sits in, so naming a private one would publish its name (a
 * private thread's name is often the whole secret).
 *
 * Whole chapter means one of:
 * - the import creates it readable by the whole chapter (`PUBLIC`). A channel
 *   private in Discord gets that only by the admin choosing it, and it is then
 *   on every member's channel list anyway;
 * - the scan found it readable by everyone in Discord (`private_in_discord`
 *   false), and it merges into an existing channel or was skipped. Its name
 *   was public in Discord, so naming it discloses nothing new.
 *
 * Anything else counts as private: a `ROLE_GATED` destination, a private
 * thread, and a merged or skipped channel that was private or whose privacy
 * is unknown (an upload records none). A thread is judged on its own privacy
 * and on its parent's destination, where its messages landed.
 */
function readableByWholeChapter(
  row: DiscordImportChannel,
  landedIn: DiscordImportChannel | undefined,
): boolean {
  if (!landedIn) return false;
  const isThread = row !== landedIn;
  if (isThread && row.private_in_discord !== false) return false;
  if (landedIn.mapping_action === 'create_new') {
    return landedIn.new_channel_type === 'PUBLIC';
  }
  return landedIn.private_in_discord === false;
}

/**
 * A channel mention, looked up in the import's own channel rows.
 *
 * Reads the rows **live**, not a copy: the worker writes each row's
 * `target_channel_id` onto the same objects as it creates or finds the Frapp
 * channel, so a channel is linked from the moment its channel exists. The bot
 * path creates every new channel before it reads a message, so on that path
 * every mention of an imported channel links.
 *
 * A thread is named as itself but links to where it landed, its parent's
 * channel. A top-level channel is named what it is called in Frapp when this
 * import made it, else Discord's name. A channel only some members can read is
 * {@link PRIVATE_CHANNEL}.
 */
export function importChannelMentions(
  rows: readonly DiscordImportChannel[],
): (
  discordChannelId: string,
) => MentionedChannel | typeof PRIVATE_CHANNEL | null {
  const byId = new Map(rows.map((row) => [row.discord_channel_id, row]));
  return (discordChannelId) => {
    const row = byId.get(discordChannelId);
    if (!row) return null;
    const isThread = row.parent_discord_channel_id !== null;
    const landedIn = isThread ? byId.get(row.parent_discord_channel_id!) : row;
    if (!readableByWholeChapter(row, landedIn)) return PRIVATE_CHANNEL;
    const name =
      !isThread && row.mapping_action === 'create_new'
        ? (row.new_channel_name ?? row.discord_channel_name)
        : row.discord_channel_name;
    return {
      name,
      frappChannelId:
        landedIn && landedIn.mapping_action !== 'skip'
          ? landedIn.target_channel_id
          : null,
    };
  };
}

/**
 * What a role mention reads as, per Discord role id (#2818's mapping).
 *
 * A role mapped to a Frapp role reads as that role's current name, since that
 * is the role a reader can find in Frapp. One set to Ignore keeps its Discord
 * name: it is still the name of a group the chapter had. A mapped role since
 * deleted in Frapp falls back the same way. `@everyone`'s role id is the
 * guild's id, and reads as `everyone`.
 *
 * The mapping lists every role the admin was offered, which leaves out the
 * managed roles Discord gives bots and boosters: a mention of one, or of a
 * role deleted in Discord before the scan, is unknown. So is an entry whose
 * only name is its own id, which is what `parseRoleMapping` stores for an
 * entry saved without a name.
 */
export function roleMentionNames(args: {
  roleMapping: readonly DiscordRoleMapping[];
  frappRoleNames: ReadonlyMap<string, string>;
  guildId: string | null;
}): Map<string, string> {
  const names = new Map<string, string>();
  for (const entry of args.roleMapping) {
    const mapped =
      entry.action === 'ignore' || !entry.frapp_role_id
        ? null
        : (args.frappRoleNames.get(entry.frapp_role_id) ?? null);
    const discordName =
      entry.discord_role_name === entry.discord_role_id
        ? null
        : entry.discord_role_name;
    const name =
      mapped ??
      (entry.action === 'new' ? entry.new_role_name : null) ??
      discordName;
    if (name) names.set(entry.discord_role_id, name);
  }
  if (args.guildId) names.set(args.guildId, 'everyone');
  return names;
}
