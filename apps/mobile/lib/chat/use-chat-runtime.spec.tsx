/** @vitest-environment jsdom */
/**
 * The first claim here is the realtime manager's wiring: mobile hands it
 * chat-core's own backfill read (#2807), the read web's `ChatProvider` hands
 * it too. The full-page rule and the unknown-cursor recovery live in that read
 * and the manager (`packages/chat-core/src/realtime-manager.spec.ts`), so an
 * inline fetcher here would type-check and quietly skip the second.
 *
 * The second is the outbox telemetry sink: chat-core's `ctx.track` reaches
 * the app's `AnalyticsContext` `track`, as web's does, without `ctx` changing
 * identity when `track` does.
 *
 * The third is the app-wide binding's own job (#3698): the manager is told
 * about chat activity through `onMessageActivity`, and the app coming back
 * from the background (not merely `inactive`) calls `resume()`.
 *
 * Everything else the hook touches is a stand-in: the platform ports, the
 * member-scoped stores, and the outbox flush.
 */

import React, { createContext } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const apiClient = vi.hoisted(() => ({ GET: vi.fn() }));
const viewer = vi.hoisted(() => ({ id: null as string | null }));

const onMessageActivity = vi.hoisted(() => vi.fn());
const auth = vi.hoisted(() => ({ signedIn: true }));
/** The `enabled` each `useViewerUserId` call was made with. */
const viewerReads = vi.hoisted(() => [] as (boolean | undefined)[]);
vi.mock("@repo/hooks", () => ({
  useFrappClient: () => apiClient,
  useViewerUserId: (options?: { enabled?: boolean }) => {
    viewerReads.push(options?.enabled);
    return viewer.id;
  },
  useChatActivityHandler: () => onMessageActivity,
}));
vi.mock("@/lib/use-is-api-authenticated", () => ({
  useIsApiAuthenticated: () => auth.signedIn,
}));
const appState = vi.hoisted(() => ({
  currentState: "active" as string,
  listeners: new Set<(state: string) => void>(),
}));
vi.mock("react-native", () => ({
  AppState: {
    get currentState() {
      return appState.currentState;
    },
    addEventListener: (_: string, listener: (state: string) => void) => {
      appState.listeners.add(listener);
      return { remove: () => appState.listeners.delete(listener) };
    },
  },
}));
function setAppState(next: string) {
  appState.currentState = next;
  for (const listener of [...appState.listeners]) listener(next);
}
type TrackFn = (name: string, properties?: Record<string, unknown>) => void;
const analytics = vi.hoisted(() => ({
  context: null as React.Context<TrackFn | null> | null,
}));
vi.mock("@/lib/analytics-provider", () => {
  analytics.context = createContext<TrackFn | null>(null);
  return { AnalyticsContext: analytics.context };
});
vi.mock("@repo/chat-core/realtime-manager", () => ({
  chatRealtime: { configure: vi.fn(), resume: vi.fn() },
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

const { useChatRealtimeBinding, useChatRuntime } =
  await import("./use-chat-runtime");
const { chatRealtime, createBackfillFetcher } =
  await import("@repo/chat-core/realtime-manager");

function queryWrapper() {
  const queryClient = new QueryClient();
  function Wrapper({ children }: { children: React.ReactNode }) {
    return (
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    );
  }
  return Wrapper;
}

describe("useChatRealtimeBinding", () => {
  beforeEach(() => {
    viewer.id = "viewer-1";
    auth.signedIn = true;
    viewerReads.length = 0;
    vi.mocked(chatRealtime.configure).mockClear();
    vi.mocked(chatRealtime.resume).mockClear();
  });
  afterEach(() => {
    viewer.id = null;
    vi.useRealTimers();
  });

  it("binds nothing while signed out, and never reads /users/me without a session", async () => {
    auth.signedIn = false;
    viewer.id = null;
    renderHook(() => useChatRealtimeBinding(), { wrapper: queryWrapper() });

    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(chatRealtime.configure).not.toHaveBeenCalled();
    expect(viewerReads.length).toBeGreaterThan(0);
    expect(viewerReads.every((enabled) => enabled === false)).toBe(true);
  });

  it("hands the manager chat-core's one backfill read, on the app's API client (#2807)", async () => {
    renderHook(() => useChatRealtimeBinding(), { wrapper: queryWrapper() });

    await waitFor(() => expect(chatRealtime.configure).toHaveBeenCalled());
    const fetcher = vi.mocked(createBackfillFetcher);
    expect(fetcher).toHaveBeenLastCalledWith(apiClient);
    expect(chatRealtime.configure).toHaveBeenLastCalledWith(
      expect.objectContaining({ backfill: fetcher.mock.results.at(-1)?.value }),
    );
  });

  it("once bound, rebinds on sign-out so the inbox rejoins under the signed-out session", async () => {
    const { rerender } = renderHook(() => useChatRealtimeBinding(), {
      wrapper: queryWrapper(),
    });
    await waitFor(() =>
      expect(chatRealtime.configure).toHaveBeenLastCalledWith(
        expect.objectContaining({ viewerId: "viewer-1" }),
      ),
    );

    auth.signedIn = false;
    viewer.id = null;
    rerender();

    await waitFor(() =>
      expect(chatRealtime.configure).toHaveBeenLastCalledWith(
        expect.objectContaining({ viewerId: null }),
      ),
    );
  });

  it("doesn't rebind while still signed in with the viewer re-reading (a chapter switch)", async () => {
    const { rerender } = renderHook(() => useChatRealtimeBinding(), {
      wrapper: queryWrapper(),
    });
    await waitFor(() => expect(chatRealtime.configure).toHaveBeenCalled());
    vi.mocked(chatRealtime.configure).mockClear();

    viewer.id = null;
    rerender();
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(chatRealtime.configure).not.toHaveBeenCalled();
  });

  it("hands the manager the activity handler that keeps chat home live (#3698)", async () => {
    renderHook(() => useChatRealtimeBinding(), { wrapper: queryWrapper() });

    await waitFor(() =>
      expect(chatRealtime.configure).toHaveBeenLastCalledWith(
        expect.objectContaining({ onMessageActivity }),
      ),
    );
  });

  it("resumes the manager on the way back from the background, not from inactive (#3698)", () => {
    const { unmount } = renderHook(() => useChatRealtimeBinding(), {
      wrapper: queryWrapper(),
    });

    // A permission prompt or the notification shade: the socket never left.
    setAppState("inactive");
    setAppState("active");
    expect(chatRealtime.resume).not.toHaveBeenCalled();

    setAppState("background");
    setAppState("active");
    expect(chatRealtime.resume).toHaveBeenCalledTimes(1);

    unmount();
    setAppState("background");
    setAppState("active");
    expect(chatRealtime.resume).toHaveBeenCalledTimes(1);
  });
});

describe("useChatRuntime", () => {
  it("leaves binding the manager to the app-wide runtime", () => {
    vi.mocked(chatRealtime.configure).mockClear();
    renderHook(() => useChatRuntime(), { wrapper: queryWrapper() });
    expect(chatRealtime.configure).not.toHaveBeenCalled();
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
