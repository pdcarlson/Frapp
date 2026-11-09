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
  claimViewedChannel,
  createChatActivityHandler,
  viewedChannelId,
  type ChatActivity,
} from "./chat-activity";
import {
  CHANNEL_LATEST_MESSAGES_KEY,
  CHANNEL_LIST_KEY,
  CHANNEL_UNREAD_COUNTS_KEY,
} from "./use-chat";

const VIEWER = "viewer-1";
const OTHER = "member-2";

const message = (channelId: string, senderId: string | null): ChatActivity => ({
  type: "message",
  channelId,
  senderId,
});

describe("createChatActivityHandler (#3698)", () => {
  let queryClient: QueryClient;
  let invalidate: MockInstance<QueryClient["invalidateQueries"]>;
  let markRead: Mock<(channelId: string) => Promise<unknown>>;
  /** The channel the member is looking at, if any. */
  let viewing: string | null;

  beforeEach(() => {
    vi.useFakeTimers();
    queryClient = new QueryClient();
    invalidate = vi.spyOn(queryClient, "invalidateQueries");
    markRead = vi.fn<(channelId: string) => Promise<unknown>>(
      async () => undefined,
    );
    viewing = null;
  });

  afterEach(() => {
    vi.useRealTimers();
    queryClient.clear();
  });

  const handler = () =>
    createChatActivityHandler({
      queryClient,
      viewerId: () => VIEWER,
      viewing: () => viewing,
      markRead,
    });

  const invalidatedKeys = () =>
    invalidate.mock.calls.map(([filters]) => filters?.queryKey);

  test("a message elsewhere re-reads exactly the unread counts and the latest messages", async () => {
    const { handle } = handler();
    handle(message("c1", OTHER));
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
    handle(message("c1", OTHER));
    handle(message("c2", OTHER));
    handle({ type: "resync" });
    await vi.advanceTimersByTimeAsync(CHAT_ACTIVITY_COALESCE_MS);
    expect(invalidate).toHaveBeenCalledTimes(2);
  });

  test("someone else's message in the thread being viewed re-stamps it read before the re-read", async () => {
    viewing = "c1";
    const order: string[] = [];
    markRead.mockImplementation(async (id: string) => {
      order.push(`read:${id}`);
    });
    invalidate.mockImplementation(async () => {
      order.push("invalidate");
    });
    const { handle } = handler();
    handle(message("c1", OTHER));
    handle(message("c1", OTHER));

    await vi.advanceTimersByTimeAsync(CHAT_ACTIVITY_COALESCE_MS);

    expect(markRead).toHaveBeenCalledTimes(1);
    expect(markRead).toHaveBeenCalledWith("c1");
    expect(order).toEqual(["read:c1", "invalidate", "invalidate"]);
  });

  test("a thread that isn't being viewed is not marked read, even if it is subscribed underneath", async () => {
    // A mobile thread stays mounted under a screen pushed over it; only the
    // focused one claims to be viewed.
    viewing = "c2";
    const { handle } = handler();
    handle(message("c1", OTHER));
    await vi.advanceTimersByTimeAsync(CHAT_ACTIVITY_COALESCE_MS);
    expect(markRead).not.toHaveBeenCalled();
    expect(invalidate).toHaveBeenCalledTimes(2);
  });

  test("the viewer's own message, and a sender-less one, never stamp", async () => {
    viewing = "c1";
    const { handle } = handler();
    handle(message("c1", VIEWER));
    handle(message("c1", null));
    await vi.advanceTimersByTimeAsync(CHAT_ACTIVITY_COALESCE_MS);
    expect(markRead).not.toHaveBeenCalled();
    expect(invalidate).toHaveBeenCalledTimes(2);
  });

  test("a failed stamp still re-reads the counts", async () => {
    viewing = "c1";
    markRead.mockRejectedValue(new Error("offline"));
    const { handle } = handler();
    handle(message("c1", OTHER));
    await vi.advanceTimersByTimeAsync(CHAT_ACTIVITY_COALESCE_MS);
    expect(invalidate).toHaveBeenCalledTimes(2);
  });

  test("a later round never re-reads before an earlier round's slow stamp has landed", async () => {
    viewing = "c1";
    let landStamp!: () => void;
    markRead.mockImplementationOnce(
      () =>
        new Promise<unknown>((resolve) => {
          landStamp = () => resolve(null);
        }),
    );
    const { handle } = handler();
    handle(message("c1", OTHER));
    await vi.advanceTimersByTimeAsync(CHAT_ACTIVITY_COALESCE_MS);
    expect(markRead).toHaveBeenCalledTimes(1);

    // A message elsewhere while the stamp is still in flight.
    handle(message("c2", OTHER));
    await vi.advanceTimersByTimeAsync(CHAT_ACTIVITY_COALESCE_MS * 4);
    expect(invalidate).not.toHaveBeenCalled();

    landStamp();
    await vi.advanceTimersByTimeAsync(0);
    // The first round's re-read, then the second's.
    expect(invalidate).toHaveBeenCalledTimes(4);
  });

  test("a slow re-read holds back nothing after it", async () => {
    viewing = "c1";
    // The first round's summary reads never settle (a retrying or hung fetch).
    invalidate.mockImplementation(() => new Promise<void>(() => {}));
    const { handle } = handler();
    handle(message("c2", OTHER));
    await vi.advanceTimersByTimeAsync(CHAT_ACTIVITY_COALESCE_MS);
    expect(invalidate).toHaveBeenCalledTimes(2);

    handle(message("c1", OTHER));
    await vi.advanceTimersByTimeAsync(CHAT_ACTIVITY_COALESCE_MS);
    expect(markRead).toHaveBeenCalledWith("c1");
    expect(invalidate).toHaveBeenCalledTimes(4);
  });

  test("a resync re-stamps the channel being looked at, then re-reads", async () => {
    // Back from the background on the thread the member was reading: what
    // arrived meanwhile is on screen now.
    viewing = "c1";
    const { handle } = handler();
    handle({ type: "resync" });
    await vi.advanceTimersByTimeAsync(CHAT_ACTIVITY_COALESCE_MS);
    expect(markRead).toHaveBeenCalledWith("c1");
    expect(invalidate).toHaveBeenCalledTimes(2);
  });

  test("a resync re-reads both summaries", async () => {
    const { handle } = handler();
    handle({ type: "resync" });
    await vi.advanceTimersByTimeAsync(CHAT_ACTIVITY_COALESCE_MS);
    expect(invalidate).toHaveBeenCalledTimes(2);
  });

  test("dispose drops pending work and ignores what comes after", async () => {
    viewing = "c1";
    const { handle, dispose } = handler();
    handle(message("c1", OTHER));
    dispose();
    handle(message("c2", OTHER));
    await vi.advanceTimersByTimeAsync(CHAT_ACTIVITY_COALESCE_MS * 4);
    expect(markRead).not.toHaveBeenCalled();
    expect(invalidate).not.toHaveBeenCalled();
  });
});

describe("claimViewedChannel (#3698)", () => {
  test("a claim names the channel until its own release", () => {
    const release = claimViewedChannel("c1");
    expect(viewedChannelId()).toBe("c1");
    release();
    expect(viewedChannelId()).toBeNull();
  });

  test("a newer claim wins, and the older one's late release can't clear it", () => {
    const releaseA = claimViewedChannel("a");
    const releaseB = claimViewedChannel("b");
    releaseA();
    expect(viewedChannelId()).toBe("b");
    releaseB();
    expect(viewedChannelId()).toBeNull();
  });
});
