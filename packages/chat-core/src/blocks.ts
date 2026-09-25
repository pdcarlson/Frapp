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
import { mergeServerRow } from "./cache";
import {
  CHAT_MESSAGE_QUERY_ROOT,
  chatMessagesKey,
  type ChannelCache,
  type ChatMessage,
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
 * `null` is an imported archive row (no Frapp user behind it — blocks are
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
    if (row.sender_id !== senderId || row.sender_blocked !== false) continue;
    const cached = next.byId[row.id];
    if (!cached || !cached._blockEvaluated || !cached.sender_blocked) continue;
    next = mergeServerRow(next, row);
  }
  return next;
}

/**
 * Whether a channel cache holds a server-masked copy from this sender — an
 * evaluated row with its masked body, not an echo carrying the verdict (see
 * `replaceMaskedCopies`).
 */
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

/** The channel id in a `chatMessagesKey`, or `null` for any other `["chat", …]` key. */
function channelIdOf(queryKey: readonly unknown[]): string | null {
  const [root, channelId, leaf] = queryKey;
  return root === CHAT_MESSAGE_QUERY_ROOT &&
    typeof channelId === "string" &&
    leaf === "messages" &&
    queryKey.length === 3
    ? channelId
    : null;
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
 * finding 3). Here each affected thread's newest page is fetched on its own
 * and folded into the cache **as it is when the response lands**, through
 * `replaceMaskedCopies`, which only swaps masked copies for their clear twins.
 *
 * Only threads that hold a masked copy from this member are read. Older copies
 * beyond the newest page stay masked, as stale tombstones, until the thread's
 * query is next read from scratch (spec/behavior/chat/README.md, Channel
 * messages row).
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
    .map((query) => channelIdOf(query.queryKey))
    .filter((channelId): channelId is string => channelId !== null)
    .filter(holdsMaskedCopy);

  if (channelIds.length === 0) {
    maskedRefresh.set(userId, null);
    return true;
  }
  maskedRefresh.set(userId, "refreshing");

  /** One read of a thread's newest page, folded in. `false` on any failure. */
  async function readNewestPage(channelId: string): Promise<boolean> {
    try {
      const result = await client.GET("/v1/channels/{id}/messages", {
        params: { path: { id: channelId }, query: { limit: 50 } },
      });
      if (!result.response.ok || !Array.isArray(result.data)) return false;
      const rows = result.data as RawChatMessage[];
      queryClient.setQueryData<ChannelCache>(
        chatMessagesKey(channelId),
        (current) =>
          current ? replaceMaskedCopies(current, rows, userId) : current,
      );
      return true;
    } catch {
      return false;
    }
  }

  const results = await Promise.all(
    channelIds.map(async (channelId) => {
      for (let attempt = 0; ; attempt += 1) {
        if (await readNewestPage(channelId)) return true;
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
