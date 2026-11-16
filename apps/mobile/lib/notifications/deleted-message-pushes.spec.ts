import { describe, expect, test } from "vitest";
import {
  chatPushMessageId,
  pushesQuotingMessages,
} from "./deleted-message-pushes";
import type { PresentedNotification } from "./push-types";

const NOW = Date.parse("2026-11-16T12:00:00.000Z");

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

describe("chatPushMessageId (#4470)", () => {
  test("a single-message chat push names its message", () => {
    expect(
      chatPushMessageId({
        target: { screen: "chat", channelId: "c1" },
        messageId: "m1",
      }),
    ).toBe("m1");
  });

  test("a reminder names none: its row isn't always tied to the message", () => {
    expect(
      chatPushMessageId({
        target: { screen: "chat", channelId: "c1" },
        reminder: true,
        messageId: "m1",
      }),
    ).toBeNull();
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
