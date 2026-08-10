"use client";

/**
 * Singleton realtime manager for chat.
 *
 * Responsibilities:
 *   - Per visible channel: Postgres Changes on `chat_messages` (filtered by
 *     channel_id) → `mergeServerRow` into the normalized cache. Also a
 *     Broadcast endpoint per channel for typing + presence.
 *   - One global Postgres Changes subscription on `chat_message_actions` (no
 *     `channel_id` column on that table to filter by) — events are dispatched
 *     to whichever subscribed channel cache holds the message. Reactions on
 *     not-yet-loaded messages are intentionally dropped; backfill recovers
 *     them.
 *   - Aggregates per-channel subscribe status into `"live" | "polling" |
 *     "reconnecting" | "offline"` for the UI "Reconnecting…" pill, with
 *     exponential backoff (1→2→4→8→16→30s capped) on
 *     `CHANNEL_ERROR`/`TIMED_OUT`.
 *   - Degrades to a REST polling fallback when any subscribed channel has been
 *     non-live for longer than `POLL_DEGRADE_AFTER_MS`, re-running the same
 *     backfill every `POLL_INTERVAL_MS` until Realtime recovers
 *     (`spec/ui/resilience.md` §3.2). Reconnect backoff keeps running
 *     underneath, so polling is a stopgap, never a replacement.
 *   - For every channel attach — both the initial join and every reconnect —
 *     **resubscribe first** (so any live row between backfill and re-attach
 *     goes through the same idempotent merge), **then** REST-backfill since
 *     the last confirmed message id (persisted per channel in localStorage).
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
  emptyCache,
  mergeServerRow,
  removeMessage,
} from "./cache";
import {
  chatMessagesKey,
  type ChannelCache,
  type RawChatMessage,
  type RawChatMessageAction,
} from "./types";

export type ConnectionStatus = "live" | "polling" | "reconnecting" | "offline";

const BACKOFF_STEPS_MS = [1000, 2000, 4000, 8000, 16000, 30000] as const;
const LAST_SEEN_PREFIX = "chat:lastSeen:";

/**
 * How long a channel may sit non-live before we stop waiting on Realtime and
 * start pulling messages over REST. `spec/ui/resilience.md` §3.2: "Disconnected
 * (>10s) → switch to polling mode".
 */
export const POLL_DEGRADE_AFTER_MS = 10_000;

/** Poll cadence once degraded — spec §3.2: "Poll every 5s for new messages". */
export const POLL_INTERVAL_MS = 5_000;

function readLastSeen(channelId: string): string | null {
  if (typeof window === "undefined") return null;
  try {
    return window.localStorage.getItem(LAST_SEEN_PREFIX + channelId);
  } catch {
    return null;
  }
}

function writeLastSeen(channelId: string, messageId: string | null): void {
  if (typeof window === "undefined") return;
  try {
    if (!messageId) window.localStorage.removeItem(LAST_SEEN_PREFIX + channelId);
    else window.localStorage.setItem(LAST_SEEN_PREFIX + channelId, messageId);
  } catch {
    // localStorage unavailable (e.g. private mode) — degrade silently.
  }
}

export interface BackfillFetcher {
  (channelId: string, sinceMessageId: string | null): Promise<RawChatMessage[]>;
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
}

interface PerChannelState {
  channelId: string;
  refCount: number;
  channel: RealtimeChannel | null;
  status: "joining" | "live" | "reconnecting";
  backoffStep: number;
  retryTimer: ReturnType<typeof setTimeout> | null;
  typingUsers: Map<string, number>; // userId → expires-at ms
  typingLastEmit: number;
  /**
   * Ticket for the in-flight attach. Freeing an occupied topic is async, so two
   * reopens can overlap; only the holder of the newest ticket is allowed to
   * install a channel. See `attachChannel`.
   */
  attachSeq: number;
}

class ChatRealtimeManager {
  private ctx: ManagerContext | null = null;
  private channels = new Map<string, PerChannelState>();
  private actionsChannel: RealtimeChannel | null = null;
  /** `attachSeq`'s equivalent for the single global actions channel. */
  private actionsAttachSeq = 0;
  private statusListeners = new Set<(status: ConnectionStatus) => void>();
  private offline = false;
  private typingTickHandle: ReturnType<typeof setInterval> | null = null;
  /** Armed while a channel is non-live; firing promotes us into polling. */
  private pollDegradeTimer: ReturnType<typeof setTimeout> | null = null;
  /** The 5s poll loop itself. Non-null exactly while `polling` is true. */
  private pollTimer: ReturnType<typeof setInterval> | null = null;
  private polling = false;
  /** Guards against overlapping poll passes on a slow connection. */
  private pollInFlight = false;

  configure(ctx: ManagerContext): void {
    this.ctx = ctx;
    this.ensureActionsChannel();
    this.ensureTypingTick();
    if (typeof window !== "undefined") {
      this.offline = !window.navigator.onLine;
      window.addEventListener("online", this.handleOnline);
      window.addEventListener("offline", this.handleOffline);
    }
  }

  destroy(): void {
    if (typeof window !== "undefined") {
      window.removeEventListener("online", this.handleOnline);
      window.removeEventListener("offline", this.handleOffline);
    }
    for (const state of this.channels.values()) {
      if (state.retryTimer) clearTimeout(state.retryTimer);
      if (state.channel) void this.ctx?.supabase.removeChannel(state.channel);
    }
    this.channels.clear();
    if (this.actionsChannel) {
      void this.ctx?.supabase.removeChannel(this.actionsChannel);
      this.actionsChannel = null;
    }
    if (this.typingTickHandle) clearInterval(this.typingTickHandle);
    this.typingTickHandle = null;
    this.stopPolling();
    // Must reset here, not in stopPolling: a backfill that never settles would
    // otherwise leave the flag latched on this module singleton, and the next
    // configure() would come up with polling permanently short-circuited.
    this.pollInFlight = false;
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
      typingLastEmit: 0,
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

  subscribeStatus(cb: (status: ConnectionStatus) => void): () => void {
    this.statusListeners.add(cb);
    cb(this.computeStatus());
    return () => {
      this.statusListeners.delete(cb);
    };
  }

  emitTyping(channelId: string, userId: string, displayName?: string): void {
    const state = this.channels.get(channelId);
    if (!state || !state.channel) return;
    const now = Date.now();
    if (now - state.typingLastEmit < 3000) return;
    state.typingLastEmit = now;
    void state.channel.send({
      type: "broadcast",
      event: "typing",
      payload: { userId, displayName: displayName ?? null },
    });
  }

  getTypingUsers(channelId: string): string[] {
    const state = this.channels.get(channelId);
    if (!state) return [];
    const now = Date.now();
    const out: string[] = [];
    for (const [user, expires] of state.typingUsers) {
      if (expires > now) out.push(user);
    }
    return out;
  }

  // ─── internals ──────────────────────────────────────────────────────────

  private handleOnline = (): void => {
    this.offline = false;
    for (const state of this.channels.values()) {
      this.reopenChannel(state);
    }
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
      }
      // Status listeners drive a re-render; piggyback typing changes through them.
      if (dirty) this.emitStatus();
    }, 1500);
  }

  /**
   * Is anything still registered under this topic?
   *
   * `RealtimeClient.channel(topic)` hands back the *existing* instance whenever
   * one is, so this is the difference between minting a fresh channel and
   * silently getting the old one back.
   */
  private isTopicOccupied(topic: string): boolean {
    if (!this.ctx) return false;
    const realtimeTopic = `realtime:${topic}`;
    return this.ctx.supabase
      .getChannels()
      .some((channel) => channel.topic === realtimeTopic);
  }

  /**
   * Frees a topic so the next `supabase.channel(topic)` mints a genuinely new
   * instance.
   *
   * `removeChannel()` only calls `teardown()` — the step that actually
   * unregisters the channel — when `unsubscribe()` resolves `"ok"`. Tearing
   * down unconditionally is what makes this airtight, and it closes two
   * distinct failures at once:
   *
   *   - a reused `joined`/`joining` instance makes
   *     `.on("postgres_changes", …)` **throw**, which is what took the
   *     dashboard shell down (#783); and
   *   - a reused `leaving`/`errored` instance throws nothing but never
   *     delivers a row, so the channel looks attached and stays silent.
   *
   * `unsubscribe()` resolves rather than rejects and is bounded by the client's
   * own timeout, so this cannot wedge a reattach — and the poll fallback
   * covers the gap if it does take the full timeout.
   */
  private async releaseTopic(topic: string): Promise<void> {
    const supabase = this.ctx?.supabase;
    if (!supabase) return;
    const realtimeTopic = `realtime:${topic}`;
    // `getChannels()` returns the client's live array and teardown mutates it,
    // so iterate a snapshot.
    for (const channel of [...supabase.getChannels()]) {
      if (channel.topic !== realtimeTopic) continue;
      try {
        await channel.unsubscribe();
      } catch {
        // Already gone, or the socket is down — teardown below is what counts.
      }
      try {
        channel.teardown();
      } catch {
        // Already torn down.
      }
    }
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
   * DOM event handler — none of them can await, and a rejection escaping into
   * a commit phase is exactly how this unmounted the shell.
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

    const channel = supabase.channel(topic, {
      config: { broadcast: { self: false }, presence: { key: "" } },
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
        if (next && next.id) {
          // INSERT / UPDATE — full row is present and authoritative.
          this.patchCache(state.channelId, (cache) =>
            mergeServerRow(cache, next),
          );
          writeLastSeen(state.channelId, next.id);
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
        | { userId?: string; displayName?: string | null }
        | undefined;
      if (!payload?.userId) return;
      state.typingUsers.set(payload.userId, Date.now() + 4000);
      this.emitStatus();
    });

    state.channel = channel;
    const viewerId = this.ctx?.viewerId ?? null;
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
        // ADR-10: track the viewer in this channel's presence map so the
        // push worker can skip them on the same topic. `track` is fire-and
        // -forget; a failure here is harmless (worst case is one extra
        // push) so we intentionally swallow.
        if (viewerId) {
          void channel.track({ userId: viewerId, ts: Date.now() });
        }
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
   * own teardown exactly like `openChannel` did. `ChatProvider`'s effect deps
   * include `apiClient`/`userId`, so this re-fires on ordinary re-auth.
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
      // Reactions fall back to the per-channel backfill, so a failure here
      // degrades one feature — it must never propagate out of `configure()`.
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
        cache.actionIndex[actionId] ? applyReactionDelete(cache, actionId) : cache,
      );
    }
  }

  // ─── polling fallback (spec/ui/resilience.md §3.2) ──────────────────────

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
   * `runBackfill`, so merges go through the same id-keyed `mergeServerRow`
   * path and the same last-seen cursor the reconnect backfill uses — a row
   * that arrives by poll and again by Realtime collapses to one message.
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
      const since = readLastSeen(channelId);
      const rows = await this.ctx.backfill(channelId, since);
      if (rows.length === 0) return;
      this.patchCache(channelId, (cache) => {
        let next = cache;
        for (const row of rows) {
          next = mergeServerRow(next, row);
        }
        return next;
      });
      // Advance the cursor to the newest row we just merged.
      let newest = since;
      let newestTs = "";
      for (const row of rows) {
        if (row.created_at > newestTs) {
          newestTs = row.created_at;
          newest = row.id;
        }
      }
      if (newest) writeLastSeen(channelId, newest);
    } catch {
      // A backfill failure is non-fatal; live subscription will catch up.
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
