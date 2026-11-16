import { describe, expect, test } from "vitest";
import {
  chatPushMessageId,
  FULL_PAGE_MARGIN_MS,
  PAGE_READ_MARGIN_MS,
  pushesQuotingMessages,
  pushesWithDeletedRows,
} from "./deleted-message-pushes";
import type { PresentedNotification } from "./push-types";

const NOW = Date.parse("2026-11-16T12:00:00.000Z");
const CHANNELS = new Set(["c1"]);

function push(
  identifier: string,
  data: Record<string, unknown>,
  date = NOW - 10 * 60_000,
): PresentedNotification {
  return {
    date,
    request: { identifier, content: { title: null, body: null, data } },
  };
}

const single = (
  identifier: string,
  messageId: string,
  notificationId: string,
  channelId = "c1",
  date?: number,
) =>
  push(
    identifier,
    {
      target: { screen: "chat", channelId },
      messageId,
      notificationId,
    },
    date,
  );

const row = (id: string, createdAt: number) => ({
  id,
  created_at: new Date(createdAt).toISOString(),
});

describe("chatPushMessageId (#4470)", () => {
  test("a single-message chat push names its message", () => {
    expect(
      chatPushMessageId({
        target: { screen: "chat", channelId: "c1" },
        messageId: "m1",
      }),
    ).toBe("m1");
  });

  test("a bundle, a non-chat push and a push without one name none", () => {
    expect(
      chatPushMessageId({
        target: { screen: "chat", channelId: "c1" },
        bundled: true,
        messageId: "m1",
      }),
    ).toBeNull();
    expect(
      chatPushMessageId({ target: { screen: "events" }, messageId: "m1" }),
    ).toBeNull();
    expect(
      chatPushMessageId({ target: { screen: "chat", channelId: "c1" } }),
    ).toBeNull();
  });
});

describe("pushesQuotingMessages (#4470)", () => {
  test("matches by message only, leaving the channel's other pushes", () => {
    const presented = [single("a", "m1", "n1"), single("b", "m2", "n2")];
    expect(pushesQuotingMessages(presented, new Set(["m1"]))).toEqual(["a"]);
  });
});

describe("pushesWithDeletedRows (#4470)", () => {
  const page = (rows: unknown[], limit = 50) => ({
    rows,
    limit,
    readAt: NOW,
  });

  test("a push whose row is missing from a page that holds everything leaves", () => {
    const presented = [single("a", "m1", "n1"), single("b", "m2", "n2")];
    expect(
      pushesWithDeletedRows(
        presented,
        page([row("n2", NOW - 60_000)]),
        CHANNELS,
      ),
    ).toEqual(["a"]);
  });

  test("another chapter's push, a bundle and a non-chat push stay", () => {
    const presented = [
      single("other", "m1", "n1", "elsewhere"),
      push("bundle", {
        target: { screen: "chat", channelId: "c1" },
        bundled: true,
        count: 3,
        notificationId: "n3",
      }),
      push("event", { target: { screen: "events" }, notificationId: "n4" }),
    ];
    expect(pushesWithDeletedRows(presented, page([]), CHANNELS)).toEqual([]);
  });

  test("a push that arrived around or after the read stays: its row may postdate the page", () => {
    const presented = [
      single("late", "m1", "n1", "c1", NOW - PAGE_READ_MARGIN_MS + 1),
    ];
    expect(pushesWithDeletedRows(presented, page([]), CHANNELS)).toEqual([]);
  });

  test("on a full page, a push near or before its oldest row stays: its row may have paged out", () => {
    const oldest = NOW - 3 * FULL_PAGE_MARGIN_MS;
    const rows = [row("x", oldest), row("y", NOW - 60_000)];
    const presented = [
      single("paged", "m1", "n1", "c1", oldest + FULL_PAGE_MARGIN_MS - 1),
      single("gone", "m2", "n2", "c1", oldest + FULL_PAGE_MARGIN_MS + 1),
    ];
    expect(pushesWithDeletedRows(presented, page(rows, 2), CHANNELS)).toEqual([
      "gone",
    ]);
  });

  test("a push whose row is on the page stays", () => {
    const presented = [single("a", "m1", "n1")];
    expect(
      pushesWithDeletedRows(
        presented,
        page([row("n1", NOW - 60_000)]),
        CHANNELS,
      ),
    ).toEqual([]);
  });

  test("a date in seconds is read as seconds", () => {
    const presented = [
      single("a", "m1", "n1", "c1", Math.floor((NOW - 10 * 60_000) / 1000)),
    ];
    expect(pushesWithDeletedRows(presented, page([]), CHANNELS)).toEqual(["a"]);
  });
});
