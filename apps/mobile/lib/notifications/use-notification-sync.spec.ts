/** @vitest-environment jsdom */
import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  viewerId: "user-1" as string | null,
  signedIn: true,
  pathname: "/",
  appState: "active",
  appStateListeners: new Set<() => void>(),
  supabase: { id: "client" } as { id: string } | null,
  attach: vi.fn(),
  detach: vi.fn(),
  invalidate: vi.fn(),
  seen: vi.fn(),
  queryClient: { id: "query-client" },
}));

vi.mock("react-native", () => ({
  AppState: {
    get currentState() {
      return state.appState;
    },
    addEventListener: (_event: string, listener: () => void) => {
      state.appStateListeners.add(listener);
      return { remove: () => state.appStateListeners.delete(listener) };
    },
  },
}));
vi.mock("expo-router", () => ({ usePathname: () => state.pathname }));
vi.mock("@tanstack/react-query", () => ({
  useQueryClient: () => state.queryClient,
}));
vi.mock("@repo/hooks", () => ({
  invalidateNotificationLists: (client: unknown) => state.invalidate(client),
  useMarkNotificationScreensSeen: (
    screens: readonly string[],
    options: { enabled?: boolean },
  ) => state.seen(screens, options),
  useViewerUserId: () => state.viewerId,
}));
vi.mock("@repo/chat-core/topic-attach", () => ({
  attachTopicChannel: (...args: unknown[]) => {
    state.attach(...args);
    return state.detach;
  },
}));
vi.mock("@/lib/supabase", () => ({ getSupabaseClient: () => state.supabase }));
vi.mock("@/lib/use-is-api-authenticated", () => ({
  useIsApiAuthenticated: () => state.signedIn,
}));

const { useNotificationSyncRuntime } = await import("./use-notification-sync");

beforeEach(() => {
  state.viewerId = "user-1";
  state.signedIn = true;
  state.pathname = "/";
  state.appState = "active";
  state.appStateListeners.clear();
  state.attach.mockClear();
  state.detach.mockClear();
  state.invalidate.mockClear();
  state.seen.mockClear();
});

describe("useNotificationSyncRuntime: the change ping (#3929)", () => {
  it("joins the member's private notif topic and refetches the lists on a ping", () => {
    renderHook(() => useNotificationSyncRuntime());

    expect(state.attach).toHaveBeenCalledTimes(1);
    const [client, topic, configure, options] = state.attach.mock.calls[0]!;
    expect(client).toBe(state.supabase);
    expect(topic).toBe("notif:user-1");
    expect(options).toEqual({ private: true });

    const handlers: Array<() => void> = [];
    const channel = {
      on: vi.fn((kind: string, filter: { event: string }, handler: () => void) => {
        expect(kind).toBe("broadcast");
        expect(filter).toEqual({ event: "change" });
        handlers.push(handler);
        return channel;
      }),
    };
    (configure as (c: typeof channel) => unknown)(channel);
    handlers[0]!();

    expect(state.invalidate).toHaveBeenCalledWith(state.queryClient);
  });

  it("joins nothing until a member is known, and leaves the topic on sign-out", () => {
    state.viewerId = null;
    const { rerender, unmount } = renderHook(() => useNotificationSyncRuntime());
    expect(state.attach).not.toHaveBeenCalled();

    state.viewerId = "user-1";
    rerender();
    expect(state.attach).toHaveBeenCalledTimes(1);

    state.viewerId = null;
    rerender();
    expect(state.detach).toHaveBeenCalledTimes(1);
    unmount();
  });

  it("moves to the new member's topic on an account swap", () => {
    const { rerender } = renderHook(() => useNotificationSyncRuntime());
    state.viewerId = "user-2";
    rerender();

    expect(state.detach).toHaveBeenCalledTimes(1);
    expect(state.attach.mock.calls.map((call) => call[1])).toEqual([
      "notif:user-1",
      "notif:user-2",
    ]);
  });
});

describe("useNotificationSyncRuntime: seen on screen (#3929)", () => {
  it("reads the notices about the open screen while the app is in front", () => {
    state.pathname = "/tasks";
    renderHook(() => useNotificationSyncRuntime());

    expect(state.seen).toHaveBeenLastCalledWith(["tasks", "points"], {
      enabled: true,
    });
  });

  it("stops while the app is in the background, and resumes in front", () => {
    state.pathname = "/events";
    renderHook(() => useNotificationSyncRuntime());

    act(() => {
      state.appState = "background";
      for (const listener of state.appStateListeners) listener();
    });
    expect(state.seen).toHaveBeenLastCalledWith(["events"], { enabled: false });

    act(() => {
      state.appState = "active";
      for (const listener of state.appStateListeners) listener();
    });
    expect(state.seen).toHaveBeenLastCalledWith(["events"], { enabled: true });
  });

  it("reads nothing while signed out", () => {
    state.signedIn = false;
    state.pathname = "/events";
    renderHook(() => useNotificationSyncRuntime());

    expect(state.seen).toHaveBeenLastCalledWith(["events"], { enabled: false });
  });
});
