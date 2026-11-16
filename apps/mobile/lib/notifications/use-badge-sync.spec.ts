/** @vitest-environment jsdom */
import { renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

function notificationRow(
  readAt: string | null,
  screen = "tasks",
): { id: string; read_at: string | null; data: unknown } {
  return {
    id: `n-${Math.random()}`,
    read_at: readAt,
    data: { target: { screen } },
  };
}

const mockState = vi.hoisted(() => ({
  chapterId: "chapter-1" as string | null,
  notifications: [] as { id: string; read_at: string | null; data: unknown }[],
  channelUnread: [] as {
    channel_id: string;
    unread_count: number;
    mention_count?: number;
  }[],
  channels: [] as { id: string; name: string; type: string }[],
  channelUnreadOptions: [] as ({ enabled?: boolean } | undefined)[],
  unreadUpdatedAt: 0,
  setBadgeCount: vi.fn(async (count: number) => {
    void count;
  }),
  clearRead: vi.fn(async (ids: ReadonlySet<string>) => {
    void ids;
  }),
  clearReadNonChat: vi.fn(async (ids: ReadonlySet<string>) => {
    void ids;
  }),
}));

vi.mock("@repo/hooks", async (importOriginal) => ({
  addressedUnreadTotal: (await importOriginal<typeof import("@repo/hooks")>())
    .addressedUnreadTotal,
  useChannels: () => ({ data: mockState.channels }),
  useActiveChapterId: () => mockState.chapterId,
  useNotifications: () => ({ data: mockState.notifications }),
  useChannelUnreadCounts: (options?: { enabled?: boolean }) => {
    mockState.channelUnreadOptions.push(options);
    return {
      data: mockState.channelUnread,
      isError: false,
      dataUpdatedAt: mockState.unreadUpdatedAt,
    };
  },
}));

vi.mock("./push", () => ({
  setBadgeCount: (count: number) => mockState.setBadgeCount(count),
  clearReadChatNotifications: (ids: ReadonlySet<string>) =>
    mockState.clearRead(ids),
  clearReadNonChatNotifications: (ids: ReadonlySet<string>) =>
    mockState.clearReadNonChat(ids),
}));

const { useBadgeSyncRuntime } = await import("./use-badge-sync");
const { holdUnreadFirstPaint, resetUnreadFirstPaintForTests } =
  await import("../chat/unread-first-paint");

beforeEach(() => {
  mockState.chapterId = "chapter-1";
  mockState.notifications = [];
  mockState.channelUnread = [];
  mockState.channelUnreadOptions = [];
  mockState.unreadUpdatedAt = 0;
  mockState.channels = [];
  mockState.setBadgeCount.mockClear();
  mockState.clearRead.mockClear();
  mockState.clearReadNonChat.mockClear();
});

afterEach(() => {
  vi.clearAllMocks();
  resetUnreadFirstPaintForTests();
});

describe("useBadgeSyncRuntime", () => {
  it("badges zero with nothing unread", () => {
    renderHook(() => useBadgeSyncRuntime());
    expect(mockState.setBadgeCount).toHaveBeenCalledWith(0);
  });

  it("counts mentions and unread direct messages, not plain channel unread", () => {
    mockState.notifications = [
      notificationRow(null),
      notificationRow("2026-08-01T00:00:00.000Z"),
      notificationRow(null),
    ];
    mockState.channels = [
      { id: "c1", name: "general", type: "TEXT" },
      { id: "c2", name: "academics", type: "TEXT" },
      { id: "d1", name: "dm-a-b", type: "DM" },
    ];
    mockState.channelUnread = [
      // A busy channel nobody addressed the member in adds nothing.
      { channel_id: "c1", unread_count: 30, mention_count: 0 },
      // A channel counts its mentions, not its messages.
      { channel_id: "c2", unread_count: 5, mention_count: 2 },
      // A direct message counts every unread message.
      { channel_id: "d1", unread_count: 3, mention_count: 0 },
    ];

    renderHook(() => useBadgeSyncRuntime());

    // 2 unread notifications + 2 mentions + 3 unread DM messages.
    expect(mockState.setBadgeCount).toHaveBeenCalledWith(7);
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
    mockState.channels = [{ id: "c1", name: "dm-a-b", type: "DM" }];
    mockState.channelUnread = [{ channel_id: "c1", unread_count: 4 }];

    renderHook(() => useBadgeSyncRuntime());

    // 1 non-chat unread notification (the chat one is excluded) + 4 unread DM.
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

  it("clears the tray for channels that read as fully read", () => {
    mockState.channelUnread = [
      { channel_id: "read", unread_count: 0 },
      { channel_id: "unread", unread_count: 2 },
    ];
    renderHook(() => useBadgeSyncRuntime());
    expect(mockState.clearRead).toHaveBeenCalledWith(new Set(["read"]));
  });

  it("badges what chat home shows before the counts answer, and clears the tray on the server's answer only (#4006)", () => {
    mockState.channels = [{ id: "d1", name: "dm-a-b", type: "DM" }];
    // No answer yet. The last launch's answer has the DM read, and a push for
    // it is in the tray.
    mockState.channelUnread = undefined as never;
    holdUnreadFirstPaint({
      saved: [{ channel_id: "d1", unread_count: 0, mention_count: 0 }],
      tray: { channelIds: new Set(["d1"]), since: Date.now() },
    });
    const { rerender } = renderHook(() => useBadgeSyncRuntime());

    expect(mockState.setBadgeCount).toHaveBeenLastCalledWith(1);
    // The saved answer reads the DM as read; that must not dismiss its push.
    expect(mockState.clearRead).not.toHaveBeenCalled();

    mockState.channelUnread = [{ channel_id: "d1", unread_count: 0 }];
    mockState.unreadUpdatedAt = Date.now() + 1;
    rerender();
    expect(mockState.setBadgeCount).toHaveBeenLastCalledWith(0);
    expect(mockState.clearRead).toHaveBeenCalledWith(new Set(["d1"]));
  });

  it("clears nothing without an active chapter", () => {
    mockState.chapterId = null;
    mockState.channelUnread = [{ channel_id: "read", unread_count: 0 }];
    renderHook(() => useBadgeSyncRuntime());
    expect(mockState.clearRead).not.toHaveBeenCalled();
    expect(mockState.clearReadNonChat).not.toHaveBeenCalled();
  });

  it("takes read non-chat rows' pushes out of the tray, never chat rows' (#4011)", () => {
    const read = notificationRow("2026-08-01T00:00:00.000Z", "events");
    const unread = notificationRow(null, "events");
    const readChat = notificationRow("2026-08-01T00:00:00.000Z", "chat");
    mockState.notifications = [read, unread, readChat];
    renderHook(() => useBadgeSyncRuntime());
    expect(mockState.clearReadNonChat).toHaveBeenLastCalledWith(
      new Set([read.id]),
    );
  });
});
