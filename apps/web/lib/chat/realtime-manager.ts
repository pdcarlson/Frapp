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
 *   - Aggregates per-channel subscribe status into `"live" | "reconnecting" |
 *     "offline"` for the UI "Reconnecting…" pill, with exponential backoff
 *     (1→2→4→8→16→30s capped) on `CHANNEL_ERROR`/`TIMED_OUT`.
 *   - On reconnect for a channel, **resubscribe first** (so any live row
 *     between backfill and re-attach goes through the same idempotent merge),
 *     **then** REST-backfill since the last confirmed message id (persisted
 *     per channel in localStorage). Subscribe-then-backfill tolerates a
 *     harmless overlap (dedup by id) instead of risking a gap.
 *
 * Channels are ref-counted, so the sidebar can pre-subscribe for unread
 * counts without the timeline tearing the subscription down.
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
  mergeServerRow,
  emptyCache,
} from "./cache";
import {
  chatMessagesKey,
  type ChannelCache,
  type RawChatMessage,
  type RawChatMessageAction,
} from "./types";

export type ConnectionStatus = "live" | "reconnecting" | "offline";

const BACKOFF_STEPS_MS = [1000, 2000, 4000, 8000, 16000, 30000] as const;
const LAST_SEEN_PREFIX = "chat:lastSeen:";

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
}

class ChatRealtimeManager {
  private ctx: ManagerContext | null = null;
  private channels = new Map<string, PerChannelState>();
  private actionsChannel: RealtimeChannel | null = null;
  private statusListeners = new Set<(status: ConnectionStatus) => void>();
  private offline = false;
  private typingTickHandle: ReturnType<typeof setInterval> | null = null;

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
    };
    this.channels.set(channelId, state);
    this.openChannel(state);
    void this.runBackfill(channelId);
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

  private openChannel(state: PerChannelState): void {
    if (!this.ctx) return;
    const { supabase } = this.ctx;
    if (state.channel) {
      void supabase.removeChannel(state.channel);
    }

    const channel = supabase.channel(`chat:channel:${state.channelId}`, {
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
        const row =
          (payload.new as RawChatMessage | undefined) ??
          (payload.old as RawChatMessage | undefined);
        if (!row || !row.id) return;
        this.patchCache(state.channelId, (cache) => mergeServerRow(cache, row));
        if (row.id) writeLastSeen(state.channelId, row.id);
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
    channel.subscribe((subscribeStatus) => {
      if (subscribeStatus === "SUBSCRIBED") {
        state.status = "live";
        state.backoffStep = 0;
        if (state.retryTimer) {
          clearTimeout(state.retryTimer);
          state.retryTimer = null;
        }
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

  private ensureActionsChannel(): void {
    if (!this.ctx) return;
    if (this.actionsChannel) return;
    const channel = this.ctx.supabase.channel("chat:actions:global");
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
    let anyReconnecting = false;
    let anyChannel = false;
    for (const state of this.channels.values()) {
      anyChannel = true;
      if (state.status !== "live") anyReconnecting = true;
    }
    if (!anyChannel) return "live";
    return anyReconnecting ? "reconnecting" : "live";
  }

  private emitStatus(): void {
    const status = this.computeStatus();
    for (const cb of this.statusListeners) cb(status);
  }
}

export const chatRealtime = new ChatRealtimeManager();
