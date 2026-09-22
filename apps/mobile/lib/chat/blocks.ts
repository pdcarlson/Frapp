/**
 * The mobile chat client's half of the block contract (#2257, #2315):
 * `spec/behavior/chat/README.md` § The masking contract.
 *
 * The server masks what it serves, but the Realtime `postgres_changes` echo
 * delivers the raw row with no viewer attached, so the thread applies the
 * viewer's own list on top. Three inputs decide what a row may show:
 *
 * - **Provenance** — `ChatMessage._blockEvaluated`, set by `@repo/chat-core`'s
 *   `normalizeRow` when the raw row carried `sender_blocked`, i.e. it came
 *   through a REST read the server ran the list over. The echo (INSERT and
 *   UPDATE) and the viewer's own send/edit responses are unevaluated.
 * - **The block list** — `useBlockedUserIds()`, tri-state, with every change
 *   this client confirmed applied on top. Its ids are a floor in every status:
 *   anyone on it is known-blocked.
 * - **This session's clearances** — rows already shown against a `ready` list
 *   (`block-clearance.ts`), so a later list outage does not take back messages
 *   the viewer legitimately read.
 *
 * **Nothing here reads `content`.** The server's masking sentinel is a
 * rendering detail of one code path, and a client that pattern-matches it
 * silently stops masking the day it changes. `blocks.spec.ts` pins that.
 *
 * **Nothing here reads `created_at` either.** A timestamp says when a row was
 * written, not how it reached the cache, and REST and Realtime serialize
 * `timestamptz` differently — the watermark design this replaced was a no-op
 * for exactly that reason (#2315).
 */

import { mergeServerRow } from "@repo/chat-core/cache";
import type {
  ChannelCache,
  ChatMessage,
  RawChatMessage,
  ReactionState,
} from "@repo/chat-core/types";
import type { BlockListStatus } from "@repo/hooks";
import { SYSTEM_SENDER_ID } from "@repo/validation";

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
   * Message ids already shown against a `ready` list this session
   * (`block-clearance.ts`). Consulted only once the list is no longer ready.
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
 * `null` is an imported archive row (no Signet user behind it — blocks are
 * keyed on `users.id`), and the system actor is refused by the API: blocking it
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
 * 3. A sender nobody can block (imported, system) cannot be hidden by a list.
 * 4. A sender on the list is a tombstone on **every** path — including a row
 *    the server cleared before the block was made, and a row cleared earlier
 *    this session.
 * 5. A row the server evaluated and cleared is visible.
 * 6. An unevaluated row is visible against a list known to be current.
 * 7. …and, once that list is loading or unavailable, only if it was already
 *    shown against a current list earlier this session. Anything else is held
 *    (fail closed): a row that first arrives during an outage never renders
 *    until the list is back.
 */
export function classifyMessage(
  message: ClassifiedFields,
  blockState: BlockState,
  viewerId: string | null,
): MessageVisibility {
  const sender = message.sender_id;
  if (viewerId !== null && sender === viewerId) return "visible";
  if (message._blockEvaluated && message.sender_blocked) return "tombstone";
  if (!isBlockableSender(sender)) return "visible";
  if (blockState.ids.has(sender)) return "tombstone";
  if (message._blockEvaluated) return "visible";
  if (blockState.status === "ready") return "visible";
  return blockState.cleared.has(message.id) ? "visible" : "held";
}

/**
 * Whether a tombstone should offer Unblock.
 *
 * The one case with nothing to undo is a server-masked copy left over from
 * before an unblock **this client confirmed** (the unblock re-reads each
 * thread's newest page, not its whole history). A ready list that merely lacks
 * the sender is not that: a masked row for someone off a ready list is exactly
 * what a block made on another device looks like until the list is re-read
 * (`contradictedSenders`), so the control stays — unblocking is idempotent and
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
 * The rows a `ready` list is the only reason to show — unevaluated, from a
 * blockable sender who is not the viewer — for `block-clearance.ts` to
 * remember. Rows the server evaluated need no memory: their provenance already
 * survives an outage.
 */
export function rowsClearedByReadyList(
  rows: readonly ThreadRow[],
  viewerId: string | null,
): string[] {
  const cleared: string[] = [];
  for (const { message, visibility } of rows) {
    if (visibility !== "visible" || message._blockEvaluated) continue;
    if (!isBlockableSender(message.sender_id)) continue;
    if (message.sender_id === viewerId) continue;
    cleared.push(message.id);
  }
  return cleared;
}

/**
 * Senders a `ready` list says are not blocked but a server read says are: a
 * REST row arrived masked (`sender_blocked: true`) for someone off the list.
 * That is what a block made on another device looks like until this client
 * re-reads the list, so the thread re-reads it once per distinct set.
 *
 * A sender this client confirmed unblocking is not a contradiction — their
 * older masked copies are expected leftovers — and nothing is a contradiction
 * while the list is not ready, since a stale list proves nothing. Sorted, so
 * the thread can compare sets by joining them.
 */
export function contradictedSenders(
  messages: readonly ChatMessage[],
  blockState: BlockState,
): string[] {
  if (blockState.status !== "ready") return [];
  const senders = new Set<string>();
  for (const message of messages) {
    const sender = message.sender_id;
    if (!message._blockEvaluated || !message.sender_blocked) continue;
    if (!isBlockableSender(sender)) continue;
    if (blockState.ids.has(sender) || blockState.unblocked.has(sender)) {
      continue;
    }
    senders.add(sender);
  }
  return [...senders].sort();
}

/**
 * The reactions a viewer may see on any message, as a fresh `ReactionState`.
 *
 * A reaction is its author's own text (`reaction:` plus up to 41 characters),
 * and nothing masks it server-side (#2324), so the block list applies to every
 * reactor on every message — not only on the blocker's own messages, as the
 * spec's table puts it, because a blocked member's reaction on anyone's
 * message still reaches the blocker's screen.
 *
 * - **Ready:** every reactor except the ones on the list.
 * - **Loading or unavailable:** the viewer's own reactions only. A reactor who
 *   is not on a stale list could still be blocked, and a reaction has no
 *   provenance to vouch for it, so this fails closed the way held messages do.
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
    const shown = userIds.filter((userId) =>
      userId === viewerId
        ? true
        : blockState.status === "ready" && !blockState.ids.has(userId),
    );
    if (shown.length !== userIds.length) hidden = true;
    if (shown.length > 0) visible[actionType] = shown;
  }
  return hidden ? visible : reactions;
}

/**
 * Replaces the server-masked copies of one sender's messages with the fresh
 * rows a re-read returned, and touches nothing else.
 *
 * This is what Unblock uses to bring a member's words back, and it is narrow on
 * purpose (#2257 review, finding 3). It runs against the cache **as it is when
 * the response lands**, never a snapshot taken before the request: a Realtime
 * row, a send or a delete that landed in between is still there afterwards.
 * And it only ever swaps a masked row for its clear twin — it never adds a row
 * the cache no longer holds (that would resurrect a deleted message) and never
 * overwrites one the echo has updated since (that row is no longer masked, so
 * it no longer matches).
 */
export function replaceMaskedCopies(
  cache: ChannelCache,
  rows: readonly RawChatMessage[],
  senderId: string,
): ChannelCache {
  let next = cache;
  for (const row of rows) {
    if (row.sender_id !== senderId || row.sender_blocked !== false) continue;
    const cached = next.byId[row.id];
    if (!cached || !cached._blockEvaluated || !cached.sender_blocked) continue;
    next = mergeServerRow(next, row);
  }
  return next;
}

/** Whether a channel cache holds a server-masked copy from this sender. */
export function hasMaskedCopyFrom(
  cache: ChannelCache | undefined,
  senderId: string,
): boolean {
  if (!cache) return false;
  return Object.values(cache.byId).some(
    (message) =>
      message.sender_id === senderId &&
      message._blockEvaluated &&
      message.sender_blocked,
  );
}

/**
 * The thread-level notice for a block list that is not `ready`, or `null`.
 *
 * Unavailable always says so, even with nothing held — the spec requires the
 * member to be told, and the ids the thread is still applying may be stale.
 * Loading stays quiet unless it is actually holding something, because the
 * first read usually lands before anything could arrive.
 */
export function blockListNotice(
  status: BlockListStatus,
  heldCount: number,
): { title: string; body: string; canRetry: boolean } | null {
  const held =
    heldCount === 1
      ? "1 new message is"
      : heldCount > 1
        ? `${heldCount} new messages are`
        : "New messages are";
  if (status === "unavailable") {
    return {
      title: "Couldn't load your block list",
      body: `${held} held until it loads, so nothing from a member you blocked shows by mistake.`,
      canRetry: true,
    };
  }
  if (status === "loading" && heldCount > 0) {
    return {
      title: "Checking your block list",
      body: `${held} held until it loads.`,
      canRetry: false,
    };
  }
  return null;
}

export interface MessageActions {
  /** Whether the long-press sheet opens at all. */
  canOpen: boolean;
  canReport: boolean;
  canBlock: boolean;
}

const NO_ACTIONS: MessageActions = {
  canOpen: false,
  canReport: false,
  canBlock: false,
};

/**
 * Whether a `users.id` is a member of the active chapter, from the roster the
 * screen already holds: `true` or `false` once the roster has loaded, `null`
 * while it has not (or failed), when nothing can be said either way.
 */
export type MemberLookup = (userId: string) => boolean | null;

export function rosterMembership(roster: {
  byId: Readonly<Record<string, string>>;
  isPending: boolean;
  isError: boolean;
}): MemberLookup {
  if (roster.isPending || roster.isError) return () => null;
  return (userId) => Object.prototype.hasOwnProperty.call(roster.byId, userId);
}

/**
 * Whether a message offers the actions sheet at all — the first three rules
 * below, which need no roster. What a row's long-press is gated on.
 */
export function canOpenMessageActions(
  message: Pick<ChatMessage, "sender_id" | "_status" | "is_deleted">,
  viewerId: string | null,
): boolean {
  if (viewerId === null) return false;
  if (message.sender_id === viewerId) return false;
  return message._status === "confirmed" && !message.is_deleted;
}

/**
 * Which member-safety actions a message offers.
 *
 * - **Never on your own message.** There is nothing to report or block.
 * - **Confirmed rows only.** A pending or failed row carries a client id the
 *   API has never seen, so a report against it would 404.
 * - **Not on a deleted row.** Its content already reads `[message deleted]`,
 *   and the report would snapshot exactly that.
 * - **Block needs a blockable sender who is still a member** — not the system
 *   actor, not an imported row, and not someone the loaded roster no longer
 *   lists: `POST /v1/chat/blocks` refuses a non-member with a 404. An unknown
 *   roster still offers Block, and the confirmation reports a 404 honestly.
 *   Report stays in every case: an imported row names its author in
 *   `author_name`, which the API snapshots into the report for exactly that.
 *
 * A tombstoned row never reaches this: the thread renders it without the sheet.
 */
export function messageActionsFor(
  message: Pick<ChatMessage, "sender_id" | "_status" | "is_deleted">,
  viewerId: string | null,
  isMember: MemberLookup,
): MessageActions {
  if (!canOpenMessageActions(message, viewerId)) return NO_ACTIONS;
  return {
    canOpen: true,
    canReport: true,
    canBlock:
      isBlockableSender(message.sender_id) &&
      isMember(message.sender_id) !== false,
  };
}
