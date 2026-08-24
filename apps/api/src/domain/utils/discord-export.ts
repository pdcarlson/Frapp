/**
 * Parsing and mapping for a DiscordChatExporter (DCE) JSON export.
 *
 * Pure and I/O-free on purpose: this is the part of the importer where the
 * damage is silent. A wrong `created_at` writes an entire chapter's history at
 * import time and nobody notices until somebody scrolls; a dropped author name
 * violates a CHECK thousands of rows in. Keeping it a function of its input
 * means the whole mapping is testable against fixtures without a database, a
 * storage bucket, or a Discord export.
 *
 * The shapes below are transcribed from DCE's own `JsonMessageWriter.cs`, not
 * from a sample: a sample only proves what one export happened to contain.
 * Every field is optional on the way in — an export is a foreign artifact and a
 * missing key is a data problem to report, never a crash.
 */

/** A Discord user as DCE writes it. */
export interface DiscordExportUser {
  id?: string | null;
  name?: string | null;
  discriminator?: string | null;
  nickname?: string | null;
  color?: string | null;
  isBot?: boolean | null;
  roles?: { id?: string | null; name?: string | null }[] | null;
  /** With `--media`, an export-relative path. Without it, a CDN URL. */
  avatarUrl?: string | null;
}

export interface DiscordExportAttachment {
  id?: string | null;
  /** With `--media`, an export-relative path. Without it, a CDN URL. */
  url?: string | null;
  fileName?: string | null;
  fileSizeBytes?: number | null;
}

export interface DiscordExportReaction {
  emoji?: {
    id?: string | null;
    name?: string | null;
    code?: string | null;
    isAnimated?: boolean | null;
  } | null;
  count?: number | null;
  /** Deliberately never read — see `summariseReactions`. */
  users?: unknown[] | null;
}

export interface DiscordExportMessage {
  id?: string | null;
  type?: string | null;
  timestamp?: string | null;
  timestampEdited?: string | null;
  isPinned?: boolean | null;
  content?: string | null;
  author?: DiscordExportUser | null;
  attachments?: DiscordExportAttachment[] | null;
  embeds?: unknown[] | null;
  stickers?: { name?: string | null }[] | null;
  reactions?: DiscordExportReaction[] | null;
  reference?: {
    messageId?: string | null;
    channelId?: string | null;
    guildId?: string | null;
  } | null;
}

export interface DiscordExportPreamble {
  guild: { id: string | null; name: string | null };
  channel: {
    id: string | null;
    name: string | null;
    category: string | null;
  };
}

export interface DiscordExportPart extends DiscordExportPreamble {
  messages: DiscordExportMessage[];
}

/** Thrown for an input that is not a usable DCE export part. */
export class DiscordExportFormatError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'DiscordExportFormatError';
  }
}

/**
 * At most this many distinct emoji are summarised onto one message.
 *
 * A cap rather than the whole array because `payload` is stored per row: a
 * message that collected 90 distinct reactions is a curiosity, not 90 facts
 * worth carrying on every read of that row forever.
 */
export const MAX_SUMMARISED_REACTIONS = 20;

function asString(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

/**
 * Read the `{guild, channel}` header off a part.
 *
 * Used both by the browser (against the first 64 KB of a file, to build the
 * mapping step without uploading anything) and by the worker (against the real
 * part it is about to import).
 *
 * **The worker's copy is the authoritative one.** The wizard sends the channel
 * ids it read client-side, but the import keys every message on the id read
 * here, from the bytes actually being parsed — so a client that lied about
 * which channel a part belongs to cannot redirect a Discord channel's history
 * into a Signet channel the admin did not choose.
 */
/**
 * Find the structural `"messages"` KEY, not the first occurrence of the text.
 *
 * `indexOf('"messages"')` is wrong in a way that only shows up on real data: a
 * guild with a channel or category literally named `messages` puts
 * `"name":"messages"` in the preamble, the cut lands mid-object, and the parse
 * fails — so that channel silently disappears from the mapping step and its
 * whole history is skipped with a warning. (The case the original comment
 * defended against — a topic reading "read the pinned messages" — was never a
 * problem: unquoted prose does not match `"messages"` at all.)
 *
 * A key is a quoted string followed by optional whitespace and a colon, at
 * nesting depth 1, outside any string. Tracking depth and string state is
 * enough here; the preamble has no escapes worth a full parser.
 */
function findMessagesKey(input: string): number {
  let depth = 0;
  let inString = false;
  let escaped = false;

  for (let i = 0; i < input.length; i += 1) {
    const ch = input[i];

    if (inString) {
      if (escaped) escaped = false;
      else if (ch === '\\') escaped = true;
      else if (ch === '"') inString = false;
      continue;
    }

    if (ch === '"') {
      // A key only counts at the top level of the root object, and only when a
      // colon follows the closing quote.
      if (depth === 1 && input.startsWith('"messages"', i)) {
        const after = input.slice(i + '"messages"'.length).match(/^\s*:/);
        if (after) return i;
      }
      inString = true;
      continue;
    }

    if (ch === '{' || ch === '[') depth += 1;
    else if (ch === '}' || ch === ']') depth -= 1;
  }
  return -1;
}

export function parseExportPreamble(
  input: string,
): DiscordExportPreamble | null {
  const guildStart = input.indexOf('"guild"');
  if (guildStart === -1) return null;

  // Truncate at the messages array and close the object, so a 400 MB file can
  // be described from its first few KB.
  const messagesKey = findMessagesKey(input);
  const head =
    messagesKey === -1
      ? input
      : `${input.slice(0, messagesKey).replace(/,\s*$/, '')}}`;

  let parsed: unknown;
  try {
    parsed = JSON.parse(head);
  } catch {
    return null;
  }

  const root = asRecord(parsed);
  const guild = asRecord(root?.guild);
  const channel = asRecord(root?.channel);
  if (!channel) return null;

  return {
    guild: { id: asString(guild?.id), name: asString(guild?.name) },
    channel: {
      id: asString(channel.id),
      name: asString(channel.name),
      category: asString(channel.category),
    },
  };
}

/** Parse a whole export part. Throws `DiscordExportFormatError` on junk. */
export function parseExportPart(bytes: Uint8Array): DiscordExportPart {
  let parsed: unknown;
  try {
    parsed = JSON.parse(new TextDecoder().decode(bytes));
  } catch (error) {
    throw new DiscordExportFormatError(
      `Not valid JSON: ${error instanceof Error ? error.message : String(error)}`,
    );
  }

  const root = asRecord(parsed);
  if (!root) {
    throw new DiscordExportFormatError('Export part is not a JSON object.');
  }
  const channel = asRecord(root.channel);
  if (!channel || !asString(channel.id)) {
    throw new DiscordExportFormatError(
      'Export part has no channel id — is this a DiscordChatExporter JSON export?',
    );
  }
  if (!Array.isArray(root.messages)) {
    throw new DiscordExportFormatError('Export part has no messages array.');
  }

  const guild = asRecord(root.guild);
  return {
    guild: { id: asString(guild?.id), name: asString(guild?.name) },
    channel: {
      id: asString(channel.id),
      name: asString(channel.name),
      category: asString(channel.category),
    },
    messages: root.messages as DiscordExportMessage[],
  };
}

/**
 * The display name to store on the message.
 *
 * `nickname` first because that is what the channel actually showed at the
 * time, which is what an archive is for. Falls back through `name` to a literal
 * so the result is never empty: `chat_messages_author_present` requires a
 * non-null `author_name` on every null-sender row, so returning null here would
 * fail the insert for the whole batch.
 */
export function resolveAuthorName(author: DiscordExportUser | null): string {
  return (
    asString(author?.nickname) ??
    asString(author?.name) ??
    'Unknown Discord user'
  );
}

export interface DiscordReactionSummary {
  emoji: string;
  name: string | null;
  count: number;
}

/**
 * Collapse a message's reactions to emoji + count.
 *
 * Per-reactor attribution is **not** preserved, and cannot be: both
 * `message_reactions.user_id` and `chat_message_actions.user_id` are NOT NULL
 * foreign keys to `users`, and phase 1 rejected minting a `users` row per
 * Discord handle on the record (a row there is reachable from the chapter
 * roster, the members directory, mention resolution and `anonymize_user`).
 *
 * So this is the honest middle: no count is lost, no identity is invented.
 * DCE's `reactions[].users[]` — a full user object per reactor — is dropped
 * deliberately. It is unbounded, PII-shaped, and meaningless without accounts
 * to attach it to.
 */
export function summariseReactions(
  message: DiscordExportMessage,
): DiscordReactionSummary[] {
  const reactions = Array.isArray(message.reactions) ? message.reactions : [];
  const out: DiscordReactionSummary[] = [];
  for (const reaction of reactions) {
    if (out.length >= MAX_SUMMARISED_REACTIONS) break;
    const emoji =
      asString(reaction?.emoji?.name) ?? asString(reaction?.emoji?.code);
    if (!emoji) continue;
    const count = typeof reaction?.count === 'number' ? reaction.count : 0;
    if (count <= 0) continue;
    out.push({ emoji, name: asString(reaction?.emoji?.code), count });
  }
  return out;
}

/** The archive sidecar stored on `chat_messages.payload`. */
export interface DiscordImportPayload {
  source: 'discord';
  message_type: string | null;
  author_username: string | null;
  author_is_bot: boolean;
  reactions: DiscordReactionSummary[];
  /** Set when the reply target was outside the export and could not resolve. */
  reply_to_external_id?: string;
  /**
   * Discord had this message pinned.
   *
   * Recorded rather than imported as `is_pinned`. Signet caps a channel at
   * `MAX_PINNED_MESSAGES` (50) as a service rule with no database constraint
   * behind it, so importing a channel with 200 pins would silently blow past a
   * limit the product enforces on every other surface — and would bury whatever
   * the chapter has actually chosen to pin. The fact survives here; the live
   * pin slots stay the chapter's to spend.
   */
  was_pinned_at_source?: true;
  sticker_names?: string[];
  embed_count?: number;
}

export function buildImportPayload(
  message: DiscordExportMessage,
  unresolvedReplyTo: string | null,
): DiscordImportPayload {
  const stickers = (Array.isArray(message.stickers) ? message.stickers : [])
    .map((sticker) => asString(sticker?.name))
    .filter((name): name is string => name !== null);
  const embedCount = Array.isArray(message.embeds) ? message.embeds.length : 0;

  const payload: DiscordImportPayload = {
    source: 'discord',
    message_type: asString(message.type),
    author_username: asString(message.author?.name),
    author_is_bot: message.author?.isBot === true,
    reactions: summariseReactions(message),
  };
  if (unresolvedReplyTo) payload.reply_to_external_id = unresolvedReplyTo;
  if (message.isPinned === true) payload.was_pinned_at_source = true;
  if (stickers.length > 0) payload.sticker_names = stickers;
  if (embedCount > 0) payload.embed_count = embedCount;
  return payload;
}

/** Every distinct Discord role named on a message author in this part. */
export function collectRoles(
  messages: DiscordExportMessage[],
): Map<string, string> {
  const roles = new Map<string, string>();
  for (const message of messages) {
    for (const role of message.author?.roles ?? []) {
      const id = asString(role?.id);
      if (!id || roles.has(id)) continue;
      roles.set(id, asString(role?.name) ?? id);
    }
  }
  return roles;
}

/**
 * A `chat_messages` row the importer is about to write.
 *
 * A domain shape, not `TablesInsert<'chat_messages'>`: `TablesInsert` lives in
 * `infrastructure/`, and the dependency direction is Interface → Application →
 * Domain ← Infrastructure. The repository translates this at the boundary.
 */
export interface ImportedMessageRow {
  channel_id: string;
  sender_id: null;
  author_name: string;
  author_avatar_path: string | null;
  author_external_id: string | null;
  external_message_id: string;
  content: string;
  type: 'TEXT';
  kind: 'imported';
  payload: DiscordImportPayload;
  metadata: Record<string, unknown>;
  reply_to_id: string | null;
  is_pinned: false;
  edited_at: string | null;
  mentions: string[];
  created_at: string;
}

export interface ToImportedMessageArgs {
  message: DiscordExportMessage;
  /** The Signet channel, resolved from the preamble the WORKER read. */
  channelId: string;
  importId: string;
  /** Resolves an export-relative asset path to a stored object path. */
  resolveAssetPath: (relativePath: string) => string | null;
  /** Resolves a Discord snowflake to an already-imported Signet message id. */
  resolveReplyTarget: (externalMessageId: string) => string | null;
  attachmentCount: number;
}

/**
 * Map one Discord message onto a `chat_messages` row.
 *
 * Returns null for a message with no id or no timestamp — both are required to
 * place it, and a message that cannot be placed is a warning for the admin, not
 * a row with invented values.
 */
export function toImportedMessage(
  args: ToImportedMessageArgs,
): ImportedMessageRow | null {
  const { message, channelId, importId, attachmentCount } = args;
  const externalMessageId = asString(message.id);
  const timestamp = asString(message.timestamp);
  if (!externalMessageId || !timestamp) return null;

  const replyToExternalId = asString(message.reference?.messageId);
  const replyToId = replyToExternalId
    ? args.resolveReplyTarget(replyToExternalId)
    : null;

  const avatarRelative = asString(message.author?.avatarUrl);
  const avatarPath = avatarRelative
    ? args.resolveAssetPath(avatarRelative)
    : null;

  return {
    channel_id: channelId,
    // Always null. An imported author is a name on a message, never an account
    // — see the phase-1 migration header for why synthetic `users` rows were
    // rejected.
    sender_id: null,
    author_name: resolveAuthorName(message.author ?? null),
    author_avatar_path: avatarPath,
    author_external_id: asString(message.author?.id),
    external_message_id: externalMessageId,
    content: asString(message.content) ?? '',
    // The CHECK on `type` allows only TEXT and POLL; `kind` carries the real
    // distinction.
    type: 'TEXT',
    kind: 'imported',
    payload: buildImportPayload(
      message,
      replyToExternalId && !replyToId ? replyToExternalId : null,
    ),
    metadata: {
      // What the purge deletes on. Without it, "the messages belonging to this
      // import" is unanswerable for a channel two imports merged into.
      discord_import_id: importId,
      // What tells a client there are attachments to fetch — a Realtime row
      // cannot carry a join, so an attachment-only message renders as an empty
      // bubble without this.
      attachment_count: attachmentCount,
    },
    reply_to_id: replyToId,
    // Never imported — see `was_pinned_at_source` on the payload.
    is_pinned: false,
    edited_at: asString(message.timestampEdited),
    // Never resolved. A mention overrides a per-channel mute in the push rules,
    // and imported prose is full of `@name` tokens; resolving them would let an
    // archive lift a mute every member had deliberately set.
    mentions: [],
    // THE line this whole feature turns on. The column defaults to `now()`, so
    // omitting it would stamp a decade of history with the import's wall clock.
    created_at: timestamp,
  };
}

/** An attachment row the importer is about to write, minus the message id. */
export interface ImportedAttachmentRow {
  bucket: string;
  storage_path: string;
  filename: string;
  content_type: string | null;
  byte_size: number | null;
  /**
   * Always null for an import.
   *
   * The column exists for a source-system URL, but with `--media` DCE has
   * already rewritten every URL to an export-relative path, so there is no CDN
   * link in the export to keep — and storing one would be a private-bucket
   * bypass that outlives its own signature. Retrying is "re-upload the file and
   * re-run", which `discord_import_files` already expresses.
   */
  external_url: null;
}

export interface ToImportedAttachmentsResult {
  rows: ImportedAttachmentRow[];
  /** Export-relative paths with no uploaded file behind them. */
  unresolved: string[];
}

export function toImportedAttachments(
  message: DiscordExportMessage,
  resolveAsset: (relativePath: string) => {
    bucket: string;
    storage_path: string;
    content_type: string | null;
  } | null,
): ToImportedAttachmentsResult {
  const rows: ImportedAttachmentRow[] = [];
  const unresolved: string[] = [];
  const seen = new Set<string>();

  for (const attachment of message.attachments ?? []) {
    const relative = asString(attachment?.url);
    if (!relative) continue;
    const resolved = resolveAsset(relative);
    if (!resolved) {
      unresolved.push(relative);
      continue;
    }
    // `chat_message_attachments` is UNIQUE on (message_id, bucket,
    // storage_path). DCE deduplicates identical media, so one message quoting
    // the same file twice would otherwise fail the whole batch insert.
    const key = `${resolved.bucket}:${resolved.storage_path}`;
    if (seen.has(key)) continue;
    seen.add(key);

    rows.push({
      bucket: resolved.bucket,
      storage_path: resolved.storage_path,
      filename:
        asString(attachment?.fileName) ??
        relative.split('/').pop() ??
        'attachment',
      content_type: resolved.content_type,
      byte_size:
        typeof attachment?.fileSizeBytes === 'number' &&
        attachment.fileSizeBytes >= 0
          ? attachment.fileSizeBytes
          : null,
      external_url: null,
    });
  }

  return { rows, unresolved };
}
