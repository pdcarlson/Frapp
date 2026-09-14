"use client";

/**
 * Wires the chat realtime manager into the React tree and runs boot-time
 * outbox flush. Mounts under the existing `FrappProvider` + `QueryProvider` +
 * `NetworkProvider` in the dashboard tree, so by the time it renders we have
 * a query client, an api-sdk client, and the active chapter id available.
 *
 * Chapter branding is NOT applied here any more: `useChapterTheme()` moved to
 * `DashboardShell` with the #920 reskin, so the accent paints shell-wide
 * instead of only while a chat route is mounted.
 */

import { useContext, useEffect, useMemo } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useFrappClient } from "@repo/hooks";
import { useFrappUser } from "@/lib/auth/use-frapp-user";
import { useToast } from "@/hooks/use-toast";
import { asArray } from "@/lib/utils";
import { AnalyticsContext } from "@/lib/providers/analytics-provider";
import { browserKeyValueStore, browserNetworkState } from "@repo/chat-core/adapters";
import { getRealtimeClient } from "@/lib/realtime/supabase-realtime";
import { chatRealtime } from "@repo/chat-core/realtime-manager";
import { flushOutbox } from "@repo/chat-core/chat-client";
import { createDexieOutboxStore } from "./offline-queue";
import { useChatOutboundScope } from "./chat-scope";
import { useFirstChunkCache } from "./use-first-chunk-cache";
import { CachedViewerIdProvider } from "./viewer-id";
import type { RawChatMessage } from "@repo/chat-core/types";

export function ChatProvider({ children }: { children: React.ReactNode }) {
  const queryClient = useQueryClient();
  const apiClient = useFrappClient();
  const { userId } = useFrappUser();
  /*
    The scope every outbound Dexie row is keyed under (#2226). Binding the store
    to it is what makes the boot flush below safe on a shared browser: before
    this, `listQueued` returned every queued row in the database, so a member
    signing in inherited whatever the previous member had left unsent and posted
    it under their own token.

    Not `userId` above — that is `useViewerUserId` (`users.id`, a
    `GET /v1/users/me` round trip), and it can lag a same-tab account swap. The
    scope keys on the Supabase auth uid, which is the subject of the very token
    this flush POSTs under; `offline-queue.ts` has the full argument.
  */
  const scope = useChatOutboundScope();
  const outbox = useMemo(() => createDexieOutboxStore(scope), [scope]);
  const { toast } = useToast();
  const track = useContext(AnalyticsContext);
  const supabase = useMemo(() => getRealtimeClient(), []);

  /*
    The persisted first chunk (`1s`): seed the channel list and the cached
    message tails into the QueryClient before the network answers, and keep
    them written as the live data arrives.
    Mounted here rather than in `ChatShell` because it must run once for the
    surface, not once per pane, and because this is already the component that
    owns chat's boot-time side effects. It renders nothing and blocks nothing —
    a cold load with an empty cache is exactly the cold load we had before.

    It also hands back the viewer's cached `users.id` (#2249), published below so
    the timeline can attribute those rows without waiting on `GET /v1/users/me`.
    One read, one commit: the id and the rows it places come out of the same
    Dexie transaction, so there is no pass where the surface holds cached history
    it cannot put a side on.
  */
  const cachedViewerId = useFirstChunkCache();

  // Configure the realtime manager exactly once per mount. Manager is a
  // module singleton; this just rebinds it to the current QueryClient /
  // backfill fetcher.
  useEffect(() => {
    chatRealtime.configure({
      queryClient,
      supabase,
      viewerId: userId ?? null,
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
        return asArray<RawChatMessage>(data);
      },
    });
    return () => {
      chatRealtime.destroy();
    };
  }, [queryClient, supabase, apiClient, userId]);

  // Boot-time + on-reconnect outbox flush. The manager also pokes per-channel
  // flushes via `useChatChannel`, but this catches the first paint where no
  // channel may be active yet (e.g. drafts on a backgrounded channel).
  useEffect(() => {
    if (!userId) return;
    const ctx = {
      queryClient,
      apiClient,
      supabase,
      userId,
      toast,
      track: track ?? undefined,
      outbox,
      kv: browserKeyValueStore,
    };
    /*
      Caught, not floated. `flushOutbox` reads Dexie, and a rejected read — a
      cross-tab `VersionError` while the v1→v3 upgrade of #2226 lands, storage
      pressure, private mode — would otherwise surface as an unhandled
      rejection on every `online` event, once per reconnect, carrying nothing
      actionable. Each row's own send failure is already reported through the
      outbox's `failed` state and the inline Retry affordance.
    */
    const flush = () => {
      void flushOutbox(ctx).catch(() => {});
    };
    flush();
    // Trigger and gate ride the same connectivity signal: `flushOutbox`
    // consults the NetworkState port internally, so subscribe through the
    // same port rather than hand-rolling a window listener beside it.
    return browserNetworkState.subscribe((online) => {
      if (online) flush();
    });
  }, [queryClient, apiClient, supabase, userId, toast, track, outbox]);

  /*
    Only the *cached* half is published; `useChatViewerId` layers the live value
    over it. `viewer-id.tsx` has the argument — the short version is that a
    context carrying the resolved id would hand `null` to anything rendered
    outside this provider, which would be strictly worse than the behaviour this
    change is replacing.

    The live id above is **not** merged in here on purpose. It feeds
    `chatRealtime.configure` and the outbox flush, which are writes — a queued
    message's `senderId`, a reaction's `user_id`, a presence `track()` — and
    those keep waiting for identity to actually resolve. A cached id is good
    enough to choose a bubble's side; it is not a thing to sign a send with.
  */
  return (
    <CachedViewerIdProvider value={cachedViewerId}>
      {children}
    </CachedViewerIdProvider>
  );
}
