/** @vitest-environment jsdom */
/*
  The dashboard-wide chat realtime binding (#3745). These were
  `chat-provider.spec.tsx`'s claims while the binding lived in `ChatProvider`;
  they moved with it, so the #3002 and #3698 guarantees still hold where the
  manager is bound now.
*/
import { renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const liveViewerId = vi.hoisted(() => ({ current: null as string | null }));
const onMessageActivity = vi.hoisted(() => vi.fn());
const queryClient = vi.hoisted(() => ({ client: "query" }));

vi.mock("@tanstack/react-query", () => ({
  useQueryClient: () => queryClient,
}));
vi.mock("@repo/hooks", () => ({
  useChatActivityHandler: () => onMessageActivity,
  useFrappClient: () => ({ GET: vi.fn() }),
}));
vi.mock("@/lib/auth/use-frapp-user", () => ({
  useFrappUser: () => ({ userId: liveViewerId.current }),
}));
vi.mock("@/lib/realtime/supabase-realtime", () => ({
  getRealtimeClient: () => ({}),
}));
vi.mock("@repo/chat-core/realtime-manager", () => ({
  chatRealtime: { configure: vi.fn(), destroy: vi.fn(), resume: vi.fn() },
  createBackfillFetcher: vi.fn((client: unknown) => ({ readsWith: client })),
}));

const { useChatRealtimeBinding } = await import("./use-chat-realtime-binding");
const { chatRealtime, createBackfillFetcher } =
  await import("@repo/chat-core/realtime-manager");

describe("useChatRealtimeBinding", () => {
  beforeEach(() => {
    vi.mocked(chatRealtime.configure).mockClear();
    vi.mocked(chatRealtime.destroy).mockClear();
    vi.mocked(chatRealtime.resume).mockClear();
  });

  it("binds the inbox before the viewer resolves, so the nav lights on any page", () => {
    // The whole of #3745: the manager is configured, which joins the inbox,
    // wherever the shell mounts, not only on `/chat`.
    liveViewerId.current = null;
    renderHook(() => useChatRealtimeBinding());

    expect(chatRealtime.configure).toHaveBeenCalledTimes(1);
    expect(chatRealtime.configure).toHaveBeenLastCalledWith(
      expect.objectContaining({ viewerId: null, queryClient }),
    );
  });

  it("re-configures for the viewer once it resolves, and never destroys to do it (#3002)", () => {
    // `destroy()` here dropped the thread's channel subscription, which the
    // thread never re-took: its subscribe effect is keyed on the channel.
    liveViewerId.current = null;
    const { rerender } = renderHook(() => useChatRealtimeBinding());

    liveViewerId.current = "user-live";
    rerender();

    expect(chatRealtime.configure).toHaveBeenLastCalledWith(
      expect.objectContaining({ viewerId: "user-live" }),
    );
    expect(chatRealtime.destroy).not.toHaveBeenCalled();
  });

  it("re-configures for a different viewer without destroying, too", () => {
    // An account switch with the dashboard still mounted. `configure` rejoins
    // every channel and the inbox for the new member itself.
    liveViewerId.current = "user-a";
    const { rerender } = renderHook(() => useChatRealtimeBinding());

    liveViewerId.current = "user-b";
    rerender();

    expect(chatRealtime.configure).toHaveBeenLastCalledWith(
      expect.objectContaining({ viewerId: "user-b" }),
    );
    expect(chatRealtime.destroy).not.toHaveBeenCalled();
  });

  it("hands the manager chat-core's one backfill read, on its own API client (#2807)", () => {
    liveViewerId.current = "user-live";
    renderHook(() => useChatRealtimeBinding());

    const fetcher = vi.mocked(createBackfillFetcher);
    expect(fetcher.mock.lastCall?.[0]).toHaveProperty("GET");
    expect(chatRealtime.configure).toHaveBeenLastCalledWith(
      expect.objectContaining({ backfill: fetcher.mock.results.at(-1)?.value }),
    );
  });

  it("hands the manager the activity handler that keeps the unread counts live (#3698)", () => {
    liveViewerId.current = "user-live";
    renderHook(() => useChatRealtimeBinding());

    expect(chatRealtime.configure).toHaveBeenLastCalledWith(
      expect.objectContaining({ onMessageActivity }),
    );
  });

  it("resumes the manager when the tab becomes visible again, and stops listening on unmount (#3698)", () => {
    let visibility: DocumentVisibilityState = "visible";
    const spy = vi
      .spyOn(document, "visibilityState", "get")
      .mockImplementation(() => visibility);
    try {
      liveViewerId.current = "user-live";
      const { unmount } = renderHook(() => useChatRealtimeBinding());

      visibility = "hidden";
      document.dispatchEvent(new Event("visibilitychange"));
      expect(chatRealtime.resume).not.toHaveBeenCalled();

      visibility = "visible";
      document.dispatchEvent(new Event("visibilitychange"));
      expect(chatRealtime.resume).toHaveBeenCalledTimes(1);

      unmount();
      document.dispatchEvent(new Event("visibilitychange"));
      expect(chatRealtime.resume).toHaveBeenCalledTimes(1);
    } finally {
      spy.mockRestore();
    }
  });

  it("destroys the manager only when the dashboard unmounts", () => {
    liveViewerId.current = "user-live";
    const { unmount } = renderHook(() => useChatRealtimeBinding());
    expect(chatRealtime.destroy).not.toHaveBeenCalled();

    unmount();

    expect(chatRealtime.destroy).toHaveBeenCalledTimes(1);
  });
});
