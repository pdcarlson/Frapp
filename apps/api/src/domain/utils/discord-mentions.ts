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
 * never change. The rewrite is still reversible: `toImportedMessage` keeps the
 * verbatim text on `payload.source_content` whenever this changed anything,
 * which is also what lets member linking (#2878) re-resolve a user mention to
 * a member later.
 *
 * The output is native Frapp prose, so nothing downstream learns a new syntax:
 * `@Name` is what a member types, and a channel whose Frapp channel exists
 * becomes an ordinary markdown link.
 *
 * **Code stays literal.** A token inside a fenced block or an inline code span
 * is someone showing the token, not using it, and Discord draws it raw there
 * too. The code scan mirrors `linkSegments` in `@repo/chat-core/links`, which is
 * how mobile decides what is code, so the two surfaces agree on the boundary.
 * A backslash-escaped token (`\<@123>`) is Discord's own way of writing one
 * literally, and stays as written for the same reason.
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
 * What the importer knows when it rewrites one message. Every lookup answers
 * null for an id it cannot name, and the rewrite then writes the neutral
 * placeholder rather than the snowflake.
 */
export interface DiscordMentionResolver {
  userName(discordUserId: string): string | null;
  roleName(discordRoleId: string): string | null;
  channel(discordChannelId: string): MentionedChannel | null;
}

/** Written for an id nothing could name. Never the snowflake. */
export const UNKNOWN_USER_MENTION = '@unknown-user';
export const UNKNOWN_ROLE_MENTION = '@unknown-role';
export const UNKNOWN_CHANNEL_MENTION = '#unknown-channel';

/**
 * One token, matched at a `<`. Snowflakes are digit runs; the bound only stops
 * a pathological run being captured whole.
 *
 * Groups: 1 user id · 2 role id · 3 channel id · 4 emoji name · 5 timestamp
 * seconds · 6 timestamp style · 7 command name.
 */
const TOKEN =
  /<(?:@!?(\d{1,25})|@&(\d{1,25})|#(\d{1,25})|a?:(\w{1,32}):\d{1,25}|t:(-?\d{1,15})(?::([tTdDfFR]))?|\/([^<>:\n]{1,100}):\d{1,25})>/y;

/** Characters that would end or reopen a markdown link label or target. */
const UNSAFE_IN_LINK = /[[\]()\\\n]/;

function channelMention(channel: MentionedChannel | null): string {
  if (!channel) return UNKNOWN_CHANNEL_MENTION;
  const label = `#${channel.name}`;
  // A channel name Discord allows but a link label cannot carry stays plain
  // text: a broken link reads worse than an unlinked name.
  if (!channel.frappChannelId || UNSAFE_IN_LINK.test(channel.name)) {
    return label;
  }
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
    const name = resolver.userName(userId);
    return name ? `@${name}` : UNKNOWN_USER_MENTION;
  }
  if (roleId !== undefined) {
    const name = resolver.roleName(roleId);
    return name ? `@${name}` : UNKNOWN_ROLE_MENTION;
  }
  if (channelId !== undefined)
    return channelMention(resolver.channel(channelId));
  if (emoji !== undefined) return `:${emoji}:`;
  if (seconds !== undefined) return formatTimestamp(seconds, style) ?? whole;
  if (command !== undefined) return `/${command}`;
  return whole;
}

/**
 * `content` with every Discord token outside code replaced by what it names.
 *
 * Linear in the body: each backtick run is searched for its closer once, and a
 * run length already known to have no closer is not searched for again, the
 * same bound `linkSegments` uses.
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
      let run = 1;
      while (content[i + run] === '`') run += 1;
      const fence = '`'.repeat(run);
      const close = unclosedTicks.has(run)
        ? -1
        : content.indexOf(fence, i + run);
      if (close === -1) {
        unclosedTicks.add(run);
        out += fence;
        i += run;
        continue;
      }
      out += content.slice(i, close + run);
      i = close + run;
      continue;
    }

    if (char === '<' && content[i - 1] !== '\\') {
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
 * A channel mention, looked up in the import's own channel rows.
 *
 * Reads the rows **live**, not a copy: the worker writes each row's
 * `target_channel_id` onto the same objects as it creates or finds the Frapp
 * channel, so a channel is linked from the moment its channel exists. A
 * mention of a channel the walk has not reached yet reads as `#name`
 * unlinked, because creating a channel for a mention would make a channel the
 * walk might never fill (it is skipped if Discord no longer shows it).
 *
 * A thread is named as itself but links to where it landed, its parent's
 * channel. The name is what the channel is called in Frapp when this import
 * made it, else Discord's.
 */
export function importChannelMentions(
  rows: readonly DiscordImportChannel[],
): (discordChannelId: string) => MentionedChannel | null {
  const byId = new Map(rows.map((row) => [row.discord_channel_id, row]));
  return (discordChannelId) => {
    const row = byId.get(discordChannelId);
    if (!row) return null;
    const landedIn = row.parent_discord_channel_id
      ? byId.get(row.parent_discord_channel_id)
      : row;
    const name =
      !row.parent_discord_channel_id && row.mapping_action === 'create_new'
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
 * role deleted in Discord before the scan, is unknown.
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
    names.set(
      entry.discord_role_id,
      mapped ??
        (entry.action === 'new' ? entry.new_role_name : null) ??
        entry.discord_role_name,
    );
  }
  if (args.guildId) names.set(args.guildId, 'everyone');
  return names;
}
