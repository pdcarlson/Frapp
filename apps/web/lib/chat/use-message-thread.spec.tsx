import type { ReactNode } from "react";
import { act, renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { RawChatMessage } from "@repo/chat-core/types";

/**
 * `useMessageThread` (#3785, tests from #4034): the open thread's listener,
 * its gap reads after a reconnect and while polling, and the follow it shows
 * after a reply. The transport (`chatRealtime`) and the thread's reads and
 * writes (`@repo/chat-core/threads`, tested in `threads.spec.ts`) are
 * stubbed; what is under test is when this hook calls them.
 */

type Status = "live" | "reconnecting" | "polling" | "offline";

const mocks = vi.hoisted(() => {
  const statusListeners = new Set<(status: Status) => void>();
  const unsubscribeReply = vi.fn();
  let replyListener:
    ((row: unknown, event: "INSERT" | "UPDATE") => void) | null = null;
  return {
    statusListeners,
    unsubscribeReply,
    emit(status: Status) {
      for (const listener of [...statusListeners]) listener(status);
    },
    deliver(row: unknown, event: "INSERT" | "UPDATE") {
      replyListener?.(row, event);
    },
    onThreadReply: vi.fn(
      (
        _: string,
        listener: (row: unknown, event: "INSERT" | "UPDATE") => void,
      ) => {
        replyListener = listener;
        return () => {
          replyListener = null;
          unsubscribeReply();
        };
      },
    ),
    fetchThread: vi.fn(),
    loadThreadReplies: vi.fn(),
    backfillThreadReplies: vi.fn(),
    sendThreadReply: vi.fn(),
    markThreadRead: vi.fn(async () => undefined),
    applyThreadRealtimeRow: vi.fn(),
  };
});

vi.mock("@repo/hooks", () => ({
  useFrappClient: () => ({}),
  memberThreadKeys: { all: ["member-threads"] },
}));

// The client reactions are read with; the reads themselves are stubbed.
const SUPABASE = vi.hoisted(() => ({ from: () => undefined }));
vi.mock("@/lib/realtime/supabase-realtime", () => ({
  getRealtimeClient: () => SUPABASE,
}));

vi.mock("@repo/chat-core/realtime-manager", () => ({
  NO_TYPING_USERS: Object.freeze([]),
  // Short, so the polling case runs on real timers.
  POLL_INTERVAL_MS: 30,
  chatRealtime: {
    subscribeStatus: (listener: (status: Status) => void) => {
      mocks.statusListeners.add(listener);
      return () => mocks.statusListeners.delete(listener);
    },
    onThreadReply: mocks.onThreadReply,
    getTypingUsers: () => Object.freeze([]),
    emitTyping: vi.fn(),
  },
}));

vi.mock("@repo/chat-core/threads", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@repo/chat-core/threads")>();
  return {
    ...actual,
    fetchThread: mocks.fetchThread,
    loadThreadReplies: mocks.loadThreadReplies,
    backfillThreadReplies: mocks.backfillThreadReplies,
    sendThreadReply: mocks.sendThreadReply,
    markThreadRead: mocks.markThreadRead,
    applyThreadRealtimeRow: mocks.applyThreadRealtimeRow,
  };
});

const { useMessageThread } = await import("./use-message-thread");

const ROOT: RawChatMessage = {
  id: "root",
  channel_id: "c1",
  sender_id: "paul",
  kind: "text",
  content: "Who's driving?",
  created_at: "2026-11-10T12:00:00.000Z",
} as RawChatMessage;

let queryClient: QueryClient;

function wrapper({ children }: { children: ReactNode }) {
  return (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
}

function open() {
  return renderHook(() => useMessageThread("c1", "root", "me"), { wrapper });
}

beforeEach(() => {
  queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  mocks.statusListeners.clear();
  mocks.fetchThread.mockResolvedValue({
    root: ROOT,
    follow_state: null,
    last_read_at: null,
  });
  mocks.loadThreadReplies.mockResolvedValue({ hasMore: false });
  mocks.backfillThreadReplies.mockResolvedValue(undefined);
  mocks.sendThreadReply.mockResolvedValue({ error: null });
});

afterEach(() => {
  queryClient.clear();
  vi.clearAllMocks();
});

describe("useMessageThread", () => {
  it("takes live rows into the thread's cache, and lets go on unmount", async () => {
    const { unmount } = open();
    await waitFor(() => expect(mocks.loadThreadReplies).toHaveBeenCalled());
    expect(mocks.onThreadReply).toHaveBeenCalledWith(
      "c1",
      expect.any(Function),
    );

    const reply = { ...ROOT, id: "r1", thread_root_id: "root" };
    mocks.deliver(reply, "INSERT");
    expect(mocks.applyThreadRealtimeRow).toHaveBeenCalledWith(
      queryClient,
      "c1",
      "root",
      reply,
      "INSERT",
    );

    unmount();
    expect(mocks.unsubscribeReply).toHaveBeenCalledTimes(1);
    // No status listener of the hook's outlives it either.
    expect(mocks.statusListeners.size).toBe(0);
  });

  it("reads the gap once the connection comes back", async () => {
    open();
    await waitFor(() =>
      expect(mocks.loadThreadReplies).toHaveBeenCalledTimes(1),
    );
    expect(mocks.backfillThreadReplies).not.toHaveBeenCalled();

    act(() => mocks.emit("reconnecting"));
    // Not while it is still down.
    expect(mocks.backfillThreadReplies).not.toHaveBeenCalled();
    act(() => mocks.emit("live"));
    await waitFor(() =>
      expect(mocks.backfillThreadReplies).toHaveBeenCalledWith(
        queryClient,
        expect.anything(),
        "c1",
        "root",
        // Reactions are read with the replies, under the member's session.
        SUPABASE,
      ),
    );
    // The first page isn't read again: only the gap after the newest reply.
    expect(mocks.loadThreadReplies).toHaveBeenCalledTimes(1);
  });

  it("re-reads the gap on the polling beat, and stops when live again", async () => {
    open();
    await waitFor(() =>
      expect(mocks.loadThreadReplies).toHaveBeenCalledTimes(1),
    );

    act(() => mocks.emit("polling"));
    await waitFor(() =>
      expect(
        mocks.backfillThreadReplies.mock.calls.length,
      ).toBeGreaterThanOrEqual(2),
    );

    act(() => mocks.emit("live"));
    // Going live reads the gap once more, then the beat stops.
    await new Promise((resolve) => setTimeout(resolve, 40));
    const settled = mocks.backfillThreadReplies.mock.calls.length;
    await new Promise((resolve) => setTimeout(resolve, 120));
    expect(mocks.backfillThreadReplies.mock.calls.length).toBe(settled);
  });

  it("shows the thread followed after the viewer's reply lands", async () => {
    const { result } = open();
    await waitFor(() => expect(result.current.root).not.toBeNull());
    expect(result.current.followState).toBeNull();

    await act(async () => {
      await result.current.send("I can drive");
    });
    expect(mocks.sendThreadReply).toHaveBeenCalledWith(
      queryClient,
      expect.anything(),
      expect.objectContaining({
        channelId: "c1",
        rootId: "root",
        senderId: "me",
        content: "I can drive",
      }),
    );
    // The patch reaches the hook on React Query's next notify.
    await waitFor(() => expect(result.current.followState).toBe("following"));
  });

  it("leaves the follow alone when the reply fails, or the viewer chose one", async () => {
    mocks.sendThreadReply.mockResolvedValueOnce({ error: "Network" });
    const { result } = open();
    await waitFor(() => expect(result.current.root).not.toBeNull());
    await act(async () => {
      await result.current.send("lost");
    });
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(result.current.followState).toBeNull();

    mocks.fetchThread.mockResolvedValue({
      root: ROOT,
      follow_state: "muted",
      last_read_at: null,
    });
    const muted = open();
    await waitFor(() => expect(muted.result.current.followState).toBe("muted"));
    await act(async () => {
      await muted.result.current.send("still muted");
    });
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(muted.result.current.followState).toBe("muted");
  });

  it("retries a failed reply under its client id", async () => {
    const { result } = open();
    await waitFor(() => expect(result.current.root).not.toBeNull());
    act(() => {
      queryClient.setQueryData(["chat", "c1", "thread", "root", "replies"], {
        byId: {
          "client-1": {
            ...ROOT,
            id: "client-1",
            client_message_id: "client-1",
            content: "try again",
            _status: "failed",
          },
        },
        order: ["client-1"],
        actionIndex: {},
      });
    });
    await waitFor(() => expect(result.current.messages).toHaveLength(1));
    await act(async () => {
      await result.current.retry("client-1");
    });
    expect(mocks.sendThreadReply).toHaveBeenCalledWith(
      queryClient,
      expect.anything(),
      expect.objectContaining({
        content: "try again",
        clientMessageId: "client-1",
      }),
    );
  });
});

describe("useMessageThread's parent", () => {
  it("folds the parent's reactions into it", async () => {
    mocks.fetchThread.mockResolvedValue({
      root: ROOT,
      follow_state: null,
      last_read_at: null,
      root_actions: [
        {
          id: "act-1",
          message_id: "root",
          user_id: "shawn",
          action_type: "reaction:👍",
          payload: {},
          created_at: "2026-11-10T12:01:00.000Z",
        },
      ],
    });
    const { result } = open();
    await waitFor(() => expect(result.current.root).not.toBeNull());
    expect(mocks.fetchThread).toHaveBeenCalledWith(
      expect.anything(),
      "c1",
      "root",
      SUPABASE,
    );
    expect(result.current.root!.reactions["reaction:👍"]).toEqual(["shawn"]);
  });
});

describe("useMessageThread reopened over a held cache (#4034)", () => {
  it("settles whether older replies remain with one read", async () => {
    // A thread opened before, its replies still cached.
    queryClient.setQueryData(["chat", "c1", "thread", "root", "replies"], {
      byId: {
        r1: {
          ...ROOT,
          id: "r1",
          client_message_id: "c-r1",
          thread_root_id: "root",
          created_at: "2026-11-10T12:05:00.000Z",
          _status: "confirmed",
          reactions: {},
          actions: [],
        },
      },
      order: ["r1"],
      actionIndex: {},
    });
    mocks.loadThreadReplies.mockResolvedValue({ hasMore: false });

    const { result } = open();

    await waitFor(() =>
      expect(mocks.loadThreadReplies).toHaveBeenCalledWith(
        queryClient,
        expect.anything(),
        "c1",
        "root",
        "2026-11-10T12:05:00.000Z",
        SUPABASE,
      ),
    );
    expect(mocks.backfillThreadReplies).toHaveBeenCalled();
    await waitFor(() => expect(result.current.hasOlder).toBe(false));
  });

  it("re-reads the parent too once the connection comes back", async () => {
    open();
    await waitFor(() => expect(mocks.fetchThread).toHaveBeenCalledTimes(1));
    act(() => mocks.emit("reconnecting"));
    act(() => mocks.emit("live"));
    await waitFor(() => expect(mocks.fetchThread).toHaveBeenCalledTimes(2));
  });
});

describe("useMessageThread clears the thread card's new count (#4297)", () => {
  it("re-reads the followed threads once the thread is marked read", async () => {
    const invalidate = vi.spyOn(queryClient, "invalidateQueries");
    open();
    await waitFor(() => expect(mocks.markThreadRead).toHaveBeenCalled());
    await waitFor(() =>
      expect(invalidate).toHaveBeenCalledWith({
        queryKey: ["chat-followed-threads", "c1"],
      }),
    );
  });

  it("re-reads All threads too, so its unread mark clears (#4960)", async () => {
    const invalidate = vi.spyOn(queryClient, "invalidateQueries");
    open();
    await waitFor(() =>
      expect(invalidate).toHaveBeenCalledWith({
        queryKey: ["member-threads"],
      }),
    );
  });

  describe("GIFs (#4657)", () => {
    const GIF = {
      provider: "klipy",
      id: "g1",
      title: "wave",
      url: "https://static.klipy.com/g1.webp",
      width: 200,
      height: 150,
      token: "signed",
    };

    it("sends a GIF as its own reply, with no text", async () => {
      const { result } = open();
      await waitFor(() => expect(result.current.root).not.toBeNull());
      await act(async () => {
        await result.current.sendGif(GIF);
      });
      expect(mocks.sendThreadReply).toHaveBeenCalledWith(
        queryClient,
        expect.anything(),
        expect.objectContaining({ content: "", gif: GIF }),
      );
    });

    it("retries a failed GIF reply with its GIF and token", async () => {
      const { result } = open();
      await waitFor(() => expect(result.current.root).not.toBeNull());
      act(() => {
        queryClient.setQueryData(["chat", "c1", "thread", "root", "replies"], {
          byId: {
            "client-g": {
              ...ROOT,
              id: "client-g",
              client_message_id: "client-g",
              content: "",
              gif: GIF,
              _status: "failed",
            },
          },
          order: ["client-g"],
          actionIndex: {},
        });
      });
      await waitFor(() => expect(result.current.messages).toHaveLength(1));
      await act(async () => {
        await result.current.retry("client-g");
      });
      expect(mocks.sendThreadReply).toHaveBeenCalledWith(
        queryClient,
        expect.anything(),
        expect.objectContaining({
          content: "",
          clientMessageId: "client-g",
          gif: GIF,
        }),
      );
    });
  });
});
