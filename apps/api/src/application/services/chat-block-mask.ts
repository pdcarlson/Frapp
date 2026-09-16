import type {
  BookmarkedMessage,
  ChatMessage,
} from '#domain/entities/chat.entity';

/**
 * Server-side application of a viewer's block list to chat message rows
 * (#2257), per `spec/behavior/chat/README.md` § The masking contract.
 *
 * **A module-level pure function rather than a method on a service**, because
 * more than one read surface owes the same guarantee — `ChatService.getMessages`
 * today, and any future timeline, digest or export that serves message rows to
 * a named viewer. Two copies of a masking rule is exactly the drift that leaves
 * one surface honest and the other leaking.
 *
 * It takes an already-resolved set of blocked user ids rather than fetching one,
 * so it stays synchronous and testable, and so the caller decides how a failed
 * block-list read is handled. That decision is not incidental: the contract says
 * "a block list that cannot be read is not an empty block list", so a caller
 * must let the error propagate rather than defaulting to an empty set, which
 * would fail open on a safety feature.
 */

/**
 * What a masked message says instead of its content.
 *
 * **Nothing downstream may key off this string.** It is a rendering fallback for
 * a client that has not applied its own list, and the contract is explicit that
 * a client which pattern-matches it "inherits a contract the server never
 * promised, and silently stops masking the day that string changes". The
 * machine-readable signal is {@link MaskedChatMessage.sender_blocked}, which is
 * on every row this function returns.
 */
export const BLOCKED_MESSAGE_CONTENT = '[message from a blocked member]';

/**
 * A message row as a read surface serves it, carrying the explicit masking flag.
 *
 * `sender_blocked` is present on **every** row, not only the masked ones. An
 * absent-means-false flag is the same coupling as a sentinel string with extra
 * steps: a client cannot tell "this server does not mask" from "this message is
 * fine", and the first surface that forgets to map its rows degrades silently.
 */
export interface MaskedChatMessage extends ChatMessage {
  sender_blocked: boolean;
}

/**
 * Rebuild one message with every author-supplied field withheld.
 *
 * **An allowlist, not a denylist**, for the reason `redactBookmarkedMessage`
 * gives: a column added to `ChatMessage` later is withheld by default and has to
 * be let through deliberately, where a denylist would serve it to a blocker
 * automatically with nothing failing.
 *
 * What survives is the structure a thread needs to render a tombstone in the
 * right place — ids, ordering, threading, and the pinned/deleted/edited flags.
 * What does not survive is everything a blocked member controls:
 *
 * - `content`, obviously.
 * - `payload`, because a points / task / event card is authored by the acting
 *   member (those services pass the actor, not the system id) and its template
 *   interpolates member free text. Exempting cards would hand a blocked member
 *   an unmaskable channel into the blocker's timeline.
 * - `metadata`, which carries `attachment_count` — the only way a client learns
 *   it should fetch a message's files. Dropping it is what stops a masked
 *   message pulling the blocked member's uploads.
 * - `mentions`, because a mention overrides a per-channel mute in the push
 *   rules and drives an "you were mentioned" affordance; leaving it would let a
 *   blocked member keep poking the blocker through a masked row.
 * - the three `author_*` columns, which are free text from an imported archive.
 *
 * `sender_id` is deliberately kept. The blocker chose the block and the list is
 * theirs to read back, so it is not a disclosure — and without it the client
 * cannot reconcile a server-masked row against the list it applies itself.
 *
 * **`external_message_id` is absent, and its absence is the uniformity rule
 * working.** The allowlist is over the fields a *served* row actually has, not
 * over every field `ChatMessage` declares: `CHAT_MESSAGE_COLUMNS` deliberately
 * omits that column — no client reads a Discord snowflake — so a clear row has
 * never carried it. Rebuilding it here gave masked rows one key more than clear
 * ones, which is precisely the shape difference the uniform rebuild below
 * exists to remove. A column added to `CHAT_MESSAGE_COLUMNS` later still has to
 * be added here deliberately; one that is not served must not appear here at
 * all.
 */
function maskMessage(message: ChatMessage): MaskedChatMessage {
  return {
    id: message.id,
    channel_id: message.channel_id,
    sender_id: message.sender_id,
    author_name: null,
    author_avatar_path: null,
    author_external_id: null,
    content: BLOCKED_MESSAGE_CONTENT,
    type: message.type,
    kind: message.kind ?? null,
    payload: null,
    client_message_id: message.client_message_id ?? null,
    reply_to_id: message.reply_to_id,
    metadata: {},
    is_pinned: message.is_pinned,
    pinned_at: message.pinned_at,
    edited_at: message.edited_at,
    is_deleted: message.is_deleted,
    mentions: null,
    created_at: message.created_at,
    sender_blocked: true,
  };
}

/**
 * The same rule over the bookmarks endpoint's **nine-field projection**.
 *
 * A separate function rather than a call to {@link maskBlockedMessages}, and
 * the reason is the projection itself. `BookmarkedMessage` is narrow as a
 * disclosure control, not as a size optimization: serving the whole
 * `ChatMessage` there once shipped the `payload` of a deleted poll or event
 * card on an endpoint whose declared type says the message reads
 * `[message deleted]`. Routing bookmarks through the timeline's masker would
 * hand every row eleven extra fields and undo that, which is a worse leak than
 * the one being fixed.
 *
 * What is shared is what must not drift: the sentinel, the "flag every row"
 * rule, the allowlist construction, and the `sender_id: null` carve-out for an
 * imported archive row. They are shared by living in this module, next to each
 * other, rather than by one calling the other over a shape it does not fit.
 *
 * `sender_id` survives here as it does above — the blocker owns their own list
 * — and so does `is_deleted`, which is not author-controlled content and which
 * the panel needs to render the row at all.
 */
export function maskBlockedBookmarkMessage(
  message: BookmarkedMessage,
  blockedUserIds: ReadonlySet<string>,
): BookmarkedMessage {
  if (message.sender_id === null || !blockedUserIds.has(message.sender_id)) {
    return { ...message, sender_blocked: false };
  }
  return {
    id: message.id,
    channel_id: message.channel_id,
    sender_id: message.sender_id,
    author_name: null,
    author_avatar_path: null,
    author_external_id: null,
    content: BLOCKED_MESSAGE_CONTENT,
    is_deleted: message.is_deleted,
    created_at: message.created_at,
    sender_blocked: true,
  };
}

/**
 * Apply `blockedUserIds` to `messages`, flagging every row.
 *
 * A message is masked when its `sender_id` is in the set. An imported archive
 * row (`sender_id: null`) is never masked, which is correct rather than a gap:
 * blocks are keyed on `users.id`, so there is no user to have blocked.
 *
 * Rows are rebuilt even when nothing is blocked. That is a deliberate
 * allocation: it is what makes `sender_blocked` mean "the server evaluated your
 * list and this row is clear" on every surface, instead of a flag whose absence
 * a client has to guess at.
 */
export function maskBlockedMessages(
  messages: ChatMessage[],
  blockedUserIds: Iterable<string>,
): MaskedChatMessage[] {
  const blocked = new Set(blockedUserIds);

  return messages.map((message) =>
    message.sender_id !== null && blocked.has(message.sender_id)
      ? maskMessage(message)
      : { ...message, sender_blocked: false },
  );
}
