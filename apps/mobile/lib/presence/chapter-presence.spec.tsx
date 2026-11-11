/** @vitest-environment jsdom */
/**
 * The phone's binding of chapter presence (#3917): when it holds the topic,
 * what it publishes, and that screens hear the result. The shared hook's own
 * rules (rosters, reconnects, Idle) are pinned by web's
 * `use-chapter-presence.spec.tsx`, which drives the same hook.
 */
import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { OwnStatus } from "@repo/hooks/member-status";

const state = vi.hoisted(() => ({
  signedIn: true,
  chapterId: "11111111-2222-3333-4444-555555555555" as string | null,
  viewerId: "user-1" as string | null,
  own: null as OwnStatus | null,
  appState: "active",
  appStateListeners: new Set<() => void>(),
  linkDown: false,
  linkListeners: new Set<() => void>(),
  supabase: { id: "client" } as { id: string } | null,
  attach: vi.fn(),
  detach: vi.fn(),
  track: vi.fn(async () => "ok"),
  untrack: vi.fn(async () => "ok"),
  presenceState: {} as Record<string, unknown[]>,
  handlers: new Map<string, () => void>(),
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
vi.mock("@repo/hooks", () => ({
  useActiveChapterId: () => state.chapterId,
  useViewerUserId: () => state.viewerId,
}));
vi.mock("@repo/chat-core/topic-attach", () => ({
  attachTopicChannel: (
    client: unknown,
    topic: string,
    configure: (channel: unknown) => unknown,
    options: { onSubscribed?: () => void },
  ) => {
    state.attach(client, topic, options);
    let released = false;
    // The real attach mints on a microtask, then SUBSCRIBED arrives.
    void Promise.resolve().then(() => {
      if (released) return;
      const channel = {
        on: (_type: string, filter: { event: string }, handler: () => void) => {
          state.handlers.set(filter.event, handler);
          return channel;
        },
        presenceState: () => state.presenceState,
        track: state.track,
        untrack: state.untrack,
      };
      configure(channel);
      options.onSubscribed?.();
    });
    return () => {
      released = true;
      state.detach();
    };
  },
}));
vi.mock("@/lib/supabase", () => ({ getSupabaseClient: () => state.supabase }));
vi.mock("@/lib/use-is-api-authenticated", () => ({
  useIsApiAuthenticated: () => state.signedIn,
}));
vi.mock("@/lib/account/own-status", () => ({
  useOwnStatus: () => state.own,
  useOwnStatusSync: () => undefined,
}));
vi.mock("@/lib/connection/monitor", () => ({
  connectionMonitor: {
    linkDown: () => state.linkDown,
    subscribe: (listener: () => void) => {
      state.linkListeners.add(listener);
      return () => state.linkListeners.delete(listener);
    },
  },
}));

const { useChapterPresenceRuntime } = await import("./chapter-presence");
const { useChapterPresence } = await import("./presence-store");

function own(patch: Partial<OwnStatus> = {}): OwnStatus {
  return {
    status: "online",
    statusEndsAt: null,
    line: null,
    lineEndsAt: null,
    ...patch,
  };
}

async function settle() {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
}

function setAppState(next: string) {
  act(() => {
    state.appState = next;
    for (const listener of [...state.appStateListeners]) listener();
  });
}

function setLinkDown(next: boolean) {
  act(() => {
    state.linkDown = next;
    for (const listener of [...state.linkListeners]) listener();
  });
}

beforeEach(() => {
  state.signedIn = true;
  state.chapterId = "11111111-2222-3333-4444-555555555555";
  state.viewerId = "user-1";
  state.own = own();
  state.appState = "active";
  state.appStateListeners.clear();
  state.linkDown = false;
  state.linkListeners.clear();
  state.supabase = { id: "client" };
  state.attach.mockClear();
  state.detach.mockClear();
  state.track.mockClear();
  state.untrack.mockClear();
  state.presenceState = {};
  state.handlers.clear();
});

describe("useChapterPresenceRuntime (#3917)", () => {
  it("joins the chapter's private presence topic through the shared attach", async () => {
    renderHook(() => useChapterPresenceRuntime());
    expect(state.attach).toHaveBeenCalledTimes(1);
    const [client, topic, options] = state.attach.mock.calls[0]!;
    expect(client).toBe(state.supabase);
    expect(topic).toBe("presence:chapter:11111111-2222-3333-4444-555555555555");
    expect(options).toMatchObject({ private: true });
    await settle();
    expect(state.track).toHaveBeenCalledWith(
      expect.objectContaining({ userId: "user-1" }),
    );
  });

  it("releases the topic in the background and re-joins on the way back", async () => {
    renderHook(() => useChapterPresenceRuntime());
    await settle();
    setAppState("background");
    expect(state.detach).toHaveBeenCalledTimes(1);
    setAppState("active");
    expect(state.attach).toHaveBeenCalledTimes(2);
  });

  it("keeps the channel through the app switcher (inactive is not background)", () => {
    renderHook(() => useChapterPresenceRuntime());
    setAppState("inactive");
    expect(state.detach).not.toHaveBeenCalled();
  });

  it("gates on the link, not on /health", () => {
    renderHook(() => useChapterPresenceRuntime());
    setLinkDown(true);
    expect(state.detach).toHaveBeenCalledTimes(1);
    setLinkDown(false);
    expect(state.attach).toHaveBeenCalledTimes(2);
  });

  it("holds no channel signed out, or without a Supabase client", () => {
    state.signedIn = false;
    const { unmount } = renderHook(() => useChapterPresenceRuntime());
    unmount();
    state.signedIn = true;
    state.supabase = null;
    renderHook(() => useChapterPresenceRuntime());
    expect(state.attach).not.toHaveBeenCalled();
  });

  it("an Invisible member never tracks; DND and the line ride the entry", async () => {
    state.own = own({ status: "invisible" });
    const { rerender } = renderHook(() => useChapterPresenceRuntime());
    await settle();
    expect(state.track).not.toHaveBeenCalled();

    state.own = own({ status: "dnd", line: "In class" });
    rerender();
    await settle();
    expect(state.track).toHaveBeenLastCalledWith(
      expect.objectContaining({ userId: "user-1", status: "dnd", line: "In class" }),
    );
  });

  it("publishes nothing until the member's own status is known", async () => {
    state.own = null;
    renderHook(() => useChapterPresenceRuntime());
    await settle();
    expect(state.track).not.toHaveBeenCalled();
  });

  it("hands screens the roster, and nothing once the app is backgrounded", async () => {
    renderHook(() => useChapterPresenceRuntime());
    const screen = renderHook(() => useChapterPresence());
    expect(screen.result.current.isReady).toBe(false);
    await settle();
    state.presenceState = {
      a: [{ userId: "user-2", ts: Date.now(), status: "dnd" }],
    };
    act(() => state.handlers.get("sync")?.());
    expect(screen.result.current.isReady).toBe(true);
    expect(screen.result.current.statusOf("user-2")).toBe("dnd");
    expect(screen.result.current.statusOf("user-3")).toBe("offline");

    setAppState("background");
    expect(screen.result.current.isReady).toBe(false);
  });
});
