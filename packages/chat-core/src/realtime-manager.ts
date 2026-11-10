/**
 * Singleton realtime manager for chat.
 *
 * Responsibilities:
 *   - Per visible channel: Postgres Changes on `chat_messages` (filtered by
 *     channel_id) → `mergeServerRow` into the normalized cache. A merged row
 *     (live or backfilled) also evicts the persisted heavy-command notice its
 *     sender filed under its `client_message_id` (`heavy-command-notices.ts`,
 *     #1909). Also, per channel, Broadcast for typing and Realtime Presence
 *     (`track`) for presence (ADR-10).
 *   - One global Postgres Changes subscription on `chat_message_actions` (no
 *     `channel_id` column on that table to filter by) — events are dispatched
 *     to whichever subscribed channel cache holds the message. Reactions on
 *     not-yet-loaded messages are intentionally dropped. Nothing here reads
 *     back the actions written while this subscription was down: the
 *     backfill reads message rows only (#3039).
 *   - One global Postgres Changes subscription on `chat_messages` INSERTs
 *     (`INBOX_TOPIC`, #3698), RLS-scoped to what the viewer may read, which
 *     reports every new message to `ctx.onMessageActivity` so the client can
 *     keep unread badges and the Messages order live. Its rejoins, and
 *     `resume()` (the app back in the foreground), report a `resync`.
 *   - Aggregates per-channel subscribe status into `"live" | "polling" |
 *     "reconnecting" | "offline"` for the UI "Reconnecting…" pill, with
 *     exponential backoff (1→2→4→8→16→30s capped) on
 *     `CHANNEL_ERROR`/`TIMED_OUT`.
 *   - Degrades to a REST polling fallback when any subscribed channel has been
 *     non-live for longer than `POLL_DEGRADE_AFTER_MS`, re-running the same
 *     backfill every `POLL_INTERVAL_MS` until Realtime recovers
 *     (`spec/ui/resilience/message-delivery.md#receiving-messages-realtime`). Reconnect backoff keeps running
 *     underneath, so polling is a stopgap, never a replacement.
 *   - For every channel attach — both the initial join and every reconnect —
 *     **resubscribe first** (so any live row between backfill and re-attach
 *     goes through the same idempotent merge), **then** REST-backfill since
 *     the last confirmed message id (persisted per channel through the
 *     `KeyValueStore` port — `localStorage` on web).
 *     Both paths run the backfill from the single `SUBSCRIBED` callback so
 *     the listener is genuinely attached before the backfill request fires.
 *     Subscribe-then-backfill tolerates a harmless overlap (dedup by id)
 *     instead of risking a gap.
 *
 * Channels are ref-counted, so the sidebar can pre-subscribe for unread
 * counts without the timeline tearing the subscription down.
 *
 * Topic reuse is the sharp edge here. `supabase.channel(topic)` returns the
 * **existing** instance while one is still registered under that topic, and
 * `removeChannel()` is async — so re-creating a channel before its predecessor
 * finished leaving hands back the old, already-subscribed instance, and
 * `.on("postgres_changes", …)` on it throws. Every attach therefore goes
 * through `releaseTopic` first (see `attachChannel`). The topic string itself
 * is a cross-service contract — the push worker reads presence on the same
 * `chat:channel:<id>` topic (ADR-10) — so it must stay stable; freeing the
 * topic, not re-keying it, is the fix.
 */

import type { QueryClient } from "@tanstack/react-query";
import type {
  RealtimeChannel,
  RealtimePostgresChangesPayload,
  SupabaseClient,
} from "@supabase/supabase-js";
import {
  applyReactionDelete,
  applyReactionInsert,
  dropUnreadThrough,
  emptyCache,
  holdsServerRow,
  mergeServerRow,
  mergeSincePage,
  removeMessage,
} from "./cache";
import type { FrappApiClient } from "./chat-client";
import {
  FIRST_PAGE_LIMIT,
  readMessageRows,
  SinceCursorNotFoundError,
  type HistoryPageQuery,
} from "./history";
import {
  chatMessagesKey,
  type ChannelCache,
  type RawChatMessage,
  type RawChatMessageAction,
} from "./types";
import {
  browserKeyValueStore,
  browserNetworkState,
  type KeyValueStore,
  type NetworkState,
} from "./adapters";
import {
  isTopicOccupied as isRealtimeTopicOccupied,
  releaseTopic as releaseRealtimeTopic,
} from "./topic-registry";
import { dropNotices } from "./heavy-command-notices";

export type ConnectionStatus = "live" | "polling" | "reconnecting" | "offline";

const BACKOFF_STEPS_MS = [1000, 2000, 4000, 8000, 16000, 30000] as const;
const LAST_SEEN_PREFIX = "chat:lastSeen:";

/**
 * How long a channel may sit non-live before we stop waiting on Realtime and
 * start pulling messages over REST. `spec/ui/resilience/message-delivery.md#receiving-messages-realtime`: "Disconnected
 * (>10s) → switch to polling mode".
 */
export const POLL_DEGRADE_AFTER_MS = 10_000;

/** Poll cadence once degraded — Receiving messages: "Poll every 5s for new messages". */
export const POLL_INTERVAL_MS = 5_000;

/**
 * Nobody typing: what `getTypingUsers` returns for a channel nobody holds, and
 * what a hook shows with no channel open. One identity, never mutated.
 */
export const NO_TYPING_USERS: readonly string[] = Object.freeze([]);

/**
 * Rows per backfill read after a cursor, reconnect and poll alike. The read
 * is the newest `limit` rows after the cursor, so a page this full may not
 * reach back to it, and is merged as one that may not (`mergeSincePage`,
 * #2807). With no cursor the read is the newest page, at the size the
 * channel query reads it (`FIRST_PAGE_LIMIT`), so it brings no row that page
 * and its reactions don't already cover.
 */
export const BACKFILL_PAGE_LIMIT = 100;

/** One backfill read: after `since` when there is a cursor, else the newest page. */
export type BackfillQuery = Pick<HistoryPageQuery, "since" | "limit">;

/**
 * Message rows only. Throws `SinceCursorNotFoundError` when the server holds
 * no message by the cursor in that channel; the manager then drops the
 * cursor and reads the newest page.
 */
export interface BackfillFetcher {
  (channelId: string, query: BackfillQuery): Promise<RawChatMessage[]>;
}

/** The backfill read both clients configure the manager with. */
export function createBackfillFetcher(
  apiClient: FrappApiClient,
): BackfillFetcher {
  return (channelId, query) => readMessageRows(apiClient, channelId, query);
}

export interface ManagerContext {
  queryClient: QueryClient;
  supabase: SupabaseClient;
  backfill: BackfillFetcher;
  /**
   * Viewer's app user id, used for Supabase Realtime Presence tracking on
   * the `chat:channel:<id>` topic (ADR-10). The push worker reads the same
   * topic via service role to skip recipients currently in the channel.
   * `null` / omitted disables presence tracking (e.g. signed-out tabs and
   * tests that don't need it).
   */
  viewerId?: string | null;
  /**
   * Platform ports. Omitted fields fall back to the browser implementations
   * (`localStorage`, `navigator.onLine` + window online/offline events) —
   * web runs on the defaults; mobile injects both.
   */
  kv?: KeyValueStore;
  net?: NetworkState;
  /**
   * Told about chat traffic outside the open thread (#3698), so a client can
   * keep what summarizes every channel live: unread badges, the Messages
   * order, the app badge. See {@link MessageActivity}. Optional; called from
   * inside a realtime frame dispatch, so it must not throw (the manager
   * contains it if it does) and should coalesce its own work.
   */
  onMessageActivity?: (activity: MessageActivity) => void;
}

/**
 * What the inbox channel saw.
 *
 * - `message`: a new message the viewer may read landed in `channelId`. If
 *   this client has that channel subscribed, its thread merged the row itself;
 *   the activity is about everything that summarizes channels. Whether the
 *   member is looking at it is the client's to say: a subscribed thread can be
 *   mounted under another screen.
 * - `resync`: the manager may have missed messages (the inbox rejoined after a
 *   drop, or the app came back from the background) and anything derived from
 *   them should be read again.
 */
export type MessageActivity =
  | {
      type: "message";
      channelId: string;
      senderId: string | null;
    }
  | { type: "resync" };

/**
 * How often `resume()`'s probe looks at the socket's outstanding heartbeat. A
 * heartbeat seen pending at two looks in a row has gone unanswered for at
 * least this long, and the socket is declared dead. Realtime only notices a
 * socket the OS cut when a heartbeat goes unanswered, on its own schedule up
 * to 50s after the app is back; the probe brings it to a few of these. A live
 * link answers in well under a second, so this leaves a congested one room.
 */
export const RESUME_PROBE_MS = 4_000;

/** How many looks the probe takes before leaving the socket to Realtime. */
export const RESUME_PROBE_LOOKS = 3;

/**
 * The one topic carrying every new message the viewer may read, whichever
 * channel it is in (#3698). Unfiltered: `chat_messages` has no chapter column
 * to filter on, and Realtime runs the `chat_messages_select` RLS policy per
 * subscriber for every row, so a member receives exactly the rows a REST read
 * would return them (archive imports excluded) — the same arrangement as the
 * actions topic. Public, like that one: a `postgres_changes`-only channel is
 * authorised row by row, not at the join.
 */
export const INBOX_TOPIC = "chat:inbox:global";

/**
 * A `postgres_changes` row, stripped of anything that would let it read as
 * server-evaluated for the viewer (#2315).
 *
 * `sender_blocked` is how a REST row says the server ran the viewer's block
 * list over it, and its presence is what `normalizeRow` turns into
 * `ChatMessage._blockEvaluated`. An echo is the raw table row, delivered with
 * no viewer attached, so it can vouch for nothing. It carries no such key
 * today — `chat_messages` has no such column — which is exactly why this is
 * enforced here rather than assumed: the one path that knows a row arrived by
 * echo is the one that must say so, and an echo that read as evaluated would
 * render in the clear while the block list is loading or unavailable.
 */
function asEcho(row: RawChatMessage): RawChatMessage {
  if (!("sender_blocked" in row)) return row;
  const echo = { ...row };
  delete echo.sender_blocked;
  return echo;
}

interface PerChannelState {
  channelId: string;
  refCount: number;
  channel: RealtimeChannel | null;
  status: "joining" | "live" | "reconnecting";
  backoffStep: number;
  retryTimer: ReturnType<typeof setTimeout> | null;
  typingUsers: Map<string, number>; // userId → expires-at ms
  /**
   * The list `getTypingUsers` last returned for this channel, handed back
   * again while the membership is unchanged. See `getTypingUsers`.
   */
  typingSnapshot: readonly string[];
  typingLastEmit: number;
  /**
   * Typing inside this channel's message threads (#3785), keyed by thread
   * root: kept apart from `typingUsers` so a thread typist never shows on the
   * channel's own typing line. Each thread has its own snapshot and throttle,
   * like the channel's.
   */
  threadTyping: Map<string, ThreadTypingState>;
  /**
   * Ticket for the in-flight attach. Freeing an occupied topic is async, so two
   * reopens can overlap; only the holder of the newest ticket is allowed to
   * install a channel. See `attachChannel`.
   */
  attachSeq: number;
}

interface ThreadTypingState {
  users: Map<string, number>; // userId → expires-at ms
  snapshot: readonly string[];
  lastEmit: number;
}

/** A thread reply's realtime row, handed to `onThreadReply` listeners. */
export type ThreadReplyListener = (
  row: RawChatMessage,
  event: "INSERT" | "UPDATE",
) => void;

/** The live list in `users`, reusing `previous` while its membership holds. */
function liveTypists(
  users: Map<string, number>,
  previous: readonly string[],
): readonly string[] {
  const now = Date.now();
  const live: string[] = [];
  for (const [user, expires] of users) {
    if (expires > now) live.push(user);
  }
  if (
    live.length === previous.length &&
    live.every((userId, index) => userId === previous[index])
  ) {
    return previous;
  }
  return live.length === 0 ? NO_TYPING_USERS : live;
}

class ChatRealtimeManager {
  /** Thread reply listeners, per channel (#3785). See `onThreadReply`. */
  private threadReplyListeners = new Map<string, Set<ThreadReplyListener>>();
  private ctx: ManagerContext | null = null;
  private channels = new Map<string, PerChannelState>();
  private actionsChannel: RealtimeChannel | null = null;
  /** `attachSeq`'s equivalent for the single global actions channel. */
  private actionsAttachSeq = 0;
  /** The global new-message channel (`INBOX_TOPIC`, #3698). */
  private inboxChannel: RealtimeChannel | null = null;
  private inboxAttachSeq = 0;
  private inboxLive = false;
  /**
   * Set by the first SUBSCRIBED or the first failure, whichever comes first:
   * every SUBSCRIBED after either follows a gap and owes a resync.
   */
  private inboxOwesResync = false;
  private inboxBackoffStep = 0;
  private inboxRetryTimer: ReturnType<typeof setTimeout> | null = null;
  /** The second heartbeat of a `resume()` probe, pending. */
  private probeTimer: ReturnType<typeof setTimeout> | null = null;
  private statusListeners = new Set<(status: ConnectionStatus) => void>();
  private offline = false;
  /** Unsubscribe for the `NetworkState` connectivity subscription. */
  private netUnsub: (() => void) | null = null;
  /**
   * This process's copy of each channel's backfill cursor (`null` once
   * dropped), read before the store. The store is best-effort: a browser that
   * refuses site storage drops every write silently, and without this copy
   * every reconnect and poll would then read without a cursor, and a full
   * newest page would trim the history the member scrolled back through on
   * each pass (#2807).
   */
  private lastSeen = new Map<string, string | null>();
  private typingTickHandle: ReturnType<typeof setInterval> | null = null;
  /** Armed while a channel is non-live; firing promotes us into polling. */
  private pollDegradeTimer: ReturnType<typeof setTimeout> | null = null;
  /** The 5s poll loop itself. Non-null exactly while `polling` is true. */
  private pollTimer: ReturnType<typeof setInterval> | null = null;
  private polling = false;
  /** Guards against overlapping poll passes on a slow connection. */
  private pollInFlight = false;

  /**
   * Binds the manager to a client, and may be called again without `destroy()`
   * to rebind it: both clients re-configure when the viewer resolves or
   * changes, and neither tears the manager down to do it (#3002).
   */
  configure(ctx: ManagerContext): void {
    const previous = this.ctx;
    this.ctx = ctx;
    this.ensureActionsChannel();
    this.ensureInboxChannel();
    this.ensureTypingTick();
    const net = ctx.net ?? browserNetworkState;
    this.offline = net.isOffline();
    // Re-configure without destroy() must not stack subscriptions. The old
    // window.addEventListener wiring was naturally idempotent (stable handler
    // refs); `subscribe` mints a fresh closure per call, so release the
    // previous one first.
    this.netUnsub?.();
    this.netUnsub = net.subscribe((online) =>
      online ? this.handleOnline() : this.handleOffline(),
    );

    /*
      What a (re)configure owes the channels already subscribed (#3002):

      - One subscribed while the manager had no `ctx`, before the first
        `configure` or since a `destroy()`, gets its attach. `attachChannel`
        returned at its `ctx` guard before taking a ticket, so `attachSeq` is
        still 0 and the channel sat in `joining` with nothing scheduled. React
        runs a child's effects before its parent's, so a thread's `subscribe`
        runs before the provider's `configure` on any mount where the channel
        is already known.
      - A viewer that has only just resolved is told to presence. Nothing
        else changed: the session that joined is this viewer's own, and web
        joins before `GET /v1/users/me` answers on most cold loads. A joined
        channel tracks them now (ADR-10: the push worker reads presence to
        skip members reading the thread); one still joining reads the viewer
        when its SUBSCRIBED lands (`trackViewer`).
      - A different viewer gets every channel rejoined. A private channel's
        join was authorised for the session that made it
        (`can_read_chat_channel`), so re-tracking presence on it would keep
        another member's authorisation behind this one's identity.

      `reopenChannel` takes a fresh ticket, so an attach already in flight
      for the same channel installs nothing.
    */
    const before = previous ? (previous.viewerId ?? null) : null;
    const after = ctx.viewerId ?? null;
    // The inbox's rows are filtered by RLS against the session that joined.
    // A viewer resolving or changing usually means a new session (a sign-out
    // rebinds with `null`, a sign-in with the member), so rejoin rather than
    // trust the token refresh to re-scope a subscription made under the old
    // one.
    if (previous !== null && before !== after) this.reopenInbox();
    for (const state of this.channels.values()) {
      if (state.attachSeq === 0) {
        this.reopenChannel(state);
      } else if (previous === null || before === after) {
        continue;
      } else if (before === null) {
        if (state.status === "live" && state.channel) {
          this.trackViewer(state.channel);
        }
      } else {
        this.reopenChannel(state);
      }
    }
  }

  destroy(): void {
    this.netUnsub?.();
    this.netUnsub = null;
    for (const state of this.channels.values()) {
      if (state.retryTimer) clearTimeout(state.retryTimer);
      if (state.channel) void this.ctx?.supabase.removeChannel(state.channel);
    }
    this.channels.clear();
    if (this.actionsChannel) {
      void this.ctx?.supabase.removeChannel(this.actionsChannel);
      this.actionsChannel = null;
    }
    if (this.inboxRetryTimer) clearTimeout(this.inboxRetryTimer);
    this.inboxRetryTimer = null;
    if (this.probeTimer) clearTimeout(this.probeTimer);
    this.probeTimer = null;
    if (this.inboxChannel) {
      void this.ctx?.supabase.removeChannel(this.inboxChannel);
      this.inboxChannel = null;
    }
    this.inboxLive = false;
    this.inboxOwesResync = false;
    this.inboxBackoffStep = 0;
    if (this.typingTickHandle) clearInterval(this.typingTickHandle);
    this.typingTickHandle = null;
    this.stopPolling();
    // Must reset here, not in stopPolling: a backfill that never settles would
    // otherwise leave the flag latched on this module singleton, and the next
    // configure() would come up with polling permanently short-circuited.
    this.pollInFlight = false;
    this.lastSeen.clear();
    this.ctx = null;
  }

  subscribe(channelId: string): void {
    if (!channelId) return;
    let state = this.channels.get(channelId);
    if (state) {
      state.refCount += 1;
      return;
    }
    state = {
      channelId,
      refCount: 1,
      channel: null,
      status: "joining",
      backoffStep: 0,
      retryTimer: null,
      typingUsers: new Map(),
      typingSnapshot: NO_TYPING_USERS,
      typingLastEmit: 0,
      threadTyping: new Map(),
      attachSeq: 0,
    };
    this.channels.set(channelId, state);
    this.openChannel(state);
    // Backfill is intentionally NOT fired here. `openChannel`'s SUBSCRIBED
    // callback is the single gate for both initial join and reconnect, so the
    // Postgres Changes listener is always attached before the REST backfill
    // request goes out. See ADR-05.
    //
    // Do emit, though: the channel is now "joining", and that is what arms the
    // degrade timer. A join that never lands is exactly the case polling has to
    // cover, and without this the timer would only ever arm on a *drop*.
    this.emitStatus();
  }

  unsubscribe(channelId: string): void {
    const state = this.channels.get(channelId);
    if (!state) return;
    state.refCount -= 1;
    if (state.refCount > 0) return;
    if (state.retryTimer) clearTimeout(state.retryTimer);
    if (state.channel) void this.ctx?.supabase.removeChannel(state.channel);
    this.channels.delete(channelId);
    this.emitStatus();
  }

  /**
   * The app is back in front of the member: a mobile app returning from the
   * background, a web tab becoming visible (#3698).
   *
   * The socket may have died while nobody was looking, and the client only
   * notices when a heartbeat goes unanswered, on its own schedule up to 50s
   * later. So this does not wait on Realtime to say so:
   *
   * - A socket known to be down is reconnected. One that reads open is probed
   *   (`probeSocket`): if one heartbeat stays unanswered across two looks
   *   `RESUME_PROBE_MS` apart, Realtime's own heartbeat timeout runs, which
   *   errors every channel on the socket, chat's and everyone else's, and
   *   reconnects and rejoins them; each chat rejoin backfills. A socket that
   *   answers is never touched, so the other consumers sharing it (web's
   *   notification and event pings, presence) see no gap.
   * - Each live channel is read since its cursor over REST now (the idempotent
   *   backfill a reconnect runs, so a row that also arrives live collapses to
   *   one), and any channel that isn't live is reopened, which backfills when
   *   it lands.
   * - The channel summaries are read again, and the thread being looked at
   *   re-stamped: by a `resync` reported now when the inbox is live, otherwise
   *   by the one its rejoin reports.
   *
   * Offline it does nothing; the online edge reopens everything when the
   * network returns.
   */
  resume(): void {
    if (!this.ctx || this.offline) return;
    const realtime = this.ctx.supabase.realtime;
    try {
      if (realtime && !realtime.isConnected()) realtime.connect();
      else if (realtime) this.probeSocket(realtime);
    } catch {
      // A socket that won't come back is the backoff's and polling's to cover.
    }
    for (const state of this.channels.values()) {
      if (state.status === "live") void this.runBackfill(state.channelId);
      else this.reopenChannel(state);
    }
    // A rejoin reports its own resync, so reporting one here too would read the
    // summaries twice. It must owe one, though: an inbox whose first join never
    // landed would otherwise rejoin silently.
    if (this.inboxLive) {
      this.reportActivity({ type: "resync" });
    } else {
      this.inboxOwesResync = true;
      this.reopenInbox();
    }
    this.emitStatus();
  }

  /**
   * Watches a socket that reads open for a heartbeat that never comes back,
   * through Realtime's public heartbeat API.
   *
   * It sends nothing of its own until it has caught one: Realtime's scheduled
   * heartbeat is usually overdue when the app wakes and fires at once, and
   * any heartbeat sent while another is pending runs the client's heartbeat
   * timeout, so a probe heartbeat could time out a live socket whose reply is
   * merely in flight, or be timed out by the scheduled one. Instead it looks at
   * `pendingHeartbeatRef` every `RESUME_PROBE_MS`, up to `RESUME_PROBE_LOOKS`
   * times. The same ref pending at two looks in a row has gone unanswered for
   * a whole window, and only then does `sendHeartbeat()` run the timeout, so a
   * dead socket is handled exactly as a missed scheduled heartbeat would be,
   * only sooner. A probe already running is left to finish.
   */
  private probeSocket(realtime: SupabaseClient["realtime"]): void {
    if (this.probeTimer) return;
    let watched = realtime.pendingHeartbeatRef;
    let looks = 0;
    const look = () => {
      this.probeTimer = null;
      if (this.ctx?.supabase.realtime !== realtime) return;
      const pending = realtime.pendingHeartbeatRef;
      if (pending && pending === watched) {
        void realtime.sendHeartbeat();
        return;
      }
      watched = pending;
      looks += 1;
      if (looks < RESUME_PROBE_LOOKS) {
        this.probeTimer = setTimeout(look, RESUME_PROBE_MS);
      }
    };
    this.probeTimer = setTimeout(look, RESUME_PROBE_MS);
  }

  subscribeStatus(cb: (status: ConnectionStatus) => void): () => void {
    this.statusListeners.add(cb);
    cb(this.computeStatus());
    return () => {
      this.statusListeners.delete(cb);
    };
  }

  /**
   * Announce that `userId` is typing in `channelId`, or inside the thread off
   * `threadRootId` there (#3785). A thread's typing rides the channel's topic,
   * tagged with its root, so the topic never re-keys (rule 2).
   */
  emitTyping(
    channelId: string,
    userId: string,
    displayName?: string,
    threadRootId?: string | null,
  ): void {
    const state = this.channels.get(channelId);
    if (!state || !state.channel) return;
    const now = Date.now();
    if (threadRootId) {
      const thread = this.threadTypingState(state, threadRootId);
      if (now - thread.lastEmit < 3000) return;
      thread.lastEmit = now;
    } else {
      if (now - state.typingLastEmit < 3000) return;
      state.typingLastEmit = now;
    }
    void state.channel.send({
      type: "broadcast",
      event: "typing",
      payload: {
        userId,
        displayName: displayName ?? null,
        ...(threadRootId ? { threadRootId } : {}),
      },
    });
  }

  /**
   * Listen for thread replies on `channelId`'s topic (#3785). The timeline
   * drops them (they are not its rows), so a thread panel takes them here
   * into its own cache. It needs the channel subscribed (`subscribe`), which
   * the open channel already holds. Returns the unsubscribe.
   */
  onThreadReply(channelId: string, listener: ThreadReplyListener): () => void {
    let set = this.threadReplyListeners.get(channelId);
    if (!set) {
      set = new Set();
      this.threadReplyListeners.set(channelId, set);
    }
    set.add(listener);
    return () => {
      const current = this.threadReplyListeners.get(channelId);
      if (!current) return;
      current.delete(listener);
      if (current.size === 0) this.threadReplyListeners.delete(channelId);
    };
  }

  /**
   * Who is typing in `channelId` now, in the order they started.
   *
   * The same array comes back for as long as that list is unchanged, so a
   * client holding it in React state bails out of the re-render (`Object.is`)
   * on every status ping that carries no typing change for this channel:
   * another channel's typing broadcast, a typist re-announcing, an expiry
   * sweep elsewhere, an attach or a connection transition. The typing line
   * rides the status listeners (`emitStatus`), so without this every one of
   * those re-rendered each client's whole thread. Mobile's hook used to
   * compare membership itself and web's never did (#1004); here it holds for
   * every caller.
   */
  getTypingUsers(
    channelId: string,
    threadRootId?: string | null,
  ): readonly string[] {
    const state = this.channels.get(channelId);
    if (!state) return NO_TYPING_USERS;
    if (threadRootId) {
      const thread = state.threadTyping.get(threadRootId);
      if (!thread) return NO_TYPING_USERS;
      thread.snapshot = liveTypists(thread.users, thread.snapshot);
      return thread.snapshot;
    }
    state.typingSnapshot = liveTypists(state.typingUsers, state.typingSnapshot);
    return state.typingSnapshot;
  }

  private threadTypingState(
    state: PerChannelState,
    threadRootId: string,
  ): ThreadTypingState {
    let thread = state.threadTyping.get(threadRootId);
    if (!thread) {
      thread = { users: new Map(), snapshot: NO_TYPING_USERS, lastEmit: 0 };
      state.threadTyping.set(threadRootId, thread);
    }
    return thread;
  }

  // ─── internals ──────────────────────────────────────────────────────────

  private handleOnline = (): void => {
    this.offline = false;
    for (const state of this.channels.values()) {
      this.reopenChannel(state);
    }
    // Its SUBSCRIBED reports the resync that catches the channel summaries up
    // on what landed while offline, even when the drop came before the first
    // join ever landed.
    this.inboxOwesResync = true;
    this.reopenInbox();
    this.emitStatus();
  };

  private handleOffline = (): void => {
    this.offline = true;
    this.emitStatus();
  };

  private ensureTypingTick(): void {
    if (this.typingTickHandle) return;
    // Sweep expired typing entries and notify listeners.
    this.typingTickHandle = setInterval(() => {
      let dirty = false;
      const now = Date.now();
      for (const state of this.channels.values()) {
        for (const [user, expires] of state.typingUsers) {
          if (expires <= now) {
            state.typingUsers.delete(user);
            dirty = true;
          }
        }
        for (const [rootId, thread] of state.threadTyping) {
          for (const [user, expires] of thread.users) {
            if (expires <= now) {
              thread.users.delete(user);
              dirty = true;
            }
          }
          if (thread.users.size === 0 && thread.snapshot.length === 0) {
            state.threadTyping.delete(rootId);
          }
        }
      }
      // Status listeners drive a re-render; piggyback typing changes through them.
      if (dirty) this.emitStatus();
    }, 1500);
  }

  /** The injected key-value store, or the browser default. */
  private kvStore(): KeyValueStore {
    return this.ctx?.kv ?? browserKeyValueStore;
  }

  // The cursor is best-effort by design ("degrade silently" — the backfill
  // falls back to its default window). The pre-extraction code guaranteed
  // that at the call site with its own try/catch, so keep the guarantee here
  // rather than trusting every injected store to be no-throw: one call site
  // sits inside the Supabase postgres_changes dispatch, where an escaping
  // storage error would abort frame processing after the cache merge.
  private readLastSeen(channelId: string): string | null {
    if (this.lastSeen.has(channelId)) return this.lastSeen.get(channelId)!;
    try {
      return this.kvStore().get(LAST_SEEN_PREFIX + channelId);
    } catch {
      return null;
    }
  }

  private writeLastSeen(channelId: string, messageId: string | null): void {
    this.lastSeen.set(channelId, messageId || null);
    try {
      if (!messageId) this.kvStore().remove(LAST_SEEN_PREFIX + channelId);
      else this.kvStore().set(LAST_SEEN_PREFIX + channelId, messageId);
    } catch {
      // Storage unavailable. This session's copy (`lastSeen`) still holds the
      // cursor; after a restart the next backfill reads the newest page.
    }
  }

  /**
   * Is anything still registered under this topic? A `ctx` guard over the
   * shared registry helper.
   */
  private isTopicOccupied(topic: string): boolean {
    if (!this.ctx) return false;
    return isRealtimeTopicOccupied(this.ctx.supabase, topic);
  }

  /**
   * Frees a topic so the next `supabase.channel(topic)` mints a genuinely new
   * instance.
   *
   * The mechanism — and why the unconditional `teardown()` is load-bearing —
   * lives in `./topic-registry`, which web's non-chat realtime
   * (`lib/realtime/supabase-realtime.ts`) shares via its re-export shim so
   * both attach paths free topics identically (#817).
   *
   * `unsubscribe()` resolves rather than rejects and is bounded by the client's
   * own timeout, so this cannot wedge a reattach — and the poll fallback
   * covers the gap if it does take the full timeout.
   */
  private async releaseTopic(topic: string): Promise<void> {
    const supabase = this.ctx?.supabase;
    if (!supabase) return;
    await releaseRealtimeTopic(supabase, topic);
  }

  /**
   * True while `seq` is still the newest attach for `state` and that state is
   * still the live one for its channel id. Guards every resumption point after
   * an `await`, so a superseded or torn-down attach installs nothing.
   */
  private isCurrentAttach(state: PerChannelState, seq: number): boolean {
    return (
      this.ctx !== null &&
      state.attachSeq === seq &&
      this.channels.get(state.channelId) === state
    );
  }

  /**
   * Fire-and-forget entry point. Every caller is a React effect, a timer or a
   * connectivity-change handler — none of them can await, and a rejection
   * escaping into a commit phase is exactly how this unmounted the shell.
   */
  private openChannel(state: PerChannelState): void {
    void this.attachChannel(state);
  }

  private async attachChannel(state: PerChannelState): Promise<void> {
    if (!this.ctx) return;
    const topic = `chat:channel:${state.channelId}`;
    const seq = (state.attachSeq += 1);
    // The previous instance is unusable from here on: either we are about to
    // tear it down, or a newer attach will.
    state.channel = null;

    try {
      // Only pay for a teardown when the topic is actually taken. A first join
      // is the common case and stays fully synchronous, so `state.channel` is
      // live before `subscribe()` returns.
      if (this.isTopicOccupied(topic)) {
        await this.releaseTopic(topic);
        if (!this.isCurrentAttach(state, seq)) return;
      }
      this.installChannel(state, topic);
    } catch {
      // Never let an attach failure reach the caller's render pass. It is just
      // a connection we do not have yet — hand it to the existing backoff.
      if (!this.isCurrentAttach(state, seq)) return;
      state.channel = null;
      state.status = "reconnecting";
      this.scheduleReconnect(state);
      this.emitStatus();
    }
  }

  /**
   * Binds listeners and subscribes. Runs with no `await` inside, so the channel
   * is installed on `state` atomically with respect to `unsubscribe()` and
   * `destroy()`.
   */
  private installChannel(state: PerChannelState, topic: string): void {
    if (!this.ctx) return;
    const { supabase } = this.ctx;

    // `private: true` since #1552: the join, every `track()` and every typing
    // `send()` are authorised by the `chat:channel:` arms of
    // `realtime_messages_scoped_select` / `_insert` on `realtime.messages`
    // (migration 20260906203000, predicate `can_read_chat_channel`). Private
    // and public are separate rooms on the server, so the push worker's
    // `ensurePresenceChannel` carries the same config — a worker left
    // public would see an empty roster and send every push. The worker also
    // sets `presence.enabled: true`, because it reads the roster; this side
    // only `track()`s, which needs no flag (#2974). Pinned by
    // `presence-contract.spec.ts`. `postgres_changes` bound below still
    // deliver on a private channel; verified against local Realtime before the
    // flip.
    const channel = supabase.channel(topic, {
      config: {
        private: true,
        broadcast: { self: false },
        presence: { key: "" },
      },
    });

    channel.on(
      "postgres_changes",
      {
        event: "*",
        schema: "public",
        table: "chat_messages",
        filter: `channel_id=eq.${state.channelId}`,
      },
      (payload: RealtimePostgresChangesPayload<RawChatMessage>) => {
        const next = payload.new as RawChatMessage | undefined;
        // An archive backfill is not live traffic. The server already keeps
        // these frames off the wire — the `chat_messages` RLS policy, which is
        // what Realtime evaluates per subscriber, excludes `kind = 'imported'`
        // (20260823123000_chat_imported_kind_semantics.sql) — so reaching this
        // branch means that policy regressed.
        //
        // Guarding here anyway is cheap and the failure it prevents is not:
        // there is no batching on this path, so every frame is its own
        // `setQueryData`, full cache-object spread and Virtuoso re-render. An
        // import targeted at a channel somebody has open would otherwise walk
        // thousands of years-old messages into a live timeline one render at a
        // time. History arrives through the ordinary channel read, in order.
        if (next?.kind === "imported") return;
        // A thread reply (#3785) rides this topic but is not part of the
        // channel's timeline: merged here it would land in the timeline cache
        // and move the last-seen cursor to a row the timeline read never
        // returns. The parent's own UPDATE echo carries the new reply count.
        // A thread panel takes it instead, through `onThreadReply`.
        if (next?.thread_root_id) {
          if (
            payload.eventType === "INSERT" ||
            payload.eventType === "UPDATE"
          ) {
            this.dispatchThreadReply(state.channelId, next, payload.eventType);
          }
          return;
        }
        if (next && next.id) {
          // INSERT / UPDATE — full row is present and authoritative about its
          // content, and says nothing about the viewer's block list: this path
          // has no viewer. `asEcho` makes that explicit (#2315).
          //
          // An UPDATE (an edit, pin or soft delete) of a row the cache doesn't
          // hold is not merged. An old message the window never loaded would
          // otherwise be spliced in below the newest page, become the cache's
          // oldest confirmed row, and make the older-page read (`history.ts`)
          // skip everything in between for good (#2775, #2871). Writing
          // through `patchCache` would also create an empty cache for a
          // channel whose first read hasn't landed.
          //
          // And only an INSERT moves the last-seen cursor: ADR-05 advances it
          // from new tail rows. An UPDATE is of a message already at or
          // behind the tail, so moving the cursor to it only ever moved it
          // back, and the next reconnect or poll re-read a page this client
          // already holds.
          const isUpdate = payload.eventType === "UPDATE";
          this.settleNotices(state.channelId, [next]);
          if (
            isUpdate &&
            !holdsServerRow(
              this.ctx?.queryClient.getQueryData<ChannelCache>(
                chatMessagesKey(state.channelId),
              ),
              next,
            )
          ) {
            return;
          }
          const echo = asEcho(next);
          this.patchCache(state.channelId, (cache) =>
            mergeServerRow(cache, echo),
          );
          if (!isUpdate) this.writeLastSeen(state.channelId, next.id);
          return;
        }
        // DELETE — default replica identity gives us only `old.id`, so we
        // remove the message from the cache (matches either the server id or
        // the client_message_id key) and intentionally do *not* advance
        // last-seen (a delete is not a new tail).
        const old = payload.old as { id?: string } | undefined;
        if (old?.id) {
          this.patchCache(state.channelId, (cache) =>
            removeMessage(cache, old.id!),
          );
        }
      },
    );

    channel.on("broadcast", { event: "typing" }, (msg) => {
      const payload = msg.payload as
        | {
            userId?: string;
            displayName?: string | null;
            threadRootId?: string | null;
          }
        | undefined;
      if (!payload?.userId) return;
      const expires = Date.now() + 4000;
      if (typeof payload.threadRootId === "string" && payload.threadRootId) {
        this.threadTypingState(state, payload.threadRootId).users.set(
          payload.userId,
          expires,
        );
      } else {
        state.typingUsers.set(payload.userId, expires);
      }
      this.emitStatus();
    });

    state.channel = channel;
    channel.subscribe((subscribeStatus) => {
      // A channel we have since replaced can still deliver a late status —
      // notably `CLOSED` from its own teardown, which would otherwise book a
      // reconnect against the channel that superseded it.
      if (state.channel !== channel) return;
      if (subscribeStatus === "SUBSCRIBED") {
        state.status = "live";
        state.backoffStep = 0;
        if (state.retryTimer) {
          clearTimeout(state.retryTimer);
          state.retryTimer = null;
        }
        this.trackViewer(channel);
        // Single gate for backfill — runs on both the initial join's first
        // SUBSCRIBED and every subsequent SUBSCRIBED after reconnect.
        void this.runBackfill(state.channelId);
        this.emitStatus();
      } else if (
        subscribeStatus === "CHANNEL_ERROR" ||
        subscribeStatus === "TIMED_OUT" ||
        subscribeStatus === "CLOSED"
      ) {
        state.status = "reconnecting";
        this.scheduleReconnect(state);
        this.emitStatus();
      }
    });
  }

  /**
   * ADR-10: puts the viewer in this channel's presence map so the push worker
   * can skip them on the same topic. The viewer is read now, not when the
   * channel was installed, so a join that lands after the viewer resolved
   * tracks them (#3002). `track` is fire-and-forget; a failure here is
   * harmless (worst case is one extra push), so it is not awaited.
   */
  private trackViewer(channel: RealtimeChannel): void {
    const viewerId = this.ctx?.viewerId ?? null;
    if (viewerId) void channel.track({ userId: viewerId, ts: Date.now() });
  }

  private reopenChannel(state: PerChannelState): void {
    if (state.retryTimer) {
      clearTimeout(state.retryTimer);
      state.retryTimer = null;
    }
    this.openChannel(state);
  }

  private scheduleReconnect(state: PerChannelState): void {
    if (this.offline) return;
    const step = Math.min(state.backoffStep, BACKOFF_STEPS_MS.length - 1);
    const delay = BACKOFF_STEPS_MS[step]!;
    state.backoffStep = Math.min(
      state.backoffStep + 1,
      BACKOFF_STEPS_MS.length - 1,
    );
    if (state.retryTimer) clearTimeout(state.retryTimer);
    state.retryTimer = setTimeout(() => {
      this.openChannel(state);
    }, delay);
  }

  /**
   * `destroy()` removes the actions channel fire-and-forget and `configure()`
   * re-creates it on the same topic immediately after, so a remount races its
   * own teardown exactly like `openChannel` did. On web a `DashboardShell`
   * remount does this (`useChatRealtimeBinding`, which moved there from
   * `ChatProvider` in #3745, so a trip in or out of `/chat` no longer does),
   * StrictMode's simulated one included; a re-auth re-configures without a
   * `destroy()` since #3002, and keeps the channel it has.
   */
  private ensureActionsChannel(): void {
    if (!this.ctx) return;
    if (this.actionsChannel) return;
    void this.attachActionsChannel();
  }

  private async attachActionsChannel(): Promise<void> {
    if (!this.ctx) return;
    const topic = "chat:actions:global";
    const seq = (this.actionsAttachSeq += 1);
    try {
      if (this.isTopicOccupied(topic)) {
        await this.releaseTopic(topic);
        if (!this.ctx || this.actionsAttachSeq !== seq) return;
      }
      this.installActionsChannel(topic);
    } catch {
      // Live reactions and votes stop until the next attach; nothing else
      // brings them back (#3039). One feature degrades, and it must never
      // propagate out of `configure()`.
      this.actionsChannel = null;
    }
  }

  private installActionsChannel(topic: string): void {
    if (!this.ctx) return;
    const channel = this.ctx.supabase.channel(topic);
    channel.on(
      "postgres_changes",
      {
        event: "INSERT",
        schema: "public",
        table: "chat_message_actions",
      },
      (payload: RealtimePostgresChangesPayload<RawChatMessageAction>) => {
        const row = payload.new as RawChatMessageAction | undefined;
        if (!row) return;
        this.dispatchActionInsert(row);
      },
    );
    channel.on(
      "postgres_changes",
      {
        event: "DELETE",
        schema: "public",
        table: "chat_message_actions",
      },
      (payload: RealtimePostgresChangesPayload<RawChatMessageAction>) => {
        const old = payload.old as { id?: string } | undefined;
        if (!old?.id) return;
        this.dispatchActionDelete(old.id);
      },
    );
    this.actionsChannel = channel;
    channel.subscribe();
  }

  // ─── inbox: every readable new message (#3698) ─────────────────────────

  private ensureInboxChannel(): void {
    if (!this.ctx) return;
    if (this.inboxChannel) return;
    void this.attachInboxChannel();
  }

  /** Rejoin the inbox now, cancelling any pending backoff. */
  private reopenInbox(): void {
    if (!this.ctx) return;
    if (this.inboxRetryTimer) {
      clearTimeout(this.inboxRetryTimer);
      this.inboxRetryTimer = null;
    }
    void this.attachInboxChannel();
  }

  /**
   * Same shape as `attachChannel`: free the topic first (rule 1 of the
   * realtime-resilience skill), take a ticket so overlapping reopens can't
   * interleave, and contain any failure in the backoff.
   */
  private async attachInboxChannel(): Promise<void> {
    if (!this.ctx) return;
    const seq = (this.inboxAttachSeq += 1);
    this.inboxChannel = null;
    this.inboxLive = false;
    try {
      if (this.isTopicOccupied(INBOX_TOPIC)) {
        await this.releaseTopic(INBOX_TOPIC);
        if (!this.ctx || this.inboxAttachSeq !== seq) return;
      }
      this.installInboxChannel();
    } catch {
      if (!this.ctx || this.inboxAttachSeq !== seq) return;
      this.inboxChannel = null;
      this.scheduleInboxReconnect();
    }
  }

  private installInboxChannel(): void {
    if (!this.ctx) return;
    const channel = this.ctx.supabase.channel(INBOX_TOPIC);
    channel.on(
      "postgres_changes",
      { event: "INSERT", schema: "public", table: "chat_messages" },
      (payload: RealtimePostgresChangesPayload<RawChatMessage>) => {
        const row = payload.new as RawChatMessage | undefined;
        if (!row?.channel_id) return;
        // RLS already keeps archive rows off the wire (see the per-channel
        // handler); an import is not traffic anyone should be told about.
        if (row.kind === "imported") return;
        this.reportActivity({
          type: "message",
          channelId: row.channel_id,
          senderId: row.sender_id ?? null,
        });
      },
    );
    this.inboxChannel = channel;
    channel.subscribe((status) => {
      // A channel since replaced can still report its own teardown.
      if (this.inboxChannel !== channel) return;
      if (status === "SUBSCRIBED") {
        this.inboxLive = true;
        this.inboxBackoffStep = 0;
        if (this.inboxRetryTimer) {
          clearTimeout(this.inboxRetryTimer);
          this.inboxRetryTimer = null;
        }
        // A first join that went straight through has nothing to catch up on:
        // the summaries were read when their screens mounted. A rejoin, or a
        // first join that only landed after failing, follows a gap.
        if (this.inboxOwesResync) this.reportActivity({ type: "resync" });
        this.inboxOwesResync = true;
      } else if (
        status === "CHANNEL_ERROR" ||
        status === "TIMED_OUT" ||
        status === "CLOSED"
      ) {
        this.inboxLive = false;
        this.inboxOwesResync = true;
        this.scheduleInboxReconnect();
      }
    });
  }

  private scheduleInboxReconnect(): void {
    if (this.offline || !this.ctx) return;
    const step = Math.min(this.inboxBackoffStep, BACKOFF_STEPS_MS.length - 1);
    const delay = BACKOFF_STEPS_MS[step]!;
    this.inboxBackoffStep = Math.min(
      this.inboxBackoffStep + 1,
      BACKOFF_STEPS_MS.length - 1,
    );
    if (this.inboxRetryTimer) clearTimeout(this.inboxRetryTimer);
    this.inboxRetryTimer = setTimeout(() => {
      this.inboxRetryTimer = null;
      void this.attachInboxChannel();
    }, delay);
  }

  /** Hands activity to the client, never letting its failure into a frame dispatch. */
  private dispatchThreadReply(
    channelId: string,
    row: RawChatMessage,
    event: "INSERT" | "UPDATE",
  ): void {
    const listeners = this.threadReplyListeners.get(channelId);
    if (!listeners) return;
    for (const listener of [...listeners]) {
      try {
        listener(row, event);
      } catch {
        // One panel's failure must not starve another, or the timeline.
      }
    }
  }

  private reportActivity(activity: MessageActivity): void {
    try {
      this.ctx?.onMessageActivity?.(activity);
    } catch {
      // The summaries catch up on focus or the next activity.
    }
  }

  private dispatchActionInsert(action: RawChatMessageAction): void {
    for (const channelId of this.channels.keys()) {
      this.patchCache(channelId, (cache) =>
        cache.byId[action.message_id]
          ? applyReactionInsert(cache, action)
          : cache,
      );
    }
  }

  private dispatchActionDelete(actionId: string): void {
    for (const channelId of this.channels.keys()) {
      this.patchCache(channelId, (cache) =>
        cache.actionIndex[actionId]
          ? applyReactionDelete(cache, actionId)
          : cache,
      );
    }
  }

  // ─── polling fallback (spec/ui/resilience/message-delivery.md#receiving-messages-realtime) ──────────────────────

  /**
   * Reconciles the polling state machine with the current channel statuses.
   * Called from `emitStatus`, so every status transition runs it exactly once.
   *
   * Deliberately does **not** emit — `emitStatus` is its only caller and
   * computes the status right after, so emitting here would recurse.
   */
  private syncPollingState(): void {
    // Offline is its own UI state and REST would fail anyway, so polling stands
    // down until the browser says we have a network again.
    const degraded = !this.offline && this.anyChannelDegraded();
    if (!degraded) {
      this.stopPolling();
      return;
    }
    // Already polling, or already counting down to it.
    if (this.polling || this.pollDegradeTimer) return;
    this.pollDegradeTimer = setTimeout(() => {
      this.pollDegradeTimer = null;
      this.startPolling();
    }, POLL_DEGRADE_AFTER_MS);
  }

  /**
   * Any channel not yet receiving live rows — including a first join still in
   * flight. This is the *polling* trigger: a join that never lands starves the
   * user exactly like a mid-session drop does.
   */
  private anyChannelDegraded(): boolean {
    for (const state of this.channels.values()) {
      if (state.status !== "live") return true;
    }
    return false;
  }

  /**
   * Any channel that was attached and lost it. This is the *display* trigger,
   * and deliberately excludes `"joining"`: a normal channel switch is a fresh
   * join that resolves in well under a second, and flashing "Reconnecting…"
   * every time the user clicks a channel is noise, not information. A join
   * that genuinely stalls is still caught — after `POLL_DEGRADE_AFTER_MS` the
   * poll loop starts and the banner appears then.
   */
  private anyChannelReconnecting(): boolean {
    for (const state of this.channels.values()) {
      if (state.status === "reconnecting") return true;
    }
    return false;
  }

  private startPolling(): void {
    if (this.pollTimer) return;
    this.polling = true;
    // Poll immediately: we have already waited out the degrade window, and
    // making the user wait another full interval for the first result would
    // put the worst case at 15s of silence.
    void this.pollOnce();
    this.pollTimer = setInterval(() => {
      void this.pollOnce();
    }, POLL_INTERVAL_MS);
    // Flip the UI to the degraded banner.
    this.emitStatus();
  }

  private stopPolling(): void {
    if (this.pollDegradeTimer) {
      clearTimeout(this.pollDegradeTimer);
      this.pollDegradeTimer = null;
    }
    if (this.pollTimer) {
      clearInterval(this.pollTimer);
      this.pollTimer = null;
    }
    this.polling = false;
  }

  /**
   * One poll pass over every channel still waiting on Realtime. Reuses
   * `runBackfill`, so merges go through the same `mergeSincePage` (id-keyed,
   * and trimming behind a full page) and the same last-seen cursor the
   * reconnect backfill uses — a row that arrives by poll and again by
   * Realtime collapses to one message.
   */
  private async pollOnce(): Promise<void> {
    if (!this.ctx || this.offline) return;
    // A degraded connection is exactly where a fetch can outlive the interval;
    // skipping the tick beats stacking requests on a link already in trouble.
    if (this.pollInFlight) return;
    this.pollInFlight = true;
    try {
      const pending: Promise<void>[] = [];
      for (const state of this.channels.values()) {
        if (state.status !== "live") {
          pending.push(this.runBackfill(state.channelId));
        }
      }
      // `runBackfill` swallows its own errors, so this never rejects.
      await Promise.all(pending);
    } finally {
      this.pollInFlight = false;
    }
  }

  private async runBackfill(channelId: string): Promise<void> {
    if (!this.ctx) return;
    try {
      const { rows, limit, gone } = await this.readBackfill(
        this.ctx.backfill,
        channelId,
      );
      if (gone) this.dropPurged(channelId, gone, rows);
      if (rows.length === 0) return;
      // The page is the newest rows after the cursor, so a full one may not
      // reach back to it. Merged as is, the rows in between would draw as
      // silence; `mergeSincePage` drops what it can't vouch for instead, and
      // paging back reads through the hole (#2807).
      this.patchCache(channelId, (cache) => mergeSincePage(cache, rows, limit));
      // A card that arrived while Realtime was down lands here instead.
      this.settleNotices(channelId, rows);
      // Advance the cursor to the newest row we just merged.
      let newest: string | null = null;
      let newestTs = "";
      for (const row of rows) {
        if (row.created_at > newestTs) {
          newestTs = row.created_at;
          newest = row.id;
        }
      }
      if (newest) this.writeLastSeen(channelId, newest);
    } catch {
      // A backfill failure is non-fatal; live subscription will catch up.
    }
  }

  /**
   * The cursor's row is gone from the server (purged, its Realtime delete
   * missed), and a purge deletes in slices whose other deletes were missed the
   * same way. The newest page read in its place holds every row the server
   * has up to its own newest, so a confirmed row the thread holds up to that,
   * or up to the gone row's instant when the thread holds it, and the page
   * doesn't carry is gone too. Web's `loadNewer` drops them on the same
   * answer; without this, mobile, which has no `loadNewer`, would show them
   * until the thread was read again from scratch.
   *
   * Never creates a cache for a channel whose first read hasn't landed.
   */
  private dropPurged(
    channelId: string,
    gone: string,
    rows: readonly RawChatMessage[],
  ): void {
    this.ctx?.queryClient.setQueryData<ChannelCache>(
      chatMessagesKey(channelId),
      (cache) => {
        if (!cache) return cache;
        const goneRow = cache.byId[gone];
        const instants = [goneRow, ...rows]
          .map((row) => (row ? Date.parse(row.created_at) : Number.NaN))
          .filter((time) => !Number.isNaN(time));
        if (instants.length === 0) return cache;
        return dropUnreadThrough(cache, rows, Math.max(...instants));
      },
    );
  }

  /**
   * The rows after the channel's cursor, or its newest page when it has none,
   * with the page size they were read at. A cursor the server no longer knows
   * is dropped, unless a live row has replaced it meanwhile, the read is made
   * again as the newest page, and the dropped cursor comes back as `gone`.
   */
  private async readBackfill(
    backfill: BackfillFetcher,
    channelId: string,
  ): Promise<{ rows: RawChatMessage[]; limit: number; gone?: string }> {
    const newestPage = async () => ({
      rows: await backfill(channelId, { limit: FIRST_PAGE_LIMIT }),
      limit: FIRST_PAGE_LIMIT,
    });
    const since = this.readLastSeen(channelId);
    if (!since) return newestPage();
    try {
      const limit = BACKFILL_PAGE_LIMIT;
      return { rows: await backfill(channelId, { since, limit }), limit };
    } catch (error) {
      if (!(error instanceof SinceCursorNotFoundError)) throw error;
      if (this.readLastSeen(channelId) === since) {
        this.writeLastSeen(channelId, null);
      }
      return { ...(await newestPage()), gone: since };
    }
  }

  /**
   * Evict any persisted heavy-command notice these rows confirm (#1909): the
   * card a heavy command (`/points`, `/task`, `/event`, `/hours`,
   * `/<vocab> add`) was waiting on. Now, not at the next load: by then the card
   * may be outside the loaded window, and the stored entry would come back as
   * a stale Retry.
   *
   * Addressed by each row's sender. A notice is filed under the member who
   * dispatched it, and the server posts that command's card as them.
   *
   * Guarded for the same reason as `readLastSeen`/`writeLastSeen`: this runs
   * inside the frame dispatch, after the cache merge, and an injected store is
   * not trusted to be no-throw.
   */
  private settleNotices(channelId: string, rows: RawChatMessage[]): void {
    try {
      const bySender = new Map<string, string[]>();
      for (const row of rows) {
        if (!row.sender_id || !row.client_message_id) continue;
        const ids = bySender.get(row.sender_id) ?? [];
        ids.push(row.client_message_id);
        bySender.set(row.sender_id, ids);
      }
      for (const [senderId, ids] of bySender) {
        dropNotices(channelId, senderId, ids, this.kvStore());
      }
    } catch {
      // A missed eviction leaves an entry the next load prunes if the card is
      // in its window; losing the cursor write after it would cost more.
    }
  }

  private patchCache(
    channelId: string,
    updater: (cache: ChannelCache) => ChannelCache,
  ): void {
    if (!this.ctx) return;
    this.ctx.queryClient.setQueryData<ChannelCache>(
      chatMessagesKey(channelId),
      (prev) => updater(prev ?? emptyCache()),
    );
  }

  private computeStatus(): ConnectionStatus {
    if (this.offline) return "offline";
    if (this.channels.size === 0) return "live";
    // Degraded, and the poll loop is running — messages are arriving, just
    // late. That is a materially different thing to tell the user than
    // "reconnecting", where nothing is arriving at all.
    if (this.polling) return "polling";
    return this.anyChannelReconnecting() ? "reconnecting" : "live";
  }

  private emitStatus(): void {
    this.syncPollingState();
    const status = this.computeStatus();
    for (const cb of this.statusListeners) cb(status);
  }
}

export const chatRealtime = new ChatRealtimeManager();
