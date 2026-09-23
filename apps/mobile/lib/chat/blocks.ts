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
 * - **This session's clearances** — rows already shown against a `ready` list,
 *   and server-cleared rows shown while it was loading or unavailable
 *   (`rowsToRemember`, `block-clearance.ts`), so a later list outage does not
 *   take back messages the viewer legitimately read.
 *
 * **Nothing here reads `content`.** The server's masking sentinel is a
 * rendering detail of one code path, and a client that pattern-matches it
 * silently stops masking the day it changes. `blocks.spec.ts` pins that.
 *
 * **Nothing here reads `created_at` either.** A timestamp says when a row was
 * written, not how it reached the cache — an UPDATE echo re-delivers a row
 * under the `created_at` it was read with — so a watermark can only proxy for
 * provenance, and the design this replaced failed on that proxy (#2315).
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
   * Message ids already shown this session — against a `ready` list, or as a
   * server-cleared row while the list was not ready (`rowsToRemember`,
   * `block-clearance.ts`). Consulted only once the list is no longer ready.
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
 *    So is an echo that overwrote such a row — `mergeServerRow` carries the
 *    server's `sender_blocked` onto it — unless this client has since
 *    confirmed unblocking the sender. Its body is exactly what the mask
 *    withheld, and a list that reads ready may predate a block made on
 *    another device.
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
    if (sender === null || !blockState.unblocked.has(sender)) return "tombstone";
  }
  if (!isBlockableSender(sender)) return "visible";
  if (blockState.ids.has(sender)) return "tombstone";
  if (message._blockEvaluated) return "visible";
  if (blockState.status === "ready") return "visible";
  if (blockState.unblocked.has(sender)) return "visible";
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
 * The rows `block-clearance.ts` should remember, so a later outage cannot take
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
    const sender = message.sender_id;
    if (!message._blockEvaluated || !message.sender_blocked) continue;
    if (!isBlockableSender(sender) || blockState.ids.has(sender)) continue;
    rows.push(message.id);
  }
  return rows.sort();
}

/**
 * The reactions a viewer may see on any message, as a fresh `ReactionState`.
 *
 * A reaction is its author's own text (`reaction:` plus up to 41 characters),
 * and nothing masks it server-side (#2324), so the block list applies to every
 * reactor on every message — the reactions row of
 * `spec/behavior/chat/README.md` § What a block does and does not hide.
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
    const shown = userIds.filter((userId) =>
      userId === viewerId
        ? true
        : blockState.status === "ready"
          ? !blockState.ids.has(userId)
          : blockState.unblocked.has(userId),
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
 * What the notice says in place of its Retry control while the list's read is
 * parked waiting for the network (`BlockedUserIds.isPaused`): a tap could not
 * run it any sooner, and it resumes by itself on reconnect.
 */
export const BLOCK_LIST_WAITING_FOR_NETWORK = "Retries when you're back online";

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
 * Whether a `users.id` is a member of the active chapter:
 *
 * - `true` — the loaded roster lists them.
 * - `false` — **positively known departed**: this session the API refused to
 *   block them as not a member (`isMemberNotFound` in `block-actions.ts`), and
 *   no roster read since lists them.
 * - `null` — nothing can be said. Covers a roster that has not loaded or
 *   failed, and a loaded one that does not list them — which is not evidence
 *   they left: the roster is cached, and the sender it is likeliest to miss is
 *   a member who joined after it was read.
 */
export type MemberLookup = (userId: string) => boolean | null;

const NO_ONE: ReadonlySet<string> = new Set();

export function rosterMembership(
  roster: {
    byId: Readonly<Record<string, string>>;
    isPending: boolean;
    isError: boolean;
  },
  departed: ReadonlySet<string> = NO_ONE,
): MemberLookup {
  const loaded = !roster.isPending && !roster.isError;
  return (userId) => {
    if (loaded && Object.prototype.hasOwnProperty.call(roster.byId, userId)) {
      return true;
    }
    return departed.has(userId) ? false : null;
  };
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
 * - **Block needs a blockable sender not known to have left** — not the system
 *   actor, not an imported row, and not someone `isMember` positively knows
 *   departed. A sender the cached roster does not list still gets Block: that
 *   is exactly what a brand-new member looks like, and App Review's block
 *   control must not vanish for them. If they did leave, `POST /v1/chat/blocks`
 *   answers 404 `Member not found` and the confirmation says so. Report stays
 *   in every case: an imported row names its author in `author_name`, which the
 *   API snapshots into the report for exactly that.
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
