import {
  chatActivityStampsSettled,
  holdChannelUnread,
  releaseChannelUnread,
} from "./read-cursor";
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
import { QueryClient, QueryObserver } from "@tanstack/react-query";
import {
  CHAT_ACTIVITY_COALESCE_MS,
  CHAT_JOIN_CHECK_MS,
  claimViewedChannel,
  createChatActivityHandler,
  viewedChannelId,
  type ChatActivity,
} from "./chat-activity";
import {
  CHANNEL_LATEST_MESSAGES_KEY,
  CHANNEL_LIST_KEY,
  CHANNEL_UNREAD_COUNTS_KEY,
  type ChannelUnreadCount,
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

  test("a stamp queued for a channel Mark unread then holds is never sent (#3723)", async () => {
    viewing = "c1";
    const { handle } = handler();
    handle(message("c1", OTHER));
    // The member marks it unread inside the coalescing window.
    holdChannelUnread("c1");
    await vi.advanceTimersByTimeAsync(CHAT_ACTIVITY_COALESCE_MS);
    expect(markRead).not.toHaveBeenCalled();
    releaseChannelUnread("c1");
  });

  test("Mark unread can wait for a round already sending (#3723)", async () => {
    viewing = "c1";
    let land!: () => void;
    markRead.mockImplementation(
      () =>
        new Promise<undefined>((resolve) => (land = () => resolve(undefined))),
    );
    const { handle } = handler();
    handle(message("c1", OTHER));
    await vi.advanceTimersByTimeAsync(CHAT_ACTIVITY_COALESCE_MS);
    let settled = false;
    void chatActivityStampsSettled().then(() => (settled = true));
    await vi.advanceTimersByTimeAsync(0);
    expect(settled).toBe(false);
    land();
    await vi.advanceTimersByTimeAsync(0);
    expect(settled).toBe(true);
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

describe("createChatActivityHandler: the inbox's first join (#4961)", () => {
  /*
    The server's unread count for `c1`, and how many times the counts were
    read. The counts are a real query with a mounted observer, so an
    invalidation refetches them as the badge's own query would.
  */
  let serverUnread: number;
  let reads: number;
  let queryClient: QueryClient;
  let markRead: Mock<(channelId: string) => Promise<unknown>>;
  let viewing: string | null;
  let stopObserving: () => void;
  /** Runs inside each read of `mountBadge`'s query, before it answers. */
  let observerFn: () => Promise<void>;

  beforeEach(() => {
    vi.useFakeTimers();
    observerFn = async () => {};
    serverUnread = 0;
    reads = 0;
    viewing = null;
    queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false, staleTime: Infinity } },
    });
    markRead = vi.fn<(channelId: string) => Promise<unknown>>(
      async () => undefined,
    );
    stopObserving = () => {};
  });

  afterEach(() => {
    stopObserving();
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

  /** Mounts the badge's query, which reads the counts once. */
  const mountBadge = async () => {
    const observer = new QueryObserver<ChannelUnreadCount[]>(queryClient, {
      queryKey: CHANNEL_UNREAD_COUNTS_KEY,
      queryFn: async () => {
        reads += 1;
        await observerFn();
        return [
          { channel_id: "c1", unread_count: serverUnread, mention_count: 0 },
        ];
      },
    });
    stopObserving = observer.subscribe(() => {});
    await vi.advanceTimersByTimeAsync(0);
  };

  const badge = () =>
    queryClient.getQueryData<ChannelUnreadCount[]>(CHANNEL_UNREAD_COUNTS_KEY)?.[0]
      ?.unread_count;

  test("a message between the counts' read and the join lights the badge", async () => {
    await mountBadge();
    expect(reads).toBe(1);
    expect(badge()).toBe(0);

    // A message lands after the server read the counts and before the inbox
    // joined: no inbox saw it, so nothing reports it.
    serverUnread = 1;
    const { handle } = handler();
    handle({ type: "joined" });

    // No read of the counts starts after the join, so the handler starts one.
    await vi.advanceTimersByTimeAsync(CHAT_JOIN_CHECK_MS);
    await vi.advanceTimersByTimeAsync(CHAT_ACTIVITY_COALESCE_MS);
    expect(reads).toBe(2);
    expect(badge()).toBe(1);
  });

  test("a read that starts after the join is enough: no second read", async () => {
    await mountBadge();
    serverUnread = 1;
    const { handle } = handler();
    handle({ type: "joined" });

    // Opening the thread stamps it, and the stamp re-reads the counts.
    await vi.advanceTimersByTimeAsync(CHAT_JOIN_CHECK_MS / 4);
    void queryClient.invalidateQueries({
      queryKey: CHANNEL_UNREAD_COUNTS_KEY,
      exact: true,
    });
    await vi.advanceTimersByTimeAsync(0);
    expect(reads).toBe(2);
    expect(badge()).toBe(1);

    await vi.advanceTimersByTimeAsync(CHAT_JOIN_CHECK_MS * 2);
    expect(reads).toBe(2);
    expect(markRead).not.toHaveBeenCalled();
  });

  test("a read still in flight at the join is not enough", async () => {
    // Its server read may have run before the join.
    let answer!: () => void;
    const observer = new QueryObserver<ChannelUnreadCount[]>(queryClient, {
      queryKey: CHANNEL_UNREAD_COUNTS_KEY,
      queryFn: async () => {
        reads += 1;
        if (reads === 1) {
          await new Promise<void>((resolve) => {
            answer = resolve;
          });
        }
        return [
          { channel_id: "c1", unread_count: serverUnread, mention_count: 0 },
        ];
      },
    });
    stopObserving = observer.subscribe(() => {});
    await vi.advanceTimersByTimeAsync(0);
    expect(reads).toBe(1);

    const { handle } = handler();
    handle({ type: "joined" });
    serverUnread = 1;
    answer();
    await vi.advanceTimersByTimeAsync(CHAT_JOIN_CHECK_MS);
    await vi.advanceTimersByTimeAsync(CHAT_ACTIVITY_COALESCE_MS);
    expect(reads).toBe(2);
    expect(badge()).toBe(1);
  });

  test("a first read that outlasts the check is read again once it settles", async () => {
    // A slow bootstrap: the counts' first read is still running, with no data
    // yet, when the check gives up waiting. An invalidation now would be
    // folded into that read and send nothing new.
    let answer!: () => void;
    const observer = new QueryObserver<ChannelUnreadCount[]>(queryClient, {
      queryKey: CHANNEL_UNREAD_COUNTS_KEY,
      queryFn: async () => {
        reads += 1;
        if (reads === 1) {
          await new Promise<void>((resolve) => {
            answer = resolve;
          });
        }
        return [
          { channel_id: "c1", unread_count: serverUnread, mention_count: 0 },
        ];
      },
    });
    stopObserving = observer.subscribe(() => {});
    await vi.advanceTimersByTimeAsync(0);

    const { handle } = handler();
    handle({ type: "joined" });
    await vi.advanceTimersByTimeAsync(CHAT_JOIN_CHECK_MS * 3);
    expect(reads).toBe(1);

    // The message landed after that read's server read, before the join.
    serverUnread = 1;
    answer();
    await vi.advanceTimersByTimeAsync(0);
    await vi.advanceTimersByTimeAsync(CHAT_ACTIVITY_COALESCE_MS);
    expect(reads).toBe(2);
    expect(badge()).toBe(1);
  });

  test("a refetch that cancels and replaces a running one counts as a read after the join", async () => {
    viewing = "c1";
    await mountBadge();
    // A refetch running at the join (a remount's stale refetch).
    let answerStale!: () => void;
    let calls = 0;
    observerFn = async () => {
      calls += 1;
      if (calls === 1) {
        await new Promise<void>((resolve) => {
          answerStale = resolve;
        });
      }
    };
    void queryClient.refetchQueries({ queryKey: CHANNEL_UNREAD_COUNTS_KEY });
    await vi.advanceTimersByTimeAsync(0);
    expect(reads).toBe(2);

    const { handle } = handler();
    handle({ type: "joined" });

    // The thread's stamp invalidates the counts: TanStack silently cancels
    // the running refetch and sends a new one, with no `fetch` action.
    await vi.advanceTimersByTimeAsync(CHAT_JOIN_CHECK_MS / 4);
    void queryClient.invalidateQueries({
      queryKey: CHANNEL_UNREAD_COUNTS_KEY,
      exact: true,
    });
    await vi.advanceTimersByTimeAsync(0);
    expect(reads).toBe(3);
    answerStale();

    await vi.advanceTimersByTimeAsync(CHAT_JOIN_CHECK_MS * 2);
    expect(reads).toBe(3);
    expect(markRead).not.toHaveBeenCalled();
  });

  test("another query's read after the join doesn't count", async () => {
    await mountBadge();
    serverUnread = 1;
    const { handle } = handler();
    handle({ type: "joined" });

    // The channel list, the inbox and the rest of the open read too.
    await queryClient.fetchQuery({
      queryKey: CHANNEL_LIST_KEY,
      queryFn: async () => [],
    });
    await vi.advanceTimersByTimeAsync(CHAT_JOIN_CHECK_MS);
    await vi.advanceTimersByTimeAsync(CHAT_ACTIVITY_COALESCE_MS);
    expect(reads).toBe(2);
    expect(badge()).toBe(1);
  });

  test("counts cached but not read yet (waiting for the chapter) need nothing", async () => {
    viewing = "c1";
    const observer = new QueryObserver<ChannelUnreadCount[]>(queryClient, {
      queryKey: CHANNEL_UNREAD_COUNTS_KEY,
      queryFn: async () => {
        reads += 1;
        return [];
      },
      enabled: false,
    });
    stopObserving = observer.subscribe(() => {});
    const { handle } = handler();
    handle({ type: "joined" });
    await vi.advanceTimersByTimeAsync(CHAT_JOIN_CHECK_MS * 2);
    expect(reads).toBe(0);
    expect(markRead).not.toHaveBeenCalled();
  });

  test("counts never read yet need nothing: their first read follows the join", async () => {
    const { handle } = handler();
    handle({ type: "joined" });
    await vi.advanceTimersByTimeAsync(CHAT_JOIN_CHECK_MS * 2);
    expect(reads).toBe(0);
    expect(markRead).not.toHaveBeenCalled();
  });

  test("when it does re-read, it re-stamps the channel being looked at first, as a resync does", async () => {
    viewing = "c1";
    await mountBadge();
    const { handle } = handler();
    handle({ type: "joined" });
    await vi.advanceTimersByTimeAsync(CHAT_JOIN_CHECK_MS);
    await vi.advanceTimersByTimeAsync(CHAT_ACTIVITY_COALESCE_MS);
    expect(markRead).toHaveBeenCalledWith("c1");
    expect(reads).toBe(2);
  });

  test("dispose ends a pending check", async () => {
    await mountBadge();
    const { handle, dispose } = handler();
    handle({ type: "joined" });
    dispose();
    await vi.advanceTimersByTimeAsync(CHAT_JOIN_CHECK_MS * 2);
    expect(reads).toBe(1);
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
