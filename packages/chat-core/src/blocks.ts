/**
 * The block contract every chat client applies on top of the server's mask
 * (#2257, #2313, #2315): `spec/behavior/chat/README.md` § The masking contract.
 * The mobile thread and the web timeline both classify through this module,
 * so the two cannot disagree about what a blocked member's row may show.
 *
 * The server masks what it serves, but the Realtime `postgres_changes` echo
 * delivers the raw row with no viewer attached, so the thread applies the
 * viewer's own list on top. Three inputs decide what a row may show:
 *
 * - **Provenance** — `ChatMessage._blockEvaluated`, set by `normalizeRow` when
 *   the raw row carried `sender_blocked`, i.e. it came through a REST read the
 *   server ran the list over. The echo (INSERT and UPDATE) and the viewer's own
 *   send/edit responses are unevaluated — except that an echo overwriting a
 *   server-masked row keeps its `sender_blocked` (`mergeServerRow`), because
 *   the server's verdict on that message stands.
 * - **The block list** — `useBlockedUserIds()` in `@repo/hooks`, tri-state,
 *   with every change this client confirmed applied on top. Its ids are a floor
 *   in every status: anyone on it is known-blocked.
 * - **This session's clearances** — rows already shown against a `ready` list,
 *   and server-cleared rows shown while it was loading or unavailable
 *   (`rowsToRemember`, `blockClearance`), so a later list outage does not take
 *   back messages the viewer legitimately read.
 *
 * **Nothing here reads `content`.** The server's masking sentinel is a
 * rendering detail of one code path, and a client that pattern-matches it
 * silently stops masking the day it changes. `blocks.spec.ts` pins that.
 *
 * **Nothing here reads `created_at` either.** A timestamp says when a row was
 * written, not how it reached the cache — an UPDATE echo re-delivers a row
 * under the `created_at` it was read with — so a watermark can only proxy for
 * provenance, and the design this replaced failed on that proxy (#2315).
 *
 * **No React.** This package stays framework-free, so the two session stores
 * below (`blockClearance`, `maskedRefresh`) are plain subscribable objects;
 * each client reads them through its own `useSyncExternalStore`.
 */

import type { QueryClient } from "@tanstack/react-query";
import type { createFrappClient } from "@repo/api-sdk";
import { SYSTEM_SENDER_ID, type BlockListStatus } from "@repo/validation";
import {
  HELD_QUOTE_TEXT,
  TOMBSTONE_STALE_TEXT,
  TOMBSTONE_TEXT,
} from "./block-copy";
import { mergeServerRow, trimOlderThan } from "./cache";
import {
  CHAT_MESSAGE_QUERY_ROOT,
  chatMessagesChannelId,
  chatMessagesKey,
  type ChannelCache,
  type ChatMessage,
  type ForwardedFrom,
  type RawChatMessage,
  type ReactionState,
} from "./types";

export interface BlockState {
  status: BlockListStatus;
  /** A floor, never a ceiling — see `BlockedUserIds.ids` in `@repo/hooks`. */
  ids: ReadonlySet<string>;
  /**
   * Senders this client confirmed unblocking, uncontradicted since — the only
   * proof a block ended. See `BlockedUserIds.unblocked` in `@repo/hooks`.
   */
  unblocked: ReadonlySet<string>;
  /**
   * Message ids already shown this session — against a `ready` list, or as a
   * server-cleared row while the list was not ready (`rowsToRemember`,
   * `blockClearance`). Consulted only once the list is no longer ready.
   */
  cleared: ReadonlySet<string>;
}

/**
 * - `visible` renders normally.
 * - `tombstone` renders as "Message from a member you blocked", with nothing
 *   the sender wrote — no body, attachments, reactions or card.
 * - `held` does not render at all; the thread says messages are being held.
 */
export type MessageVisibility = "visible" | "tombstone" | "held";

type ClassifiedFields = Pick<
  ChatMessage,
  "id" | "sender_id" | "sender_blocked" | "_blockEvaluated"
>;

/**
 * Whether a sender can be on anyone's block list at all.
 *
 * `null` is an imported archive row whose Discord author has not linked their
 * account (no Frapp user behind it — blocks are keyed on `users.id`). A linked
 * row carries the member as its sender (#2878) and is blockable like anything
 * else they wrote. The system actor is refused by the API: blocking it
 * would silently mask the welcome post, the audit bridge and invite DMs.
 */
export function isBlockableSender(senderId: string | null): senderId is string {
  return senderId !== null && senderId !== SYSTEM_SENDER_ID;
}

/**
 * What one message may show, given where it came from and the viewer's list.
 *
 * Order matters and each step is the narrowest safe claim:
 *
 * 1. The viewer's own message is always visible — you cannot block yourself.
 * 2. A row the server evaluated and masked is a tombstone whatever the list
 *    now says: its content was withheld, so there is nothing else to draw.
 *    So is an echo that overwrote such a row — `mergeServerRow` carries the
 *    server's `sender_blocked` onto it — because its body is exactly what the
 *    mask withheld and a list that reads ready may predate a block made on
 *    another device. It yields only to an unblock this client confirmed,
 *    which applies in every list state like any confirmed change. Nothing
 *    dates the verdict against that unblock, so a member unblocked here and
 *    re-blocked elsewhere shows when their masked row is echoed, until a list
 *    read succeeds — for a whole outage if the list is unavailable (#2499).
 * 3. A sender nobody can block (imported, system) cannot be hidden by a list.
 * 4. A sender on the list is a tombstone on **every** path — including a row
 *    the server cleared before the block was made, and a row cleared earlier
 *    this session.
 * 5. A row the server evaluated and cleared is visible.
 * 6. An unevaluated row is visible against a list known to be current.
 * 7. …and, once that list is loading or unavailable, only if this client
 *    confirmed unblocking its sender (a confirmed change applies in every list
 *    state, and nothing since has contradicted it — see `BlockState.unblocked`)
 *    or it was already shown earlier this session — against a current list,
 *    or as a server-cleared row since replaced by an unevaluated echo (a pin,
 *    an edit). Anything else is held (fail closed): an unevaluated row that
 *    first arrives during an outage never renders until the list is back.
 */
export function classifyMessage(
  message: ClassifiedFields,
  blockState: BlockState,
  viewerId: string | null,
): MessageVisibility {
  const sender = message.sender_id;
  if (viewerId !== null && sender === viewerId) return "visible";
  if (message.sender_blocked) {
    if (message._blockEvaluated) return "tombstone";
    if (sender === null || !blockState.unblocked.has(sender))
      return "tombstone";
  }
  if (!isBlockableSender(sender)) return "visible";
  if (blockState.ids.has(sender)) return "tombstone";
  if (message._blockEvaluated) return "visible";
  if (blockState.status === "ready") return "visible";
  if (blockState.unblocked.has(sender)) return "visible";
  return blockState.cleared.has(message.id) ? "visible" : "held";
}

/**
 * Whether the thread card may show its latest reply's preview (#4297).
 *
 * The preview is the replier's words on the parent's row, so it is
 * classified as the replier's own message would be, with the parent's
 * provenance and the server's verdict on the preview itself: a REST read
 * withholds a blocked replier's preview (`chat-block-mask.ts`,
 * `sender_blocked: true`, kept onto later echoes by `mergeServerRow`), so one
 * it served clear was cleared; the parent's Realtime echo carries it raw. Anything short of `visible` shows no
 * preview: there is no tombstone line on a card, and a held one fails
 * closed until the list is back. The card itself stays either way.
 */
export function threadPreviewVisible(
  reply: { id: string; sender_id: string | null; sender_blocked?: boolean },
  parent: Pick<ChatMessage, "_blockEvaluated">,
  blockState: BlockState,
  viewerId: string | null,
): boolean {
  return (
    classifyMessage(
      {
        id: reply.id,
        sender_id: reply.sender_id,
        sender_blocked: reply.sender_blocked === true,
        _blockEvaluated: parent._blockEvaluated,
      },
      blockState,
      viewerId,
    ) === "visible"
  );
}

/**
 * The placeholder a forward's card draws for a copy the viewer's block list
 * hides (#4864), or `null` when the copy may be drawn.
 *
 * The copy is its original author's words riding on the forwarder's row, so
 * it is classified as the author's own message would be, with the row's
 * provenance and the server's verdict on the copy itself, the way
 * `threadPreviewVisible` classifies a thread card's preview: a REST read
 * withholds a blocked author's copy (`sender_blocked: true`, carried onto
 * later echoes by `mergeServerRow`), and the row's Realtime echo carries it
 * raw. The words match `hiddenQuoteText`: the tombstone's for a blocked
 * author, "Message hidden" while the list can't be read. A copy whose
 * original was deleted holds nothing to hide, so it is never masked.
 */
export function hiddenForwardedText(
  forwarded: Pick<
    ForwardedFrom,
    "message_id" | "sender_id" | "sender_blocked" | "deleted"
  >,
  message: Pick<ChatMessage, "_blockEvaluated">,
  blockState: BlockState,
  viewerId: string | null,
): string | null {
  if (forwarded.deleted) return null;
  const author = { sender_id: forwarded.sender_id };
  switch (
    classifyMessage(
      {
        id: forwarded.message_id,
        sender_id: forwarded.sender_id,
        sender_blocked: forwarded.sender_blocked,
        _blockEvaluated: message._blockEvaluated,
      },
      blockState,
      viewerId,
    )
  ) {
    case "visible":
      return null;
    case "held":
      return HELD_QUOTE_TEXT;
    case "tombstone":
      return tombstoneCanUnblock(author, blockState)
        ? TOMBSTONE_TEXT
        : TOMBSTONE_STALE_TEXT;
  }
}

/** Whether a forward's copy may be drawn: `hiddenForwardedText` is `null`. */
export function forwardedSnapshotVisible(
  forwarded: Pick<
    ForwardedFrom,
    "message_id" | "sender_id" | "sender_blocked" | "deleted"
  >,
  message: Pick<ChatMessage, "_blockEvaluated">,
  blockState: BlockState,
  viewerId: string | null,
): boolean {
  return hiddenForwardedText(forwarded, message, blockState, viewerId) === null;
}

/**
 * The message with its forward's copy emptied when the viewer's list hides
 * it (#4864): no text, GIF or files, and `sender_blocked: true`, the shape
 * the server masks it to. Anything that reads the copy without drawing the
 * card (a reply quote's `replyPreviewText`, "Copy text"'s `copyableText`)
 * goes through this, so it can't print what the card hides. Returns the same
 * object when there is nothing to mask.
 */
export function withForwardedMasked<
  M extends Pick<ChatMessage, "forwarded_from" | "_blockEvaluated">,
>(message: M, blockState: BlockState, viewerId: string | null): M {
  const copy = message.forwarded_from;
  if (!copy || forwardedSnapshotVisible(copy, message, blockState, viewerId)) {
    return message;
  }
  return {
    ...message,
    forwarded_from: {
      ...copy,
      content: "",
      gif: null,
      attachment_count: 0,
      sender_blocked: true,
    },
  };
}

/**
 * Whether a tombstone should offer Unblock.
 *
 * The one case with nothing to undo is a server-masked copy left over from
 * before an unblock **this client confirmed** (the unblock re-reads each
 * thread's newest page, not its whole history). A ready list that merely lacks
 * the sender is not that: a masked row for someone off a ready list is exactly
 * what a block made on another device looks like until the list is re-read
 * (`contradictingRows`), so the control stays — unblocking is idempotent and
 * harmless if the block had in fact ended.
 */
export function tombstoneCanUnblock(
  message: Pick<ChatMessage, "sender_id">,
  blockState: BlockState,
): boolean {
  if (!isBlockableSender(message.sender_id)) return false;
  if (blockState.ids.has(message.sender_id)) return true;
  return !blockState.unblocked.has(message.sender_id);
}

export interface ThreadRow {
  message: ChatMessage;
  visibility: Exclude<MessageVisibility, "held">;
}

export interface BlockedThread {
  /** What the list renders, in the input order. Held rows are absent. */
  rows: ThreadRow[];
  /** How many rows were held back, for the thread-level notice. */
  heldCount: number;
}

/** Classifies a whole thread in one pass. */
export function applyBlockList(
  messages: readonly ChatMessage[],
  blockState: BlockState,
  viewerId: string | null,
): BlockedThread {
  const rows: ThreadRow[] = [];
  let heldCount = 0;
  for (const message of messages) {
    const visibility = classifyMessage(message, blockState, viewerId);
    if (visibility === "held") heldCount += 1;
    else rows.push({ message, visibility });
  }
  return { rows, heldCount };
}

/**
 * The rows `blockClearance` should remember, so a later outage cannot take
 * back a message the viewer has already been shown.
 *
 * - **Against a ready list:** every row it shows from a blockable sender who is
 *   not the viewer.
 * - **Against a list that is loading or unavailable:** only the rows the server
 *   evaluated and cleared. Nothing else shown then is new: a row visible
 *   because this client confirmed an unblock needs no memory (that change
 *   applies in every list state), and one visible on an earlier clearance is
 *   already remembered.
 *
 * **Server-evaluated rows included, in both states.** Their provenance does not
 * last: a Realtime UPDATE echo of the row — a pin, an edit, a soft delete —
 * replaces it through `mergeServerRow` as an unevaluated row, and without a
 * clearance a message read over REST and then pinned during a list outage would
 * vanish mid-read — including when the list had never been ready at all, as on
 * a cold start whose block-list read failed (#2257 review). Tombstones are
 * never recorded, and nothing recorded outranks a block: the classifier reads
 * the list first.
 */
export function rowsToRemember(
  rows: readonly ThreadRow[],
  viewerId: string | null,
  listIsReady: boolean,
): string[] {
  const cleared: string[] = [];
  for (const { message, visibility } of rows) {
    if (visibility !== "visible") continue;
    if (!isBlockableSender(message.sender_id)) continue;
    if (message.sender_id === viewerId) continue;
    if (!listIsReady && !message._blockEvaluated) continue;
    cleared.push(message.id);
  }
  return cleared;
}

/**
 * The masked REST rows a `ready` list is contradicted by: a row that arrived
 * with `sender_blocked: true` for a sender the list does not name. That is what
 * a block made on another device looks like until this client re-reads the
 * list, so the thread re-reads it once per distinct set of these rows.
 *
 * **Keyed on rows, not senders, and a sender this client unblocked still
 * counts.** Their older masked copies are leftovers of that unblock and cost
 * one re-read, because they are the same rows on every pass. A masked copy that
 * arrives *after* the unblock — the member blocked again on another device — is
 * a new row, so it is a new question; skipping the unblocked sender, or keying
 * on the sender alone, would leave that block unread until something else
 * refreshed the list.
 *
 * Nothing is a contradiction while the list is not ready, since a stale list
 * proves nothing. Sorted, so the thread can compare sets by joining them.
 */
export function contradictingRows(
  messages: readonly ChatMessage[],
  blockState: BlockState,
): string[] {
  if (blockState.status !== "ready") return [];
  const rows: string[] = [];
  for (const message of messages) {
    if (!message._blockEvaluated) continue;
    // The row's own sender, or its thread preview's replier (#4297).
    const masked = [
      message.sender_blocked ? message.sender_id : null,
      message.thread?.last_reply?.sender_blocked
        ? message.thread.last_reply.sender_id
        : null,
      // A forward's copy of a blocked author's message (#4864).
      message.forwarded_from?.sender_blocked
        ? message.forwarded_from.sender_id
        : null,
    ];
    if (
      masked.some(
        (sender) => isBlockableSender(sender) && !blockState.ids.has(sender),
      )
    ) {
      rows.push(message.id);
    }
  }
  return rows.sort();
}

/**
 * The reactions a viewer may see on any message, as a fresh `ReactionState`.
 *
 * A reaction is its author's own text (`reaction:` plus up to 41 characters),
 * so the block list applies to every reactor on every message — the reactions
 * row of `spec/behavior/chat/README.md` § What a block does and does not hide.
 * The `chat_message_actions` read policy withholds a blocked member's reaction
 * rows too (#2494), but only as of each read: rows this client cached before a
 * block, made here or on another device, are still in the cache.
 *
 * - **Ready:** every reactor except the ones on the list.
 * - **Loading or unavailable:** the viewer's own reactions, and those of
 *   members this client confirmed unblocking (a confirmed change applies in
 *   every list state). Anyone else could still be blocked, and a reaction has
 *   no provenance to vouch for it, so this fails closed the way held messages
 *   do.
 *
 * A chip's count is therefore the reactors the viewer can see, not the total —
 * true of a hidden blocked reactor in every status, and of everyone else while
 * the thread's notice says the list could not load. Emptied groups drop out.
 *
 * Returns `reactions` itself when nothing was hidden, so a row whose reactions
 * pass untouched keeps its message's identity and a card's memoized tally.
 */
export function visibleReactions(
  reactions: ReactionState,
  blockState: BlockState,
  viewerId: string | null,
): ReactionState {
  const visible: ReactionState = {};
  let hidden = false;
  for (const [actionType, userIds] of Object.entries(reactions)) {
    if (!Array.isArray(userIds)) {
      hidden = true;
      continue;
    }
    const shown = userIds.filter(
      (userId) => userId === viewerId || isVisibleMember(userId, blockState),
    );
    if (shown.length !== userIds.length) hidden = true;
    if (shown.length > 0) visible[actionType] = shown;
  }
  return hidden ? visible : reactions;
}

/**
 * The typing indicator after the viewer's block list (#2496).
 *
 * `typing` is a Broadcast on `chat:channel:<id>`, and anyone who can read the
 * channel may send one, so the server delivers a blocked member's too. The
 * indicator names the typist ("Winston is typing…", `typingLabel`), so it
 * would tell the blocker, live, that the member they blocked is writing in a
 * channel they share, and in a two-person DM that they are writing to them.
 * So both clients pass the manager's list through this before rendering it.
 *
 * Everyone else goes by a reaction chip's rule (`visibleReactions`), for the
 * same reason: against a ready list a blocked member is dropped; while the
 * list is loading or unavailable only a member this client just unblocked
 * counts, failing closed. An indicator missing for the length of a list read
 * costs nothing.
 *
 * Unlike a chip, the viewer never counts. `broadcast: { self: false }` only
 * spares the socket that sent it, so the viewer typing on another device
 * arrives here too, and the indicator never reports the viewer's own typing
 * (`spec/ui/resilience/message-delivery.md`).
 *
 * It trusts the broadcast's `userId`, which the sender's client writes. That
 * is the limit of a client-list rule, tracked in #2725.
 *
 * Returns `userIds` itself when nothing was dropped, so a caller comparing by
 * identity does not re-render for an unchanged list.
 */
export function visibleTypingUsers(
  userIds: readonly string[],
  blockState: BlockState,
  viewerId: string | null,
): readonly string[] {
  const shown = userIds.filter(
    (userId) => userId !== viewerId && isVisibleMember(userId, blockState),
  );
  return shown.length === userIds.length ? userIds : shown;
}

/**
 * Whether another member's own action (a reaction, a typing broadcast, the
 * name on a flag they added, #3921) may show: against a ready list unless
 * they are on it, and while the list is not ready only once this client
 * confirmed unblocking them. Callers decide what
 * the viewer's own actions do.
 */
export function isVisibleMember(
  userId: string,
  blockState: BlockState,
): boolean {
  return blockState.status === "ready"
    ? !blockState.ids.has(userId)
    : blockState.unblocked.has(userId);
}

/**
 * Replaces the server-masked copies of one sender's messages with the fresh
 * rows a re-read returned, and touches nothing else.
 *
 * This is what Unblock uses to bring a member's words back, and it is narrow on
 * purpose (#2257 review, finding 3). It runs against the cache **as it is when
 * the response lands**, never a snapshot taken before the request: a Realtime
 * row, a send or a delete that landed in between is still there afterwards.
 * A thread parent whose latest-reply preview the server withheld for this
 * sender (#4297) is a masked copy too, of the preview: it is swapped when the
 * re-read serves that preview clear, under the same evaluated-only guard.
 * And it only ever swaps a masked row for its clear twin — it never adds a row
 * the cache no longer holds (that would resurrect a deleted message) and never
 * overwrites one the echo has updated since. That row is no longer a *masked
 * copy*: its `sender_blocked` may still be true (a verdict `mergeServerRow`
 * carried over), but its body is the echo's, so the guard below requires
 * `_blockEvaluated` as well. It needs no swap — once this client has
 * confirmed the unblock, `classifyMessage` shows it as it stands.
 */
export function replaceMaskedCopies(
  cache: ChannelCache,
  rows: readonly RawChatMessage[],
  senderId: string,
): ChannelCache {
  let next = cache;
  for (const row of rows) {
    const cached = next.byId[row.id];
    if (!cached || !cached._blockEvaluated) continue;
    if (row.sender_id === senderId && row.sender_blocked === false) {
      if (cached.sender_blocked) next = mergeServerRow(next, row);
      continue;
    }
    // Another member's thread parent whose latest-reply preview the server
    // withheld for this sender (#4297), now served clear.
    const fresh = row.thread_last_reply;
    if (
      typeof row.sender_blocked === "boolean" &&
      maskedPreviewFrom(cached, senderId) &&
      fresh?.sender_id === senderId &&
      fresh.sender_blocked === false
    ) {
      next = mergeServerRow(next, row);
      continue;
    }
    // A forward whose copy of this sender's message the server withheld
    // (#4864), now served clear.
    const copy = row.forwarded_from;
    if (
      typeof row.sender_blocked === "boolean" &&
      maskedForwardFrom(cached, senderId) &&
      copy?.sender_id === senderId &&
      copy.sender_blocked === false
    ) {
      next = mergeServerRow(next, row);
    }
  }
  return next;
}

/** A REST-evaluated forward whose copy the server withheld for `senderId`. */
function maskedForwardFrom(message: ChatMessage, senderId: string): boolean {
  const copy = message.forwarded_from;
  return (
    message._blockEvaluated &&
    copy?.sender_blocked === true &&
    copy.sender_id === senderId
  );
}

/** A REST-evaluated parent whose preview the server withheld for `senderId`. */
function maskedPreviewFrom(message: ChatMessage, senderId: string): boolean {
  const reply = message.thread?.last_reply;
  return (
    message._blockEvaluated &&
    reply?.sender_blocked === true &&
    reply.sender_id === senderId
  );
}

/**
 * Whether a channel cache holds a server-masked copy from this sender — an
 * evaluated row with its masked body, not an echo carrying the verdict (see
 * `replaceMaskedCopies`) — or a thread parent whose latest-reply preview the
 * server withheld for them (#4297).
 */
export function hasMaskedCopyFrom(
  cache: ChannelCache | undefined,
  senderId: string,
): boolean {
  if (!cache) return false;
  return Object.values(cache.byId).some(
    (message) =>
      (message.sender_id === senderId &&
        message._blockEvaluated &&
        message.sender_blocked) ||
      maskedPreviewFrom(message, senderId) ||
      maskedForwardFrom(message, senderId),
  );
}

/**
 * The placeholder a reply quote draws for a parent the list hides, or `null`
 * when the parent may be quoted. Consistent with what the parent's own row
 * shows: the tombstone's words (stale when this client unblocked them since),
 * or "Message hidden" for a parent held while the list is unreadable.
 *
 * A block that hid the message but let a reply print it would hide nothing, so
 * this decides from the parent's own classification — including a raw parent
 * that arrived over the Realtime echo, which the server never masked (#2312 §1).
 */
export function hiddenQuoteText(
  parent: ChatMessage,
  blockState: BlockState,
  viewerId: string | null,
): string | null {
  switch (classifyMessage(parent, blockState, viewerId)) {
    case "visible":
      return null;
    case "held":
      return HELD_QUOTE_TEXT;
    case "tombstone":
      return tombstoneCanUnblock(parent, blockState)
        ? TOMBSTONE_TEXT
        : TOMBSTONE_STALE_TEXT;
  }
}

/**
 * One step of a thread's "re-read a contradicted list" rule, as a pure
 * function so both clients' hooks run the same decision.
 *
 * `contradicted` is `contradictingRows(...)` joined; `reconciledFor` is the set
 * this thread last re-read for. The list is re-read once per distinct set, not
 * once per read: a masked copy that outlived an unblock keeps contradicting the
 * list, and re-reading on every answer would poll. The set is forgotten once a
 * **ready** list stops being contradicted — a list that is loading or
 * unavailable reports no contradiction because it proves nothing, and
 * forgetting then would re-read on every recovery — so the same rows
 * contradicting it again later (the member blocked again elsewhere) are a new
 * question.
 */
export function reconcileContradiction(
  contradicted: string,
  listIsReady: boolean,
  reconciledFor: string,
): { reconciledFor: string; reread: boolean } {
  if (contradicted === "") {
    return { reconciledFor: listIsReady ? "" : reconciledFor, reread: false };
  }
  if (contradicted === reconciledFor) return { reconciledFor, reread: false };
  return { reconciledFor: contradicted, reread: true };
}

const NO_IDS: ReadonlySet<string> = new Set();

/** A subscribable store, the shape `useSyncExternalStore` reads. */
function listenerSet() {
  const listeners = new Set<() => void>();
  return {
    subscribe(listener: () => void): () => void {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    emit() {
      for (const listener of listeners) listener();
    },
  };
}

const clearanceListeners = listenerSet();
let clearanceScope: string | null = null;
let clearedIds: ReadonlySet<string> = NO_IDS;

/**
 * Messages this session has already shown against a `ready` block list, or
 * that the server cleared (#2257 review, finding 4).
 *
 * A row that arrived over the Realtime echo is never server-evaluated, and it
 * never will be: the reconnect backfill and the polling fallback read only rows
 * after the last-seen cursor, and every echo advances that cursor. A row read
 * over REST loses its evaluation the same way the moment an UPDATE echo of it —
 * a pin, an edit, a soft delete — is merged over it. So without a memory, a
 * later block-list outage would flip messages the viewer had already read back
 * to held — a conversation vanishing mid-read. Recording every row a ready list
 * showed, and every server-cleared row shown while it was not
 * (`rowsToRemember`), keeps what was legitimately seen on screen, while an
 * unevaluated row that first arrives *during* an outage is still held
 * (`classifyMessage`).
 *
 * What it does not do: override a block. The list is consulted before this, so
 * a member blocked since — here, or on another device once the list re-reads —
 * is tombstoned whatever this remembers.
 *
 * **Scope.** In memory, for the life of the JS runtime (a browser tab, or the
 * app process), and keyed on the viewer's `users.id`: a different viewer starts
 * empty. Chapters need no key of their own, because message ids are globally
 * unique and a row from one chapter never renders in another.
 *
 * A module-level store read through `useSyncExternalStore` rather than a ref,
 * because it is read during render, and reading a ref there is exactly what
 * `react-hooks/refs` forbids — and what a compiled component may memoize past.
 */
export const blockClearance = {
  subscribe: clearanceListeners.subscribe,

  /** The ids recorded for this viewer; empty for anyone else. */
  snapshot(viewerId: string | null): ReadonlySet<string> {
    return viewerId !== null && viewerId === clearanceScope
      ? clearedIds
      : NO_IDS;
  },

  /**
   * Remember message ids this viewer has been shown (`rowsToRemember`). A
   * different viewer than the last one recorded for starts a fresh set.
   * Notifies only when something new was added.
   */
  record(viewerId: string, messageIds: readonly string[]): void {
    if (clearanceScope !== viewerId) {
      clearanceScope = viewerId;
      clearedIds = NO_IDS;
    }
    const added = messageIds.filter((id) => !clearedIds.has(id));
    if (added.length === 0) return;
    const next = new Set(clearedIds);
    for (const id of added) next.add(id);
    clearedIds = next;
    clearanceListeners.emit();
  },

  /** Test seam: forget everything. */
  reset(): void {
    clearanceScope = null;
    clearedIds = NO_IDS;
    clearanceListeners.emit();
  },
};

/**
 * Where one member's post-unblock re-read stands (`refreshMaskedCopies`):
 *
 * - `refreshing` — a re-read for this member is in flight (retries included).
 * - `failed` — the last one gave up with at least one thread unread.
 * - absent — nothing to report: none ran, or the last one landed.
 */
export type MaskedRefreshState = "refreshing" | "failed";

const NO_REFRESHES: ReadonlyMap<string, MaskedRefreshState> = new Map();
const refreshListeners = listenerSet();
let refreshStates: ReadonlyMap<string, MaskedRefreshState> = NO_REFRESHES;

/**
 * Each member's post-unblock re-read, so a stale tombstone can offer a way
 * back when it did not land (#2257 review).
 *
 * After an unblock this client confirmed, a server-masked copy of that
 * member's message stops offering Unblock — there is nothing left to undo —
 * and only the re-read can bring its words back. When that re-read fails for
 * good, a tombstone with no control would strand the copy until the thread
 * happened to reload, with nothing on screen saying anything could be done.
 * Recording the failure is what lets the tombstone offer Reload instead.
 *
 * **Scope.** In memory, for the life of the JS runtime, keyed on the member's
 * `users.id`. It needs no chapter or viewer key: it only ever decorates a
 * tombstone the current chapter's list already classified as a stale masked
 * copy, and a Reload re-runs the re-read against whatever the cache holds now.
 */
export const maskedRefresh = {
  subscribe: refreshListeners.subscribe,

  snapshot(): ReadonlyMap<string, MaskedRefreshState> {
    return refreshStates;
  },

  /** Record a member's state; `null` clears it. Notifies only on a change. */
  set(userId: string, state: MaskedRefreshState | null): void {
    if ((refreshStates.get(userId) ?? null) === state) return;
    const next = new Map(refreshStates);
    if (state === null) next.delete(userId);
    else next.set(userId, state);
    refreshStates = next.size === 0 ? NO_REFRESHES : next;
    refreshListeners.emit();
  },

  /** Test seam: forget everything. */
  reset(): void {
    refreshStates = NO_REFRESHES;
    refreshListeners.emit();
  },
};

type FrappClient = ReturnType<typeof createFrappClient>;

/** Rows per page of the re-read. Under the API's cap of 200. */
export const MASKED_REFRESH_PAGE_LIMIT = 100;

/**
 * Pages one thread's re-read may take: five thousand messages. Past it the
 * rows the read did not reach are trimmed from the thread rather than left as
 * copies no read will clear (`refreshMaskedCopies`).
 */
export const MASKED_REFRESH_MAX_PAGES = 50;

/** Epoch ms of the oldest server-masked copy from this sender, or `null`. */
function oldestMaskedCopyTime(
  cache: ChannelCache | undefined,
  senderId: string,
): number | null {
  if (!cache) return null;
  let oldest: number | null = null;
  for (const message of Object.values(cache.byId)) {
    const ownMasked =
      message.sender_id === senderId &&
      message._blockEvaluated &&
      message.sender_blocked;
    // A parent holding this sender's withheld preview is read back to by its
    // own place in the thread (#4297).
    if (
      !ownMasked &&
      !maskedPreviewFrom(message, senderId) &&
      !maskedForwardFrom(message, senderId)
    ) {
      continue;
    }
    const time = Date.parse(message.created_at);
    if (oldest === null || time < oldest) oldest = time;
  }
  return oldest;
}

/** Waits between attempts of one thread's re-read: two retries, then give up. */
export const MASKED_REFRESH_RETRY_DELAYS_MS: readonly number[] = [1_000, 3_000];

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * After an unblock, bring the member's words back where the server had masked
 * them — out of band, and never by re-running a thread's query.
 *
 * Re-running the query (the old `invalidateQueries(["chat"])`) re-ran its
 * snapshot-then-await `queryFn`, which returns the cache as it was before its
 * reaction select: a Realtime row or a send that landed in that window was
 * overwritten, and a message could vanish for the session (#2257 review,
 * finding 3). Here each affected thread is read on its own, newest page first
 * and back page by page until the read reaches the oldest masked copy the
 * cache holds, and each page is folded into the cache **as it is when the
 * response lands**, through `replaceMaskedCopies`, which only swaps masked
 * copies for their clear twins.
 *
 * Only threads that hold a masked copy from this member are read. Reading
 * back to the oldest copy, not just the newest page, is what older history
 * needs (#1571): a thread holds the older pages a member scrolled through
 * until it next reads its newest page from scratch (a refetch, or a jump's
 * forward read that comes back full), and an unblock re-runs no query, so a
 * copy there would otherwise stay a stale tombstone whose Reload could never
 * reach it.
 *
 * **A failure is retried, then recorded — never swallowed.** Each thread's read
 * is tried up to `1 + retryDelaysMs.length` times, and a thread that no longer
 * holds a masked copy by the next attempt (reloaded, or another re-read landed)
 * counts as done. If one still fails, `maskedRefresh` records it and the stale
 * tombstones for that member offer Reload, which runs this again: after a
 * confirmed unblock the tombstone has no Unblock to offer, and without that
 * record the copies would be stranded with no control at all. The unblock
 * itself is unaffected either way — it succeeded, and the thread already shows
 * the member's live messages because the client applies the list itself.
 *
 * Resolves `true` when every affected thread was read. Never rejects.
 *
 * A block needs no counterpart. The thread tombstones a blocked sender on every
 * path from the list alone, so there is nothing to re-read.
 */
export async function refreshMaskedCopies(
  queryClient: QueryClient,
  client: FrappClient,
  userId: string,
  retryDelaysMs: readonly number[] = MASKED_REFRESH_RETRY_DELAYS_MS,
): Promise<boolean> {
  const holdsMaskedCopy = (channelId: string) =>
    hasMaskedCopyFrom(
      queryClient.getQueryData<ChannelCache>(chatMessagesKey(channelId)),
      userId,
    );

  const channelIds = queryClient
    .getQueryCache()
    .findAll({ queryKey: [CHAT_MESSAGE_QUERY_ROOT] })
    .map((query) => chatMessagesChannelId(query.queryKey))
    .filter((channelId): channelId is string => channelId !== null)
    .filter(holdsMaskedCopy);

  if (channelIds.length === 0) {
    maskedRefresh.set(userId, null);
    return true;
  }
  maskedRefresh.set(userId, "refreshing");

  /**
   * One thread's read, newest page back to its oldest masked copy, folded in
   * page by page. `false` on a failed request; the retry resumes from `read`,
   * the cursor the last successful page left, rather than re-reading the
   * pages before it.
   *
   * The cursor overlaps by a millisecond, as the timeline's older-history read
   * does, so a copy sharing the boundary instant with the page before it is
   * not skipped; `replaceMaskedCopies` is idempotent, so the overlap costs
   * nothing. The stop is strict for the same reason: a page whose oldest row
   * shares the copy's millisecond may still have cut it off.
   *
   * **The bound is not a failure.** Past `MASKED_REFRESH_MAX_PAGES` the rows
   * the read did not reach are trimmed from the thread, masked copies with
   * them, and the read counts as done. They load again, from the server and
   * so unmasked, when the member next scrolls back to them. Reporting it as a
   * failure instead offered a Reload that walked the same pages and failed
   * the same way, every time.
   */
  async function readMaskedRange(
    channelId: string,
    read: { before?: string; pages: number; reachedTime?: number },
  ): Promise<boolean> {
    const key = chatMessagesKey(channelId);
    try {
      while (read.pages < MASKED_REFRESH_MAX_PAGES) {
        const target = oldestMaskedCopyTime(
          queryClient.getQueryData<ChannelCache>(key),
          userId,
        );
        if (target === null) return true;
        const result = await client.GET("/v1/channels/{id}/messages", {
          params: {
            path: { id: channelId },
            query: {
              limit: MASKED_REFRESH_PAGE_LIMIT,
              ...(read.before ? { before: read.before } : {}),
            },
          },
        });
        if (!result.response.ok || !Array.isArray(result.data)) return false;
        const rows = result.data as RawChatMessage[];
        read.pages += 1;
        queryClient.setQueryData<ChannelCache>(key, (current) =>
          current ? replaceMaskedCopies(current, rows, userId) : current,
        );
        if (rows.length < MASKED_REFRESH_PAGE_LIMIT) return true;
        const pageOldest = rows.reduce((oldest, row) =>
          Date.parse(row.created_at) < Date.parse(oldest.created_at)
            ? row
            : oldest,
        );
        const pageOldestTime = Date.parse(pageOldest.created_at);
        if (pageOldestTime < target) return true;
        const overlapping = new Date(pageOldestTime + 1).toISOString();
        // A full page inside one millisecond would never move the overlapping
        // cursor, so the strict one takes over.
        read.before =
          overlapping === read.before ? pageOldest.created_at : overlapping;
        read.reachedTime = pageOldestTime;
      }
      if (read.reachedTime !== undefined) {
        // Inclusive of the last page's millisecond: the page may have cut
        // off rows in it, a masked copy among them, and the read goes on only
        // while its oldest row is not strictly older than the copy. Rows the
        // page did carry in that millisecond go too, and reload on scroll.
        const through = read.reachedTime + 1;
        queryClient.setQueryData<ChannelCache>(key, (current) =>
          current ? trimOlderThan(current, through) : current,
        );
      }
      return true;
    } catch {
      return false;
    }
  }

  const results = await Promise.all(
    channelIds.map(async (channelId) => {
      const read: { before?: string; pages: number; reachedTime?: number } = {
        pages: 0,
      };
      for (let attempt = 0; ; attempt += 1) {
        if (await readMaskedRange(channelId, read)) return true;
        const delay = retryDelaysMs[attempt];
        if (delay === undefined) return false;
        await wait(delay);
        if (!holdsMaskedCopy(channelId)) return true;
      }
    }),
  );

  const landed = results.every(Boolean);
  maskedRefresh.set(userId, landed ? null : "failed");
  return landed;
}
