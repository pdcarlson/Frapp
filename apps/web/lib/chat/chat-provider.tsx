"use client";

/**
 * Wires the chat realtime manager into the React tree and runs boot-time
 * outbox flush. Mounts under the existing `FrappProvider` + `QueryProvider` +
 * `NetworkProvider` in the dashboard tree, so by the time it renders we have
 * a query client, an api-sdk client, and the active chapter id available.
 *
 * Also calls `useChapterTheme()` so the chat surface picks up the chapter's
 * brand palette without a separate hook on every leaf component.
 */

import { useEffect, useMemo } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useFrappClient } from "@repo/hooks";
import { useChapterTheme } from "@/lib/hooks/use-chapter-theme";
import { useFrappUser } from "@/lib/auth/use-frapp-user";
import { useToast } from "@/hooks/use-toast";
import { browserNetworkState } from "@repo/chat-core";
import { getRealtimeClient } from "@/lib/realtime/supabase-realtime";
import { chatRealtime } from "./realtime-manager";
import { flushOutbox } from "./chat-client";
import { dexieOutboxStore } from "./offline-queue";
import type { RawChatMessage } from "./types";

export function ChatProvider({ children }: { children: React.ReactNode }) {
  const queryClient = useQueryClient();
  const apiClient = useFrappClient();
  const { userId } = useFrappUser();
  const { toast } = useToast();
  const supabase = useMemo(() => getRealtimeClient(), []);

  // Apply the active chapter's derived palette to :root.
  useChapterTheme();

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
        return Array.isArray(data) ? (data as RawChatMessage[]) : [];
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
      outbox: dexieOutboxStore,
    };
    void flushOutbox(ctx);
    // Trigger and gate ride the same connectivity signal: `flushOutbox`
    // consults the NetworkState port internally, so subscribe through the
    // same port rather than hand-rolling a window listener beside it.
    return browserNetworkState.subscribe((online) => {
      if (online) void flushOutbox(ctx);
    });
  }, [queryClient, apiClient, supabase, userId, toast]);

  return <>{children}</>;
}
