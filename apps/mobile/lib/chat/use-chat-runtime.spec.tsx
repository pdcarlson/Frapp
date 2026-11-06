/** @vitest-environment jsdom */
/**
 * The one claim here is the realtime manager's wiring: mobile hands it
 * chat-core's own backfill read (#2807), the read web's `ChatProvider` hands
 * it too. The full-page rule and the unknown-cursor recovery live in that read
 * and the manager (`packages/chat-core/src/realtime-manager.spec.ts`), so an
 * inline fetcher here would type-check and quietly skip the second.
 *
 * The second is the outbox telemetry sink: chat-core's `ctx.track` reaches
 * the app's `AnalyticsContext` `track`, as web's does, without `ctx` changing
 * identity when `track` does.
 *
 * Everything else the hook touches is a stand-in: the platform ports, the
 * member-scoped stores, and the outbox flush.
 */

import React, { createContext } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderHook, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

const apiClient = vi.hoisted(() => ({ GET: vi.fn() }));
const viewer = vi.hoisted(() => ({ id: null as string | null }));

vi.mock("@repo/hooks", () => ({
  useFrappClient: () => apiClient,
  useViewerUserId: () => viewer.id,
}));
type TrackFn = (name: string, properties?: Record<string, unknown>) => void;
const analytics = vi.hoisted(() => ({
  context: null as React.Context<TrackFn | null> | null,
}));
vi.mock("@/lib/analytics-provider", () => {
  analytics.context = createContext<TrackFn | null>(null);
  return { AnalyticsContext: analytics.context };
});
vi.mock("@repo/chat-core/realtime-manager", () => ({
  chatRealtime: { configure: vi.fn() },
  createBackfillFetcher: vi.fn((client: unknown) => ({ readsWith: client })),
}));
vi.mock("@repo/chat-core/chat-client", () => ({ flushOutbox: vi.fn() }));
vi.mock("@/lib/supabase", () => ({ getSupabaseClient: () => ({}) }));
vi.mock("@/lib/connection/monitor", () => ({ connectionMonitor: {} }));
vi.mock("./chat-scope", () => ({ useChatScope: () => null }));
vi.mock("./draft-store", () => ({ getDraftStore: () => ({}) }));
vi.mock("./outbox-store", () => ({ getOutboxStore: () => ({}) }));
vi.mock("./key-value-store", () => ({
  createAsyncStorageKeyValueStore: () => ({ hydrate: async () => {} }),
}));
vi.mock("./network-state", () => ({
  createMonitorNetworkState: () => ({
    prime: async () => {},
    subscribe: () => () => {},
  }),
}));

const { useChatRuntime } = await import("./use-chat-runtime");
const { chatRealtime, createBackfillFetcher } =
  await import("@repo/chat-core/realtime-manager");

describe("useChatRuntime", () => {
  it("hands the manager chat-core's one backfill read, on the app's API client (#2807)", async () => {
    const queryClient = new QueryClient();
    const wrapper = ({ children }: { children: React.ReactNode }) => (
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    );

    renderHook(() => useChatRuntime(), { wrapper });

    await waitFor(() => expect(chatRealtime.configure).toHaveBeenCalled());
    const fetcher = vi.mocked(createBackfillFetcher);
    expect(fetcher).toHaveBeenLastCalledWith(apiClient);
    expect(chatRealtime.configure).toHaveBeenLastCalledWith(
      expect.objectContaining({ backfill: fetcher.mock.results.at(-1)?.value }),
    );
  });

  it("hands chat-core the app's track for the outbox events, keeping ctx stable when track changes (#3164)", () => {
    viewer.id = "viewer-1";
    try {
      const queryClient = new QueryClient();
      const Context = analytics.context!;
      let track: TrackFn = vi.fn();
      const wrapper = ({ children }: { children: React.ReactNode }) => (
        <QueryClientProvider client={queryClient}>
          <Context.Provider value={track}>{children}</Context.Provider>
        </QueryClientProvider>
      );

      const { result, rerender } = renderHook(() => useChatRuntime(), {
        wrapper,
      });
      const first = result.current.ctx;
      expect(first?.track).toBeTypeOf("function");

      const next = vi.fn();
      track = next;
      rerender();

      expect(result.current.ctx).toBe(first);
      result.current.ctx?.track?.("outbox-queued", { attempts: 0 });
      expect(next).toHaveBeenCalledWith("outbox-queued", { attempts: 0 });
    } finally {
      viewer.id = null;
    }
  });
});
