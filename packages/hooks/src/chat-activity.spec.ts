import {
  afterEach,
  beforeEach,
  describe,
  expect,
  test,
  vi,
  type Mock,
  type MockInstance,
} from "vitest";
import { QueryClient } from "@tanstack/react-query";
import {
  CHAT_ACTIVITY_COALESCE_MS,
  createChatActivityHandler,
  type ChatActivity,
} from "./chat-activity";
import {
  CHANNEL_LATEST_MESSAGES_KEY,
  CHANNEL_LIST_KEY,
  CHANNEL_UNREAD_COUNTS_KEY,
} from "./use-chat";

const VIEWER = "viewer-1";
const OTHER = "member-2";

const message = (
  channelId: string,
  senderId: string | null,
  open: boolean,
): ChatActivity => ({ type: "message", channelId, senderId, open });

describe("createChatActivityHandler (#3698)", () => {
  let queryClient: QueryClient;
  let invalidate: MockInstance<QueryClient["invalidateQueries"]>;
  let markRead: Mock<(channelId: string) => Promise<unknown>>;
  let foreground: boolean;

  beforeEach(() => {
    vi.useFakeTimers();
    queryClient = new QueryClient();
    invalidate = vi.spyOn(queryClient, "invalidateQueries");
    markRead = vi.fn<(channelId: string) => Promise<unknown>>(
      async () => undefined,
    );
    foreground = true;
  });

  afterEach(() => {
    vi.useRealTimers();
    queryClient.clear();
  });

  const handler = () =>
    createChatActivityHandler({
      queryClient,
      viewerId: () => VIEWER,
      isForeground: () => foreground,
      markRead,
    });

  const invalidatedKeys = () =>
    invalidate.mock.calls.map(([filters]) => filters?.queryKey);

  test("a message elsewhere re-reads exactly the unread counts and the latest messages", async () => {
    const { handle } = handler();
    handle(message("c1", OTHER, false));
    expect(invalidate).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(CHAT_ACTIVITY_COALESCE_MS);

    expect(invalidate).toHaveBeenCalledWith({
      queryKey: CHANNEL_UNREAD_COUNTS_KEY,
      exact: true,
    });
    expect(invalidate).toHaveBeenCalledWith({
      queryKey: CHANNEL_LATEST_MESSAGES_KEY,
      exact: true,
    });
    // Never the whole prefix: that would re-read the channel list per message.
    expect(invalidatedKeys()).not.toContainEqual(CHANNEL_LIST_KEY);
    expect(markRead).not.toHaveBeenCalled();
  });

  test("a burst is one round of reads", async () => {
    const { handle } = handler();
    handle(message("c1", OTHER, false));
    handle(message("c2", OTHER, false));
    handle({ type: "resync" });
    await vi.advanceTimersByTimeAsync(CHAT_ACTIVITY_COALESCE_MS);
    expect(invalidate).toHaveBeenCalledTimes(2);
  });

  test("someone else's message in the open thread, in the foreground, re-stamps it read before the re-read", async () => {
    const order: string[] = [];
    markRead.mockImplementation(async (id: string) => {
      order.push(`read:${id}`);
    });
    invalidate.mockImplementation(async () => {
      order.push("invalidate");
    });
    const { handle } = handler();
    handle(message("c1", OTHER, true));
    handle(message("c1", OTHER, true));

    await vi.advanceTimersByTimeAsync(CHAT_ACTIVITY_COALESCE_MS);

    expect(markRead).toHaveBeenCalledTimes(1);
    expect(markRead).toHaveBeenCalledWith("c1");
    expect(order[0]).toBe("read:c1");
    expect(order.slice(1)).toEqual(["invalidate", "invalidate"]);
  });

  test("an open thread in the background is not marked read", async () => {
    foreground = false;
    const { handle } = handler();
    handle(message("c1", OTHER, true));
    await vi.advanceTimersByTimeAsync(CHAT_ACTIVITY_COALESCE_MS);
    expect(markRead).not.toHaveBeenCalled();
    expect(invalidate).toHaveBeenCalledTimes(2);
  });

  test("the viewer's own message, and a sender-less one, never stamp", async () => {
    const { handle } = handler();
    handle(message("c1", VIEWER, true));
    handle(message("c1", null, true));
    await vi.advanceTimersByTimeAsync(CHAT_ACTIVITY_COALESCE_MS);
    expect(markRead).not.toHaveBeenCalled();
    expect(invalidate).toHaveBeenCalledTimes(2);
  });

  test("a failed stamp still re-reads the counts", async () => {
    markRead.mockRejectedValue(new Error("offline"));
    const { handle } = handler();
    handle(message("c1", OTHER, true));
    await vi.advanceTimersByTimeAsync(CHAT_ACTIVITY_COALESCE_MS);
    expect(invalidate).toHaveBeenCalledTimes(2);
  });

  test("a resync re-reads both summaries", async () => {
    const { handle } = handler();
    handle({ type: "resync" });
    await vi.advanceTimersByTimeAsync(CHAT_ACTIVITY_COALESCE_MS);
    expect(invalidate).toHaveBeenCalledTimes(2);
  });

  test("dispose drops pending work and ignores what comes after", async () => {
    const { handle, dispose } = handler();
    handle(message("c1", OTHER, true));
    dispose();
    handle(message("c2", OTHER, false));
    await vi.advanceTimersByTimeAsync(CHAT_ACTIVITY_COALESCE_MS * 4);
    expect(markRead).not.toHaveBeenCalled();
    expect(invalidate).not.toHaveBeenCalled();
  });
});
