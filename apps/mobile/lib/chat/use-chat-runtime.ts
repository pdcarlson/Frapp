/**
 * Binds `@repo/chat-core` to React Native and hands screens a ready
 * `ChatActionContext`.
 *
 * Web does this in a `ChatProvider` mounted in its tree
 * (`apps/web/lib/chat/chat-provider.tsx`). Mobile cannot: `app/_layout.tsx` is
 * one of the seven frozen hotspot files (`spec/ui/mobile/navigation.md`
 * § Hotspot freeze), and a screen slice only adds files. So the wiring is a
 * hook the chat screens call instead of a provider above them.
 *
 * That is safe because `chatRealtime` is a module singleton and already
 * refcounts per channel: `configure` is an idempotent rebind, and each screen
 * owns only its own `subscribe`/`unsubscribe` pair. Nothing here calls
 * `destroy()` — with no single owning provider, one screen unmounting must not
 * tear the manager out from under another.
 *
 * Imports are **subpath-only** (`@repo/chat-core/adapters`, `/chat-client`,
 * `/realtime-manager`). The barrel additionally re-exports `./dispatch` →
 * `@repo/chat-integrations`, a package whose `types` and `require` conditions
 * point at a `dist/` that is never built (#989). It resolves today, but slash
 * commands are out of scope for this slice and there is no reason to pull that
 * edge in.
 */

import { useEffect, useLayoutEffect, useMemo, useRef } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useFrappClient, useViewerUserId } from "@repo/hooks";
import type { OutboxStore } from "@repo/chat-core/adapters";
import type { ChatActionContext } from "@repo/chat-core/chat-client";
import { flushOutbox } from "@repo/chat-core/chat-client";
import { chatRealtime } from "@repo/chat-core/realtime-manager";
import type { RawChatMessage } from "@repo/chat-core/types";
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
 * `chat:lastSeen:` backfill cursor, where a stale read widens a backfill
 * rather than misattributing a message; heavy-command notices also pass
 * through it, but mobile never writes one (`spec/ui/mobile/patterns.md`
 * § Chat).
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

export function useChatRuntime(): ChatRuntime {
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

  useEffect(() => {
    if (!supabase) return;
    let cancelled = false;

    void bootChatAdapters().then(() => {
      if (cancelled) return;
      chatRealtime.configure({
        queryClient,
        supabase,
        viewerId,
        kv: chatKeyValueStore,
        net: chatNetworkState,
        backfill: async (channelId, since) => {
          const { data, error } = await apiClient.GET(
            "/v1/channels/{id}/messages",
            {
              params: {
                path: { id: channelId },
                query: since ? { since, limit: 100 } : { limit: 50 },
              },
            },
          );
          if (error) throw error as Error;
          return Array.isArray(data) ? (data as RawChatMessage[]) : [];
        },
      });
    });

    return () => {
      cancelled = true;
    };
  }, [queryClient, supabase, apiClient, viewerId]);

  const ctx = useMemo<ChatActionContext | null>(() => {
    if (!supabase || !viewerId) return null;
    return {
      queryClient,
      apiClient,
      supabase,
      userId: viewerId,
      outbox,
      net: chatNetworkState,
    };
  }, [queryClient, apiClient, supabase, viewerId, outbox]);

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

  return { ctx, viewerId, outbox, drafts };
}
