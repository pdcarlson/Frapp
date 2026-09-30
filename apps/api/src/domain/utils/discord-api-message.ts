/**
 * Discord REST API payloads → the shape the importer already speaks.
 *
 * Phase 2 built one mapping from a message to a `chat_messages` row
 * (`toImportedMessage` in `discord-export.ts`) and it is where all the
 * dangerous decisions live: the timestamp that decides whether a decade of
 * history lands in 2019 or today, the author-name fallback that a NOT NULL
 * CHECK depends on, the reply resolution, the reaction summary that must not
 * invent identities.
 *
 * **This file does not repeat any of that.** It is a shape adapter and nothing
 * more: it turns a Discord API message into the same
 * `DiscordExportMessage` intermediate that DiscordChatExporter's JSON parses
 * into, and hands it to the exact same mapper. A second importer would mean a
 * second place for "which field is the timestamp" to be answered, and the two
 * answers would drift the first time either side changed.
 *
 * Pure and I/O-free, like its phase-2 counterpart, for the same reason: this is
 * where the damage is silent, so it must be testable against fixtures with no
 * network, no database and no bot token.
 *
 * The shapes below are read from Discord's documented Message object. Every
 * field is optional on the way in — an API response is a foreign artifact and
 * a missing key is a data problem to report, never a crash.
 */
import type {
  DiscordExportAttachment,
  DiscordExportMessage,
  DiscordExportUser,
} from './discord-export';
import { asString } from './json-guards';

/** A Discord API attachment, as much of it as we read. */
export interface DiscordApiAttachment {
  id?: string | null;
  filename?: string | null;
  size?: number | null;
  /** The CDN URL. Signed and expiring — see {@link discordAttachmentKey}. */
  url?: string | null;
  proxy_url?: string | null;
  content_type?: string | null;
}

export interface DiscordApiUser {
  id?: string | null;
  username?: string | null;
  /** The account-wide display name. Newer, and what clients show by default. */
  global_name?: string | null;
  discriminator?: string | null;
  avatar?: string | null;
  bot?: boolean | null;
}

/** The author's guild membership, when the response carried one. */
export interface DiscordApiMessageMember {
  /** Per-server nickname — what the channel actually showed at the time. */
  nick?: string | null;
}

export interface DiscordApiMessage {
  id?: string | null;
  channel_id?: string | null;
  type?: number | null;
  content?: string | null;
  timestamp?: string | null;
  edited_timestamp?: string | null;
  pinned?: boolean | null;
  author?: DiscordApiUser | null;
  member?: DiscordApiMessageMember | null;
  attachments?: DiscordApiAttachment[] | null;
  embeds?: unknown[] | null;
  sticker_items?: { name?: string | null }[] | null;
  /**
   * The users `content` mentions. Discord's REST message carries plain user
   * objects here, with no server nickname (the gateway adds a partial
   * `member`; read when present).
   */
  mentions?:
    (DiscordApiUser & { member?: DiscordApiMessageMember | null })[] | null;
  reactions?:
    | {
        count?: number | null;
        emoji?: { id?: string | null; name?: string | null } | null;
      }[]
    | null;
  message_reference?: {
    message_id?: string | null;
    channel_id?: string | null;
    guild_id?: string | null;
  } | null;
}

/**
 * Message types that carry a member's own words.
 *
 * Only these count toward the empty-content check below. A guild's `#welcome`
 * channel is often nothing but type-7 join notices, which legitimately have no
 * content — counting them would make a healthy import look like a broken one.
 *
 * 0 = DEFAULT, 19 = REPLY. Everything else (joins, boosts, pins, thread
 * starters, calls) is a system event that Discord renders from its own
 * template, and an empty `content` on one of those means nothing at all.
 */
const AUTHORED_MESSAGE_TYPES = new Set([0, 19]);

/**
 * Discord's numeric message types, named.
 *
 * Only the ones a chapter's archive actually contains. `payload.message_type`
 * on an imported row is a *string* on the DCE path (DCE writes "Default",
 * "Reply", …), so the API path resolves to the same spelling — otherwise the
 * same message imported two ways would carry two different values and nothing
 * reading the payload could compare them. An unrecognised type falls back to
 * its number as a string rather than null, so the fact survives.
 */
const MESSAGE_TYPE_NAMES: Record<number, string> = {
  0: 'Default',
  1: 'RecipientAdd',
  2: 'RecipientRemove',
  3: 'Call',
  4: 'ChannelNameChange',
  5: 'ChannelIconChange',
  6: 'ChannelPinnedMessage',
  7: 'GuildMemberJoin',
  8: 'UserPremiumGuildSubscription',
  9: 'UserPremiumGuildSubscriptionTier1',
  10: 'UserPremiumGuildSubscriptionTier2',
  11: 'UserPremiumGuildSubscriptionTier3',
  12: 'ChannelFollowAdd',
  14: 'GuildDiscoveryDisqualified',
  15: 'GuildDiscoveryRequalified',
  18: 'ThreadCreated',
  19: 'Reply',
  20: 'ChatInputCommand',
  21: 'ThreadStarterMessage',
  22: 'GuildInviteReminder',
  23: 'ContextMenuCommand',
};

function messageTypeName(type: number | null | undefined): string | null {
  if (typeof type !== 'number') return null;
  return MESSAGE_TYPE_NAMES[type] ?? String(type);
}

/**
 * The stable key one attachment is stored and deduplicated under.
 *
 * **Not the CDN URL, deliberately.** Discord now signs attachment URLs with
 * `?ex=&is=&hm=` parameters that rotate, so the same object read twice yields
 * two different strings — which would defeat `discord_import_files`' unique
 * `(import_id, relative_path)` and re-upload every attachment on every resume.
 *
 * The attachment id is a snowflake and is unique per uploaded object, so
 * `{id}/{filename}` is stable, readable in a manifest, and collision-free.
 * The filename rides along so an operator reading the manifest can tell what a
 * row is without joining anything.
 *
 * This is the value the mapper writes into `attachments[].url`, which is
 * exactly where the DCE path puts its own export-relative path — so
 * `toImportedAttachments` resolves both paths through the same manifest lookup
 * with no branch.
 */
export function discordAttachmentKey(
  attachment: DiscordApiAttachment,
): string | null {
  const id = asString(attachment.id);
  if (!id) return null;
  const filename = asString(attachment.filename) ?? 'attachment';
  return `${id}/${filename}`;
}

/**
 * One Discord API message, in the shape `toImportedMessage` already consumes.
 *
 * Field-for-field notes where the two vocabularies disagree:
 *
 *  * `nickname` ← `member.nick`. The per-server nickname is what the channel
 *    displayed at the time, which is what an archive is for, and it is what
 *    `resolveAuthorName` prefers. It is only present when the response carried
 *    a member object; absent, the name falls through to the account name,
 *    which is the same outcome the DCE path has for an export without it.
 *  * `name` ← `global_name` before `username`. `global_name` is the display
 *    name modern clients show; `username` is the handle. Preferring the
 *    handle would make every imported message read like a mention.
 *  * `attachments[].url` ← {@link discordAttachmentKey}, **not** the CDN URL.
 *  * `avatarUrl` ← always null. Avatars are not fetched on this path (see the
 *    worker); a null here is the same state the DCE path has when the admin
 *    exported without `--media`, and `author_avatar_path` already handles it.
 */
export function toExportShapeMessage(
  message: DiscordApiMessage,
): DiscordExportMessage {
  const author: DiscordExportUser = {
    id: asString(message.author?.id),
    name:
      asString(message.author?.global_name) ??
      asString(message.author?.username),
    discriminator: asString(message.author?.discriminator),
    nickname: asString(message.member?.nick),
    isBot: message.author?.bot === true,
    avatarUrl: null,
  };

  const attachments: DiscordExportAttachment[] = (message.attachments ?? [])
    .map((attachment): DiscordExportAttachment | null => {
      const key = discordAttachmentKey(attachment);
      // No id means no stable key, and no stable key means the manifest could
      // not dedupe it or resolve it later. Dropping it loses the attachment,
      // not the message — which is the right trade against re-uploading the
      // same bytes on every resume.
      if (!key) return null;
      return {
        id: asString(attachment.id),
        url: key,
        fileName: asString(attachment.filename),
        fileSizeBytes:
          typeof attachment.size === 'number' && attachment.size >= 0
            ? attachment.size
            : null,
      };
    })
    .filter((entry): entry is DiscordExportAttachment => entry !== null);

  return {
    id: asString(message.id),
    type: messageTypeName(message.type),
    timestamp: asString(message.timestamp),
    timestampEdited: asString(message.edited_timestamp),
    isPinned: message.pinned === true,
    content: asString(message.content) ?? '',
    author,
    attachments,
    embeds: Array.isArray(message.embeds) ? message.embeds : [],
    stickers: (message.sticker_items ?? []).map((sticker) => ({
      name: asString(sticker?.name),
    })),
    mentions: (message.mentions ?? []).map((user): DiscordExportUser => ({
      id: asString(user?.id),
      name: asString(user?.global_name) ?? asString(user?.username),
      nickname: asString(user?.member?.nick),
    })),
    reactions: (message.reactions ?? []).map((reaction) => ({
      emoji: {
        id: asString(reaction?.emoji?.id),
        name: asString(reaction?.emoji?.name),
        code: null,
        isAnimated: null,
      },
      count: typeof reaction?.count === 'number' ? reaction.count : 0,
      users: null,
    })),
    reference: message.message_reference
      ? {
          messageId: asString(message.message_reference.message_id),
          channelId: asString(message.message_reference.channel_id),
          guildId: asString(message.message_reference.guild_id),
        }
      : null,
  };
}

/**
 * Running tally used to catch a bot that is reading everything as blank.
 *
 * Discord gates message content behind the **Message Content Intent**. A bot
 * without it does not get an error — it gets a 200 with `content: ""`,
 * `attachments: []` and `embeds: []` on every message it did not author. An
 * import that trusted that would run to completion and write a chapter's
 * entire history as empty bubbles, which is worse than failing, because it
 * looks like it worked.
 *
 * The export first asks Discord whether the intent is on, before it writes
 * anything (`GET /applications/@me`'s flags; see
 * {@link messageContentIntentOffError}). This tally is the backstop for
 * when that answer is missing or unreadable: it counts, and refuses to keep
 * going once it has seen enough authored messages with nothing in any of them
 * to be sure. See {@link isLikelyMissingMessageContentIntent}.
 */
export interface MessageContentTally {
  /** Messages of an authored type (see {@link AUTHORED_MESSAGE_TYPES}). */
  authored: number;
  /** Of those, how many carried content, an attachment, or an embed. */
  withSubstance: number;
}

export const EMPTY_CONTENT_TALLY: MessageContentTally = {
  authored: 0,
  withSubstance: 0,
};

/**
 * How many authored messages must come back empty before we call it.
 *
 * Low enough that an admin finds out in the first slice rather than after a
 * 40-minute import; high enough that a genuinely quiet channel — a handful of
 * image-only posts whose attachments happen to be gone, say — cannot trip it.
 */
export const MIN_AUTHORED_MESSAGES_FOR_CONTENT_CHECK = 25;

export function tallyMessageContent(
  tally: MessageContentTally,
  messages: DiscordApiMessage[],
): MessageContentTally {
  let { authored, withSubstance } = tally;
  for (const message of messages) {
    if (!AUTHORED_MESSAGE_TYPES.has(message.type ?? -1)) continue;
    authored += 1;
    const hasContent = asString(message.content) !== null;
    const hasAttachment = (message.attachments ?? []).length > 0;
    const hasEmbed = (message.embeds ?? []).length > 0;
    if (hasContent || hasAttachment || hasEmbed) withSubstance += 1;
  }
  return { authored, withSubstance };
}

/**
 * True when the only honest explanation is a missing intent or scope.
 *
 * Deliberately requires *zero* substance across the whole sample rather than a
 * ratio: a single message with content proves the bot can read content, and
 * from there a quiet archive is just a quiet archive.
 *
 * Its limits, which is why it is only the backstop (#2317). Without the intent
 * Discord still returns content for the bot's own messages and for messages
 * that mention it, so one of those disarms it for the rest of the slice; a job
 * with fewer than {@link MIN_AUTHORED_MESSAGES_FOR_CONTENT_CHECK} authored
 * messages in a slice never trips it; and it trips on the page in hand, after
 * earlier pages were written. A ratio would close the first gap and open
 * false positives on real archives, so the application-flags read decides the
 * common case instead.
 */
export function isLikelyMissingMessageContentIntent(
  tally: MessageContentTally,
): boolean {
  return (
    tally.authored >= MIN_AUTHORED_MESSAGES_FOR_CONTENT_CHECK &&
    tally.withSubstance === 0
  );
}

/** Where the toggle is, shared by both errors below. */
const INTENT_TOGGLE =
  '"Message Content Intent" for the Frapp application in the Discord ' +
  'Developer Portal (Bot → Privileged Gateway Intents)';

/**
 * The error an admin sees when Discord says the intent is off, which the
 * export asks before writing anything in every slice. Names the exact fix.
 *
 * This slice has written nothing at that point, but earlier slices of the same
 * import may have (the toggle switched off mid-import, a restart of a failed
 * import, or an earlier slice whose read settled nothing), so the count of
 * what the import already holds is reported rather than claimed to be zero.
 *
 * @param alreadyImported messages this import had written before this slice.
 */
export function messageContentIntentOffError(alreadyImported: number): string {
  const cause =
    'Discord reports that the Frapp bot does not have the Message Content Intent ' +
    'enabled, so it could read that messages exist but not what they say. ';
  if (alreadyImported <= 0) {
    return (
      cause +
      `No messages were imported. Enable ${INTENT_TOGGLE}, then start the import again.`
    );
  }
  return (
    cause +
    `Nothing more was imported. This import already holds ${countOf(alreadyImported)} from earlier runs: ` +
    'if the intent was off then too, they are empty, and deleting this import removes everything it brought in. ' +
    `Enable ${INTENT_TOGGLE}, then start the import again.`
  );
}

/**
 * The error an admin sees when the tally trips. Names the exact fix and what
 * it knows was written empty.
 *
 * The tally resets every slice and trips only on zero substance, so every
 * authored message this slice wrote before the trip was blank. It never saw
 * what earlier slices wrote, so those are counted but not called empty: a
 * slice whose flags read failed after the toggle was switched off mid-import
 * follows slices that imported real history (#2317 review).
 *
 * @param written.thisRun messages this slice wrote before the trip.
 * @param written.earlierRuns messages earlier slices of this import wrote.
 */
export function missingMessageContentIntentError(written: {
  thisRun: number;
  earlierRuns: number;
}): string {
  const parts = [
    'Discord returned every message with no content, no attachments and no embeds. ' +
      'That means the Frapp bot does not have the Message Content Intent enabled, ' +
      'so it can read that messages exist but not what they say.',
    written.thisRun > 0
      ? `This run had already written ${countOf(written.thisRun)} before the check could tell, and they are empty.`
      : 'This run wrote no messages. A channel it created for them may already be in Frapp, empty.',
  ];
  if (written.earlierRuns > 0) {
    parts.push(
      `The import also holds ${countOf(written.earlierRuns)} from earlier runs, which this check did not see.`,
    );
  }
  if (written.thisRun > 0 || written.earlierRuns > 0) {
    parts.push('Deleting this import removes everything it brought in.');
  }
  parts.push(`Enable ${INTENT_TOGGLE}, then start the import again.`);
  return parts.join(' ');
}

function countOf(n: number): string {
  return `${n} ${n === 1 ? 'message' : 'messages'}`;
}
