/** @vitest-environment jsdom */
import { renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mockState = vi.hoisted(() => ({
  chapterId: "chapter-1" as string | null,
  notifications: [] as { id: string; read_at: string | null }[],
  channelUnread: [] as { channel_id: string; unread_count: number }[],
  setBadgeCount: vi.fn(async (count: number) => {
    void count;
  }),
}));

vi.mock("@repo/hooks", () => ({
  useActiveChapterId: () => mockState.chapterId,
  useNotifications: () => ({ data: mockState.notifications }),
  useChannelUnreadCounts: () => ({ data: mockState.channelUnread }),
}));

vi.mock("./push", () => ({
  setBadgeCount: (count: number) => mockState.setBadgeCount(count),
}));

const { useBadgeSyncRuntime } = await import("./use-badge-sync");

beforeEach(() => {
  mockState.chapterId = "chapter-1";
  mockState.notifications = [];
  mockState.channelUnread = [];
  mockState.setBadgeCount.mockClear();
});

afterEach(() => {
  vi.clearAllMocks();
});

describe("useBadgeSyncRuntime", () => {
  it("badges zero with nothing unread", () => {
    renderHook(() => useBadgeSyncRuntime());
    expect(mockState.setBadgeCount).toHaveBeenCalledWith(0);
  });

  it("sums unread notifications and unread chat across channels", () => {
    mockState.notifications = [
      { id: "n1", read_at: null },
      { id: "n2", read_at: "2026-08-01T00:00:00.000Z" },
      { id: "n3", read_at: null },
    ];
    mockState.channelUnread = [
      { channel_id: "c1", unread_count: 2 },
      { channel_id: "c2", unread_count: 5 },
    ];

    renderHook(() => useBadgeSyncRuntime());

    // 2 unread notifications (n2 is read) + 7 unread chat messages.
    expect(mockState.setBadgeCount).toHaveBeenCalledWith(9);
  });

  it("badges zero rather than a stale count when there is no active chapter", () => {
    mockState.chapterId = null;
    mockState.notifications = [{ id: "n1", read_at: null }];
    mockState.channelUnread = [{ channel_id: "c1", unread_count: 3 }];

    renderHook(() => useBadgeSyncRuntime());

    expect(mockState.setBadgeCount).toHaveBeenCalledWith(0);
  });

  it("resyncs when the underlying query data changes", () => {
    const { rerender } = renderHook(() => useBadgeSyncRuntime());
    expect(mockState.setBadgeCount).toHaveBeenLastCalledWith(0);

    mockState.notifications = [{ id: "n1", read_at: null }];
    rerender();

    expect(mockState.setBadgeCount).toHaveBeenLastCalledWith(1);
  });
});
