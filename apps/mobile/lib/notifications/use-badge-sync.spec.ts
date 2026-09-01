/** @vitest-environment jsdom */
import { renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

function notificationRow(
  readAt: string | null,
  screen = "tasks",
): { id: string; read_at: string | null; data: unknown } {
  return { id: `n-${Math.random()}`, read_at: readAt, data: { target: { screen } } };
}

const mockState = vi.hoisted(() => ({
  chapterId: "chapter-1" as string | null,
  notifications: [] as { id: string; read_at: string | null; data: unknown }[],
  channelUnread: [] as { channel_id: string; unread_count: number }[],
  channelUnreadOptions: [] as ({ enabled?: boolean } | undefined)[],
  setBadgeCount: vi.fn(async (count: number) => {
    void count;
  }),
}));

vi.mock("@repo/hooks", () => ({
  useActiveChapterId: () => mockState.chapterId,
  useNotifications: () => ({ data: mockState.notifications }),
  useChannelUnreadCounts: (options?: { enabled?: boolean }) => {
    mockState.channelUnreadOptions.push(options);
    return { data: mockState.channelUnread };
  },
}));

vi.mock("./push", () => ({
  setBadgeCount: (count: number) => mockState.setBadgeCount(count),
}));

const { useBadgeSyncRuntime } = await import("./use-badge-sync");

beforeEach(() => {
  mockState.chapterId = "chapter-1";
  mockState.notifications = [];
  mockState.channelUnread = [];
  mockState.channelUnreadOptions = [];
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
      notificationRow(null),
      notificationRow("2026-08-01T00:00:00.000Z"),
      notificationRow(null),
    ];
    mockState.channelUnread = [
      { channel_id: "c1", unread_count: 2 },
      { channel_id: "c2", unread_count: 5 },
    ];

    renderHook(() => useBadgeSyncRuntime());

    // 2 unread notifications (the second is read) + 7 unread chat messages.
    expect(mockState.setBadgeCount).toHaveBeenCalledWith(9);
  });

  // ChatService writes a notifications row (target.screen: "chat") for every
  // DM/group-DM/announcement message, on top of the read-receipt count
  // useChannelUnreadCounts already reflects for that channel — counting an
  // unread chat-targeted notification row here would double it.
  it("does not double-count a chat-targeted notification against channel unread", () => {
    mockState.notifications = [
      notificationRow(null, "chat"),
      notificationRow(null, "tasks"),
    ];
    mockState.channelUnread = [{ channel_id: "c1", unread_count: 4 }];

    renderHook(() => useBadgeSyncRuntime());

    // 1 non-chat unread notification (the chat one is excluded) + 4 unread chat.
    expect(mockState.setBadgeCount).toHaveBeenCalledWith(5);
  });

  it("badges zero rather than a stale count when there is no active chapter", () => {
    mockState.chapterId = null;
    mockState.notifications = [notificationRow(null)];
    mockState.channelUnread = [{ channel_id: "c1", unread_count: 3 }];

    renderHook(() => useBadgeSyncRuntime());

    expect(mockState.setBadgeCount).toHaveBeenCalledWith(0);
  });

  it("disables the channel-unread query rather than firing it with no chapter", () => {
    mockState.chapterId = null;
    renderHook(() => useBadgeSyncRuntime());
    expect(mockState.channelUnreadOptions.at(-1)).toEqual({ enabled: false });
  });

  it("enables the channel-unread query once a chapter is active", () => {
    renderHook(() => useBadgeSyncRuntime());
    expect(mockState.channelUnreadOptions.at(-1)).toEqual({ enabled: true });
  });

  it("resyncs when the underlying query data changes", () => {
    const { rerender } = renderHook(() => useBadgeSyncRuntime());
    expect(mockState.setBadgeCount).toHaveBeenLastCalledWith(0);

    mockState.notifications = [notificationRow(null)];
    rerender();

    expect(mockState.setBadgeCount).toHaveBeenLastCalledWith(1);
  });
});
