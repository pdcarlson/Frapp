/**
 * Binds `@repo/chat-core` to React Native and hands screens a ready
 * `ChatActionContext`.
 *
 * Web binds the manager from its dashboard shell
 * (`apps/web/lib/chat/use-chat-realtime-binding.ts`, called by
 * `DashboardShell`). Mobile cannot put it in a layout: `app/_layout.tsx` is
 * one of the eight frozen hotspot files (`spec/ui/mobile/navigation.md`
 * § Hotspot freeze), and a screen slice only adds files. So the wiring is a
 * hook the chat screens call instead of a provider above them.
 *
 * That is safe because `chatRealtime` is a module singleton and already
 * refcounts per channel: each screen owns only its own `subscribe`/
 * `unsubscribe` pair. Binding the manager to the app's clients is not a
 * screen's job any more: {@link useChatRealtimeBinding} does it once, app-wide,
 * from `components/app-runtime.tsx` (#3698), because chat home and the app
 * badge need the manager's inbox before any thread has been opened. Nothing
 * calls `destroy()` — with no single owning provider, nothing may tear the
 * manager out from under a screen.
 *
 * Imports are by subpath (`@repo/chat-core/adapters`, `/chat-client`,
 * `/realtime-manager`); the package has no barrel (#3228).
 */

import { useEffect, useLayoutEffect, useMemo, useRef } from "react";
import { AppState, type AppStateStatus } from "react-native";
import { useQueryClient } from "@tanstack/react-query";
import {
  useChatActivityHandler,
  useFrappClient,
  useViewerUserId,
} from "@repo/hooks";
import type { OutboxStore } from "@repo/chat-core/adapters";
import type { ChatActionContext } from "@repo/chat-core/chat-client";
import { flushOutbox } from "@repo/chat-core/chat-client";
import {
  chatRealtime,
  createBackfillFetcher,
} from "@repo/chat-core/realtime-manager";
import { useLatestTrack } from "@/lib/use-latest-track";
import { useIsApiAuthenticated } from "@/lib/use-is-api-authenticated";
import { getSupabaseClient } from "@/lib/supabase";
import { connectionMonitor } from "@/lib/connection/monitor";
import { useChatScope } from "./chat-scope";
import { getDraftStore, type DraftStore } from "./draft-store";
import { createAsyncStorageKeyValueStore } from "./key-value-store";
import { createMonitorNetworkState } from "./network-state";
import { getOutboxStore } from "./outbox-store";

/**
 * One instance per app process, mirroring the manager's own singleton scope.
 * The key-value mirror and the connectivity cache are process-wide state; a
 * per-screen instance would hydrate repeatedly and, worse, let two screens
 * disagree about whether the device is online.
 *
 * The outbox and draft stores are deliberately **not** here any more (#2228).
 * They hold what a member wrote, so they are keyed per member and built by
 * {@link useChatRuntime} from the live scope — a process-wide instance is
 * exactly the shared-device authorship bug that issue fixes. The key-value
 * mirror stays process-wide because what it serves on mobile is the
 * `chat:lastSeen:` backfill cursor, where a stale read costs a re-read
 * rather than misattributing a message. Heavy-command notices also pass
 * through it: since the chat + sheet's forms (#3865), mobile writes one when
 * a record lands but its card doesn't post. Each is keyed by the member who
 * sent it (`chat:heavy:v1:<userId>:<channelId>`), so another member on the
 * same phone never reads it (`spec/ui/mobile/patterns.md` § Chat).
 */
export const chatKeyValueStore = createAsyncStorageKeyValueStore();
export const chatNetworkState = createMonitorNetworkState(connectionMonitor);

let bootPromise: Promise<void> | null = null;

/**
 * Hydrates the key-value mirror and primes the connectivity cache. Both are
 * synchronous ports over asynchronous platform APIs, so they need one await
 * before first read. Runs at most once per process.
 *
 * Pre-#2228 rows are deliberately left where they are rather than swept — see
 * `outbox-store.ts`: they are unreachable once the scoped keys land, and
 * deleting composed-but-unsent messages is the one thing
 * `spec/ui/resilience/principles.md` §5 forbids.
 */
export function bootChatAdapters(): Promise<void> {
  bootPromise ??= Promise.all([
    chatKeyValueStore.hydrate(),
    chatNetworkState.prime(),
  ]).then(() => undefined);
  return bootPromise;
}

function isForeground(): boolean {
  return AppState.currentState === "active";
}

/**
 * Binds the chat realtime manager to the app's clients, once, for the life of
 * the process (#3698). Mounted from `components/app-runtime.tsx`, above the
 * auth gate, so it runs before the member reaches any screen. It first binds
 * once a member is signed in and their `users.id` has resolved, never before;
 * after that every viewer change rebinds it, a sign-out (`null`) included, and
 * `configure` rejoins the inbox under the new session.
 *
 * What it adds over the per-thread wiring this replaced:
 *
 * - **The inbox from launch.** The manager's `chat:inbox:global` channel
 *   reports every new message the member may read, and
 *   `useChatActivityHandler` turns that into fresh unread counts (chat home's
 *   badges, the app badge through `use-badge-sync.ts`) and a fresh Messages
 *   order, or re-stamps the open thread read when the message landed in it.
 *   Bound per screen, none of this ran until a thread was opened.
 * - **Resume on foreground.** iOS and Android suspend the socket in the
 *   background, and the client finds out only at its next heartbeat. Coming
 *   back from the background calls `chatRealtime.resume()`, which probes the
 *   socket, reads every open thread since its cursor, and re-reads the
 *   summaries at once.
 */
export function useChatRealtimeBinding(): void {
  const queryClient = useQueryClient();
  const apiClient = useFrappClient();
  const supabase = useMemo(() => getSupabaseClient(), []);
  // Above the auth gate, so `/v1/users/me` is read only once someone is signed
  // in; ungated, every signed-out launch and foreground sent it without a
  // token (the hazard `lib/notifications/use-badge-sync.ts` gates against).
  const signedIn = useIsApiAuthenticated();
  const viewerId = useViewerUserId({ enabled: signedIn });
  const onMessageActivity = useChatActivityHandler(viewerId, isForeground);
  /**
   * Once bound, the manager is rebound on every viewer change, a `null` one
   * included: `configure({ viewerId: null })` rejoins the inbox and every
   * thread under the session the device now holds. That covers a sign-out, so
   * a signed-out device stops receiving the member's messages, and an
   * in-place account swap (a magic link for another member), whose old
   * channels must not stay joined under the previous member until the new
   * one's `/v1/users/me` answers. A chapter switch passes through the same
   * `null` while its re-read lands and pays a second rejoin; it can't be told
   * apart from a swap here, and a swap is the one that must not wait.
   */
  const boundRef = useRef(false);

  useEffect(() => {
    // Before the first member is known, nothing is joined at all.
    if (!supabase || (!viewerId && !boundRef.current)) return;
    let cancelled = false;

    void bootChatAdapters().then(() => {
      if (cancelled) return;
      chatRealtime.configure({
        queryClient,
        supabase,
        viewerId,
        kv: chatKeyValueStore,
        net: chatNetworkState,
        backfill: createBackfillFetcher(apiClient),
        onMessageActivity,
      });
      boundRef.current = true;
    });

    return () => {
      cancelled = true;
    };
  }, [queryClient, supabase, apiClient, viewerId, onMessageActivity]);

  useEffect(() => {
    let previous: AppStateStatus | null = AppState.currentState;
    const subscription = AppState.addEventListener("change", (next) => {
      // `background`, not `inactive`: a permission prompt or the notification
      // shade passes through `inactive` with the socket still up. The same
      // line `lib/connection/monitor.ts` draws.
      if (next === "active" && previous === "background") {
        chatRealtime.resume();
      }
      previous = next;
    });
    return () => subscription.remove();
  }, []);
}

export interface ChatRuntime {
  /** `null` until the viewer's app user resolves; no writes without identity. */
  ctx: ChatActionContext | null;
  viewerId: string | null;
  /**
   * Bound to the signed-in member. `listForChannel` on this can only ever
   * return rows that member wrote — see `chat-scope.ts`.
   */
  outbox: OutboxStore;
  /** Bound to the signed-in member, for the composer's draft round-trip. */
  drafts: DraftStore;
}

/**
 * The runtime without its outbox flush: the same `ctx`, `viewerId`, outbox
 * and drafts, for a screen that only dispatches row writes while the channel
 * screen under it owns the flush (the open thread, #4297). The flush effect in
 * {@link useChatRuntime} runs once per caller, and `flushOutbox` has no
 * in-flight guard, so a second flushing caller POSTs every queued message
 * twice on each reconnect.
 */
export function useChatActionContext(): ChatRuntime {
  const queryClient = useQueryClient();
  const apiClient = useFrappClient();
  const supabase = useMemo(() => getSupabaseClient(), []);

  /**
   * `chat_messages.sender_id` references `users(id)`, which is a different
   * column from the Supabase auth uid held by `lib/auth-session.tsx`. Using the
   * auth uid renders and sends without error but breaks own-message styling and
   * the RLS-scoped delete behind `unreact`.
   *
   * The runtime narrowing lives in `useViewerUserId` (`@repo/hooks`) because
   * `/v1/users/me` carries no response schema and infers as `never`, so a direct
   * `user.id` compiles on neither client.
   */
  const viewerId = useViewerUserId();

  /**
   * The tenant boundary for everything this device has written and not sent.
   *
   * Distinct from `viewerId` above and not interchangeable with it: `viewerId`
   * is `users.id`, the column `chat_messages.sender_id` references, and it is
   * what the server attributes a send to. The scope carries the Supabase auth
   * uid — the JWT subject the flush will POST under — so "rows this store can
   * see" and "rows this token may author" are the same set. `chat-scope.ts`
   * has the full argument, including why it is sticky.
   */
  const scope = useChatScope();

  /**
   * Looked up rather than constructed: one store per member per process, so the
   * store's serialization chain stays the single chain its contract promises
   * and its identity stays stable for the effects keyed on it downstream.
   * Switching member yields a different store addressing different keys, which
   * is what makes the boundary hold.
   */
  const outbox = useMemo(() => getOutboxStore(scope), [scope]);
  const drafts = useMemo(() => getDraftStore(scope), [scope]);

  /**
   * The outbox lifecycle events (`spec/behavior/observability.md` § Outbox
   * Telemetry), as web passes them: chat-core calls `ctx.track` at each step of
   * a queued send. `track` holds the chapter opt-out itself, and sends nothing
   * outside `AnalyticsProvider`. Stable, so `ctx` keeps its identity when the
   * opt-out answer arrives and the flush effect below doesn't start a second
   * flush (`useLatestTrack`).
   */
  const track = useLatestTrack();

  const ctx = useMemo<ChatActionContext | null>(() => {
    if (!supabase || !viewerId) return null;
    return {
      queryClient,
      apiClient,
      supabase,
      userId: viewerId,
      outbox,
      net: chatNetworkState,
      track,
    };
  }, [queryClient, apiClient, supabase, viewerId, outbox, track]);

  return { ctx, viewerId, outbox, drafts };
}

/**
 * The chat runtime, plus the outbox flush: once on boot and on every return
 * online. One caller per mounted chat: the channel's `useChatChannel`.
 */
export function useChatRuntime(): ChatRuntime {
  const runtime = useChatActionContext();
  const { ctx } = runtime;
  // Boot flush, then re-flush on every reconnect. Both the trigger and the gate
  // ride the same port: `flushOutbox` consults `net` internally, so subscribing
  // through it keeps the two consistent.
  const ctxRef = useRef(ctx);
  useLayoutEffect(() => {
    ctxRef.current = ctx;
  }, [ctx]);
  useEffect(() => {
    if (!ctx) return;
    void bootChatAdapters().then(() => {
      if (ctxRef.current) void flushOutbox(ctxRef.current);
    });
    return chatNetworkState.subscribe((online) => {
      if (online && ctxRef.current) void flushOutbox(ctxRef.current);
    });
  }, [ctx]);

  return runtime;
}
