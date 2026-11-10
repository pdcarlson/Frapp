import AsyncStorage from "@react-native-async-storage/async-storage";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ChannelUnreadCount } from "@repo/hooks";
import { lightChannels, shownUnreadCounts } from "./unread-first-paint";
import {
  asUnreadRows,
  forgetUnreadMemory,
  readUnreadMemory,
  unreadMemoryKey,
} from "./unread-memory";

const storage = vi.mocked(AsyncStorage);

function row(
  channel_id: string,
  unread_count = 0,
  mention_count = 0,
): ChannelUnreadCount {
  return { channel_id, unread_count, mention_count };
}

const none = { saved: null, tray: null };
const tray = (ids: string[], since = 100) => ({
  channelIds: new Set(ids),
  since,
});

describe("lightChannels", () => {
  it("lights fully read rows, keeps counts, and adds a row for a channel with none", () => {
    const rows = [row("a"), row("b", 4, 2)];
    expect(lightChannels(rows, new Set(["a", "b", "c"]))).toEqual([
      row("a", 1),
      row("b", 4, 2),
      row("c", 1),
    ]);
  });

  it("returns the same array when nothing changes", () => {
    const rows = [row("a"), row("b", 4, 2)];
    expect(lightChannels(rows, new Set(["b"]))).toBe(rows);
    expect(lightChannels(rows, new Set())).toBe(rows);
  });
});

describe("shownUnreadCounts", () => {
  const unanswered = { data: undefined, isError: false, dataUpdatedAt: 0 };

  it("is the query's own state with nothing held", () => {
    const data = [row("a", 2)];
    expect(
      shownUnreadCounts({ data, isError: false, dataUpdatedAt: 50 }, none),
    ).toEqual({ data, isError: false, provisional: false });
    expect(shownUnreadCounts(unanswered, none)).toEqual({
      data: undefined,
      isError: false,
      provisional: false,
    });
  });

  it("stands the saved answer in only while the query has none", () => {
    const saved = [row("a", 3)];
    expect(shownUnreadCounts(unanswered, { saved, tray: null })).toEqual({
      data: saved,
      isError: false,
      provisional: true,
    });
    const data = [row("a")];
    expect(
      shownUnreadCounts(
        { data, isError: false, dataUpdatedAt: 50 },
        { saved, tray: null },
      ).data,
    ).toBe(data);
  });

  it("lights the tray's channels until an answer later than the tray read", () => {
    const data = [row("a")];
    const first = { saved: null, tray: tray(["a"], 100) };
    for (const dataUpdatedAt of [50, 100]) {
      expect(
        shownUnreadCounts({ data, isError: false, dataUpdatedAt }, first).data,
      ).toEqual([row("a", 1)]);
    }
    expect(
      shownUnreadCounts({ data, isError: false, dataUpdatedAt: 101 }, first)
        .data,
    ).toBe(data);
  });

  it("holds nothing over a failed read", () => {
    const data = [row("a")];
    expect(
      shownUnreadCounts(
        { data, isError: true, dataUpdatedAt: 50 },
        { saved: [row("a", 9)], tray: tray(["a"]) },
      ),
    ).toEqual({ data, isError: true, provisional: false });
  });
});

describe("the saved answer", () => {
  beforeEach(() => {
    storage.getItem.mockReset().mockResolvedValue(null);
    storage.removeItem.mockReset().mockResolvedValue(undefined);
    storage.getAllKeys.mockReset().mockResolvedValue([]);
  });

  it("keys a token with no chapter under a stable name", () => {
    expect(unreadMemoryKey("u", null)).toBe("frapp.chat.unread.u.sole");
    expect(unreadMemoryKey("u", "c")).toBe("frapp.chat.unread.u.c");
  });

  it("refuses anything that isn't an unread answer", async () => {
    expect(asUnreadRows({ channel_id: "a" })).toBeNull();
    expect(asUnreadRows([{ channel_id: "a", unread_count: "1" }])).toBeNull();
    expect(asUnreadRows([row("a", 1)])).toEqual([row("a", 1)]);

    storage.getItem.mockResolvedValue("{");
    expect(await readUnreadMemory("k")).toBeNull();
    storage.getItem.mockRejectedValue(new Error("disk"));
    expect(await readUnreadMemory("k")).toBeNull();
  });

  it("is forgotten for every member on sign-out, and nothing else is", async () => {
    storage.getAllKeys.mockResolvedValue([
      "frapp.chat.unread.u1.c1",
      "frapp.chat.unread.u2.sole",
      "frapp.chat.last-channel.u1.c1",
      "chat:v2:outbox:u1",
    ]);

    forgetUnreadMemory();
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(storage.removeItem.mock.calls.map(([key]) => key)).toEqual([
      "frapp.chat.unread.u1.c1",
      "frapp.chat.unread.u2.sole",
    ]);
  });
});
