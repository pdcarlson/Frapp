import type {
  BookmarkedMessage,
  ChatMessage,
  StoredBookmarkedMessage,
} from '#domain/entities/chat.entity';
import type {
  MaskedPollMetadata,
  PollWithResults,
} from '#domain/entities/poll-vote.entity';

/**
 * Server-side application of a viewer's block list to chat message rows
 * (#2257), per `spec/behavior/chat/README.md` § The masking contract.
 *
 * **Module-level pure functions rather than methods on a service**, because
 * every read surface that serves message rows to a named viewer owes the same
 * guarantee: the timeline, pins, search, bookmarks, and any future digest or
 * export (the full list is `chat-read-surface-ledger.spec.ts`). Two copies of a
 * masking rule is exactly the drift that leaves one surface honest and the
 * other leaking.
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
 * Whether a row authored by `senderId` is withheld from a viewer whose block
 * list is `blockedUserIds`.
 *
 * The one predicate every surface applies, so the rule that a `null` sender (an
 * imported archive row nobody has linked) is never masked lives in one place.
 * That is correct rather than a gap: blocks are keyed on `users.id`, so there
 * is no user to have blocked. It keys on the sender, never on `kind`: an
 * imported row whose Discord author linked their account carries the member as
 * its sender (#2878) and is masked like anything else they wrote.
 */
export function isFromBlockedSender(
  senderId: string | null,
  blockedUserIds: ReadonlySet<string>,
): boolean {
  return senderId !== null && blockedUserIds.has(senderId);
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
    // A tombstone draws no flag (#3921), so none is served: the flag is a
    // label on content the blocker does not see, and an Important tint on a
    // tombstone would point at the blocked member's message.
    flag: null,
    flagged_by: null,
    flagged_at: null,
    edited_at: message.edited_at,
    is_deleted: message.is_deleted,
    mentions: null,
    // Structure, not content (#3785): kept so a masked reply stays out of the
    // timeline and a masked parent still leads to the other members' replies.
    // The recent repliers are other members, whose ids the chip draws.
    thread_root_id: message.thread_root_id ?? null,
    thread_reply_count: message.thread_reply_count ?? 0,
    thread_last_reply_at: message.thread_last_reply_at ?? null,
    thread_recent_sender_ids: message.thread_recent_sender_ids ?? [],
    // The latest reply is another member's content, which this mask is not
    // about: `maskBlockedMessages` applies the viewer's list to its replier.
    thread_last_reply: message.thread_last_reply ?? null,
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
  message: StoredBookmarkedMessage,
  blockedUserIds: ReadonlySet<string>,
): BookmarkedMessage {
  if (!isFromBlockedSender(message.sender_id, blockedUserIds)) {
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
    thread_root_id: message.thread_root_id,
    sender_blocked: true,
  };
}

/**
 * What a deleted message says instead of its content. Like the block
 * sentinel, a rendering fallback only: the machine-readable signal is
 * `is_deleted`.
 */
export const DELETED_MESSAGE_CONTENT = '[message deleted]';

/**
 * What a soft-deleted message keeps of its `metadata`.
 *
 * Nothing, except an imported row's `discord_import_id`: it is the only key the
 * import purge selects on (`SupabaseDiscordImportRepository.deleteImportedMessages`),
 * so wiping it would leave the tombstone behind when its import is deleted,
 * still carrying the Discord author and an avatar path into purged storage. A
 * linked member can delete their own imported messages (#2878), so this is
 * reachable by any member, not only a moderator.
 */
export function tombstoneMetadata(
  message: Pick<ChatMessage, 'kind' | 'metadata'>,
): Record<string, unknown> {
  if (message.kind !== 'imported') return {};
  const importId: unknown = message.metadata?.discord_import_id;
  return typeof importId === 'string' ? { discord_import_id: importId } : {};
}

/**
 * What a soft-deleted message keeps of its `payload` (#1575).
 *
 * Nothing, for every card kind: the payload is the card's data (an event's
 * name and place, a poll's question and options). An imported row's payload is
 * not a card but the Discord archive sidecar, and keeps `source` and
 * `author_username`: the Discord handle the operator backfills read back to
 * name a member (`backfill-discord-mention-tokens.ts`,
 * `backfill-discord-import-people.ts`), which the row's own `author_name`
 * already shows. Its reactions, stickers and the rest go. The cleanup
 * migration `20261112060000_clear_deleted_message_payloads.sql` writes the
 * same shape, so the two must stay in step.
 */
export function tombstonePayload(
  message: Pick<ChatMessage, 'kind' | 'payload'>,
): Record<string, unknown> | null {
  if (message.kind !== 'imported') return null;
  const username: unknown = message.payload?.author_username;
  return typeof username === 'string'
    ? { source: 'discord', author_username: username }
    : { source: 'discord' };
}

/**
 * A deleted message as any reader is served it: the tombstone and nothing of
 * what it said (#1575).
 *
 * The delete clears `content`, `metadata` and `payload` when it lands
 * (`ChatService.softDeleteMessage`). This is the read half, for a row whose
 * write did not: everything deleted before the delete cleared `payload` still
 * holds a card's data in it (an event's name and place, a poll's question and
 * options). Every read that serves message rows to a member goes through
 * {@link maskBlockedMessages}, which applies this, and the raw answers to
 * unpin, delete and a send's retry apply it themselves (pin refuses a deleted
 * message). It covers the API only: until the cleanup migration runs, those
 * rows are still readable under `chat_messages`' own read policy.
 *
 * Structure stays: ids, kind, timing, pins, thread counts and `is_deleted`,
 * which the client needs to draw the tombstone in place.
 */
export function redactDeletedMessage<T extends ChatMessage>(message: T): T {
  if (!message.is_deleted) return message;
  return {
    ...message,
    content: DELETED_MESSAGE_CONTENT,
    payload: tombstonePayload(message),
    metadata: tombstoneMetadata(message),
  };
}

/**
 * Apply `blockedUserIds` to `messages`, flagging every row.
 *
 * A message is masked when {@link isFromBlockedSender} says so.
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
    withThreadPreviewMasked(
      isFromBlockedSender(message.sender_id, blocked)
        ? maskMessage(message)
        : withFlaggerMasked(
            redactDeletedMessage({ ...message, sender_blocked: false }),
            blocked,
          ),
      blocked,
    ),
  );
}

/**
 * A thread's parent whose latest reply is from a blocked member serves that
 * preview withheld (#4297), whoever wrote the parent, and every other preview
 * flagged clear.
 *
 * The preview is the replier's content riding on someone else's row, so the
 * row's own mask never reaches it: without this, a blocked member's reply
 * would read on the card under any parent. What survives is what the row's own
 * mask keeps of a message (`maskMessage`): the reply's id, its sender and its
 * time, with `sender_blocked: true`. That flag is the server's verdict, which
 * the client carries onto the parent's next Realtime echo (`mergeServerRow`),
 * as it does a masked message's, so a block made on another device holds even
 * where this client's list predates it; and it is how Unblock finds the
 * parents to re-read (`hasMaskedCopyFrom`). Nothing replaces it with the next
 * reply: the trigger keeps one, and the open thread is where the rest are read.
 * The Realtime echo carries the preview raw, and each client applies its own
 * list (`threadPreviewVisible`).
 */
function withThreadPreviewMasked(
  message: MaskedChatMessage,
  blocked: ReadonlySet<string>,
): MaskedChatMessage {
  const preview = message.thread_last_reply;
  if (!preview) return message;
  if (!isFromBlockedSender(preview.sender_id, blocked)) {
    return {
      ...message,
      thread_last_reply: { ...preview, sender_blocked: false },
    };
  }
  return {
    ...message,
    thread_last_reply: {
      id: preview.id,
      sender_id: preview.sender_id,
      content: '',
      kind: null,
      attachment_count: 0,
      created_at: preview.created_at,
      sender_blocked: true,
    },
  };
}

/**
 * A clear message whose flag a blocked member added keeps the flag and loses
 * the flagger (#3921).
 *
 * The flag is chapter state, the same for every reader, which a block counts
 * rather than hides (`spec/behavior/chat/README.md` § What a block does and
 * does not hide), so an Important message stays Important for the blocker.
 * Who added it is the blocked member's own act, so the row reads "Important"
 * with no "flagged by". That holds on the reads that mask, not everywhere a
 * reaction's does (reactions are withheld at RLS, `20260924170000`): the
 * Realtime echo and the pin, unpin and edit answers carry the raw
 * `flagged_by`, and a client applies its own block list to the name. Rows
 * whose flagger is not blocked pass through untouched.
 */
function withFlaggerMasked(
  message: MaskedChatMessage,
  blocked: ReadonlySet<string>,
): MaskedChatMessage {
  if (message.flagged_by == null || !blocked.has(message.flagged_by)) {
    return message;
  }
  return { ...message, flagged_by: null };
}

/**
 * The same rule over the **poll routes' projection** (#2495): `GET /v1/polls`
 * and `GET /v1/polls/{messageId}` serve a poll's message reshaped with its
 * tallies, which {@link maskBlockedMessages} does not fit, for the reason
 * {@link maskBlockedBookmarkMessage} gives. What is shared is the same: the
 * sentinel, `isFromBlockedSender` (so an unlinked imported row is never masked), the
 * allowlist construction, and `sender_blocked` on every row.
 *
 * **Masked in place, not left out.** The tallies are chapter state, which a
 * block counts rather than hides (`spec/behavior/chat/README.md` § What a block
 * does and does not hide), and dropping the row would change the list's counts
 * and paging. So a masked poll keeps its ids, timing, expiry, every
 * `voteCount` and the caller's own `userVotes`, and loses the question, the
 * option text and `content`.
 */
export function maskBlockedPoll(
  poll: Omit<PollWithResults, 'sender_blocked'>,
  blockedUserIds: ReadonlySet<string>,
): PollWithResults {
  if (!isFromBlockedSender(poll.sender_id, blockedUserIds)) {
    return { ...poll, sender_blocked: false };
  }
  const metadata: MaskedPollMetadata = {
    choice_mode: poll.metadata.choice_mode,
    expires_at: poll.metadata.expires_at,
    closed_at: poll.metadata.closed_at,
  };
  return {
    ...poll,
    content: BLOCKED_MESSAGE_CONTENT,
    metadata,
    results: poll.results.map(({ optionIndex, voteCount }) => ({
      optionIndex,
      optionText: null,
      voteCount,
    })),
    sender_blocked: true,
  };
}
