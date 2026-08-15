/**
 * The platform ports for `@repo/chat-core`.
 *
 * The chat hot path runs on web today and React Native next (#937), so every
 * place it used to reach for a browser global goes through one of these
 * interfaces instead. Web wiring mostly leans on the browser defaults below;
 * mobile injects its own implementations (AsyncStorage/MMKV behind
 * `KeyValueStore`, NetInfo behind `NetworkState`, a SQLite- or
 * AsyncStorage-backed `OutboxStore`).
 *
 * `OutboxStore` has no default on purpose: persistence is the one port with
 * real platform machinery behind it (Dexie/IndexedDB on web — see
 * `apps/web/lib/chat/offline-queue.ts`), and silently dropping queued sends is
 * exactly the failure it exists to prevent, so constructing a
 * `ChatActionContext` without one is a compile error rather than a no-op.
 */

import type { SupabaseClient } from "@supabase/supabase-js";

/** Small synchronous string store — `localStorage`-shaped. */
export interface KeyValueStore {
  get(key: string): string | null;
  set(key: string, value: string): void;
  remove(key: string): void;
}

/** Connectivity signal. "Unknown" counts as online. */
export interface NetworkState {
  isOffline(): boolean;
  /**
   * Fires on connectivity flips — `online === true` means the platform came
   * back online. Returns an unsubscribe.
   */
  subscribe(onChange: (online: boolean) => void): () => void;
}

/**
 * The topic-occupancy helpers the realtime manager frees topics through
 * before minting a channel. See `defaultTopicRegistry` for the fallback and
 * for why the web glue injects its own implementation instead.
 */
export interface TopicRegistry {
  isTopicOccupied(client: SupabaseClient, topic: string): boolean;
  releaseTopic(client: SupabaseClient, topic: string): Promise<void>;
}

export type OutboxStatus = "queued" | "failed";

export interface OutboxRow {
  clientId: string;
  channelId: string;
  /** Plain-text message content sent on the wire. */
  body: string;
  /**
   * Persisted message intent so a flushed retry reconstructs the *full*
   * payload — not just the body. Optional for forward-compat with rows
   * written by older clients.
   */
  kind?: string;
  payload?: Record<string, unknown> | null;
  replyToId?: string | null;
  attempts: number;
  queuedAt: number;
  status: OutboxStatus;
  lastError?: string;
}

/** `enqueue`'s input: a row minus the bookkeeping fields the store fills in. */
export type NewOutboxRow = Omit<OutboxRow, "attempts" | "status" | "queuedAt"> &
  Partial<Pick<OutboxRow, "attempts" | "status" | "queuedAt">>;

/**
 * Durable queue for messages composed while offline or mid-failure, plus the
 * one draft operation that sits on the send hot path.
 */
export interface OutboxStore {
  enqueue(row: NewOutboxRow): Promise<OutboxRow>;
  dequeue(clientId: string): Promise<void>;
  requeue(clientId: string): Promise<void>;
  markFailed(clientId: string, error: string): Promise<void>;
  bumpAttempt(clientId: string, error: string): Promise<void>;
  /** All queued rows ordered FIFO — drives the in-order flush loop. */
  listQueued(): Promise<OutboxRow[]>;
  /**
   * All outbox rows for a channel (queued + failed), used on boot to hydrate
   * the cache.
   */
  listForChannel(channelId: string): Promise<OutboxRow[]>;
  /**
   * Clears the composer draft for a channel. A drafts-table op rather than an
   * outbox one, but it sits on the send hot path — `sendMessage` clears the
   * draft the moment the message is enqueued, which also covers slash-command
   * dispatch — so it rides on this port instead of forcing a second one.
   */
  clearDraft(channelId: string): Promise<void>;
}

/**
 * `KeyValueStore` over `window.localStorage`, degrading silently where it is
 * unavailable (SSR, private mode) — the exact semantics the realtime manager
 * had inline before the extraction.
 */
export const browserKeyValueStore: KeyValueStore = {
  get(key) {
    if (typeof window === "undefined") return null;
    try {
      return window.localStorage.getItem(key);
    } catch {
      return null;
    }
  },
  set(key, value) {
    if (typeof window === "undefined") return;
    try {
      window.localStorage.setItem(key, value);
    } catch {
      // localStorage unavailable (e.g. private mode) — degrade silently.
    }
  },
  remove(key) {
    if (typeof window === "undefined") return;
    try {
      window.localStorage.removeItem(key);
    } catch {
      // Same degradation as `set`.
    }
  },
};

/** `NetworkState` over `navigator.onLine` and window online/offline events. */
export const browserNetworkState: NetworkState = {
  isOffline() {
    return typeof navigator !== "undefined" && navigator.onLine === false;
  },
  subscribe(onChange) {
    if (typeof window === "undefined") return () => {};
    const handleOnline = () => onChange(true);
    const handleOffline = () => onChange(false);
    window.addEventListener("online", handleOnline);
    window.addEventListener("offline", handleOffline);
    return () => {
      window.removeEventListener("online", handleOnline);
      window.removeEventListener("offline", handleOffline);
    };
  },
};
