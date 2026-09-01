/** @vitest-environment jsdom */
/**
 * Ordering and lifecycle proofs for `use-chat-channel.ts`.
 *
 * This file exists because four of the six bugs found in C1's review (PR #1002)
 * lived in that module, and every one of them was an **ordering** defect —
 * invisible to `tsc` and to ESLint, because each broken version was perfectly
 * well-typed. So these are not coverage-for-coverage's-sake tests: each `it`
 * below is pinned to a specific regression that has already happened once, and
 * each is written to fail if the sequence is restored to the broken order
 * rather than merely if the feature stops working.
 *
 * **The hook imports no `react-native`.** `vitest.setup.ts` warns that `FlatList`
 * is a string stand-in that never invokes `renderItem`, which is why list rows
 * are tested through their row components — but that constraint is about
 * rendering, and this module is pure orchestration over `@tanstack/react-query`,
 * `@repo/chat-core/*` and `./use-chat-runtime`. So it is driven directly with
 * `renderHook`, following `lib/use-notification-preferences-sync.spec.tsx`.
 *
 * **What is mocked and what is not.** The collaborators that own timing —
 * `chat-client`, `realtime-manager`, the draft store, the runtime — are mocked,
 * because the orderings under test are precisely *when* this hook calls them.
 * `@repo/chat-core/cache` and `/types` are left real: the cache-preservation
 * test below is only meaningful if `mergeServerRows` is the actual merge.
 */

import React from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { createFrappClient } from "@repo/api-sdk";
import { FrappClientProvider } from "@repo/hooks";
import { emptyCache, upsertOptimistic } from "@repo/chat-core/cache";
import {
  chatMessagesKey,
  normalizeRow,
  type ChannelCache,
  type ChatMessage,
  type RawChatMessage,
} from "@repo/chat-core/types";

const CHANNEL = "channel-1";

/**
 * Far past `DRAFT_SAVE_DEBOUNCE_MS` (400ms in the hook, not exported).
 *
 * Not imported, so a harmless retune of the debounce does not fail these tests
 * — but deliberately a large multiple rather than 500ms. A narrow overshoot is
 * only tolerant *downward*: raise the debounce past it and the cancellation
 * test below stops proving anything, because an uncancelled timer would simply
 * not be due yet and `save` would go uncalled for the wrong reason.
 */
const DRAFT_DEBOUNCE_OVERSHOOT_MS = 10_000;

/** A promise the test releases by hand, so an in-flight window is stable. */
function deferred<T = void>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

const mocks = vi.hoisted(() => {
  /**
   * Registered status listeners. The real `subscribeStatus`
   * (`packages/chat-core/src/realtime-manager.ts`) invokes the callback on
   * registration and returns an unsubscriber; a mock that only returns the
   * unsubscriber freezes `connection` at its initial value and makes both the
   * typing-array identity check and the unsubscribe path unobservable.
   */
  const statusListeners: ((status: unknown) => void)[] = [];
  return {
  statusListeners,
  subscribeStatus: vi.fn((cb: (status: unknown) => void) => {
    statusListeners.push(cb);
    cb("live");
    return () => {
      const at = statusListeners.indexOf(cb);
      if (at >= 0) statusListeners.splice(at, 1);
    };
  }),
  sendMessage: vi.fn(),
  flushOutbox: vi.fn(async () => undefined),
  hydrateOutboxIntoCache: vi.fn(async () => undefined),
  retryOutboxRow: vi.fn<(ctx: unknown, row: unknown) => Promise<void>>(),
  discardOutboxRow: vi.fn<(ctx: unknown, row: unknown) => Promise<void>>(),
  reactAction: vi.fn(async () => undefined),
  unreactAction: vi.fn(async () => undefined),
  actOnCard: vi.fn<(ctx: unknown, args: unknown) => Promise<void>>(),
  bootChatAdapters: vi.fn((): Promise<void> => Promise.resolve()),
  listForChannel: vi.fn(async () => [] as unknown[]),
  draftLoad: vi.fn(async () => ""),
  draftSave: vi.fn(async () => undefined),
  draftClear: vi.fn(async () => undefined),
  subscribe: vi.fn(),
  unsubscribe: vi.fn(),
  emitTyping: vi.fn(),
  getTypingUsers: vi.fn(() => [] as string[]),
  // `.from(...).select(...).in(...)` — the reaction-hydration chain in `queryFn`.
  // Deliberately NOT `null`: mocking the client away skips that branch entirely,
  // which would leave the cold-start regression below untested.
  supabaseIn: vi.fn(async () => ({ data: [] as unknown[] })),
  // Mutable so a test can null `ctx` and prove the write paths refuse.
  runtime: { ctx: null as unknown, viewerId: null as string | null },
  };
});

vi.mock("@repo/chat-core/chat-client", () => ({
  sendMessage: mocks.sendMessage,
  flushOutbox: mocks.flushOutbox,
  hydrateOutboxIntoCache: mocks.hydrateOutboxIntoCache,
  retryOutboxRow: mocks.retryOutboxRow,
  discardOutboxRow: mocks.discardOutboxRow,
  react: mocks.reactAction,
  unreact: mocks.unreactAction,
  actOnCard: mocks.actOnCard,
}));

vi.mock("@repo/chat-core/realtime-manager", () => ({
  chatRealtime: {
    subscribe: mocks.subscribe,
    unsubscribe: mocks.unsubscribe,
    subscribeStatus: mocks.subscribeStatus,
    getTypingUsers: mocks.getTypingUsers,
    emitTyping: mocks.emitTyping,
  },
}));

vi.mock("@/lib/supabase", () => ({
  getSupabaseClient: () => ({
    from: () => ({ select: () => ({ in: mocks.supabaseIn }) }),
  }),
}));

vi.mock("./draft-store", () => ({
  chatDraftStore: {
    load: mocks.draftLoad,
    save: mocks.draftSave,
    clear: mocks.draftClear,
  },
}));

vi.mock("./use-chat-runtime", () => ({
  useChatRuntime: () => mocks.runtime,
  bootChatAdapters: mocks.bootChatAdapters,
  chatOutboxStore: { listForChannel: mocks.listForChannel },
}));

import { useChatChannel } from "./use-chat-channel";

type MockClient = { GET: ReturnType<typeof vi.fn> };

function createClient(get?: MockClient["GET"]): MockClient {
  return { GET: get ?? vi.fn(async () => ({ data: [], error: null })) };
}

function createWrapper(client: MockClient, queryClient: QueryClient) {
  const Wrapper = ({ children }: { children: React.ReactNode }) => (
    <FrappClientProvider
      client={client as unknown as ReturnType<typeof createFrappClient>}
      chapterId="chapter-1"
    >
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    </FrappClientProvider>
  );
  Wrapper.displayName = "ChatChannelWrapper";
  return Wrapper;
}

function newQueryClient() {
  return new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
}

function renderChannel(client: MockClient = createClient()) {
  const queryClient = newQueryClient();
  const utils = renderHook(() => useChatChannel(CHANNEL), {
    wrapper: createWrapper(client, queryClient),
  });
  return { ...utils, queryClient };
}

function rawRow(id: string, createdAt: string): RawChatMessage {
  return {
    id,
    channel_id: CHANNEL,
    sender_id: "user-1",
    content: `body ${id}`,
    created_at: createdAt,
  } as RawChatMessage;
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.runtime = { ctx: { userId: "user-1" }, viewerId: "user-1" };
  mocks.bootChatAdapters.mockImplementation(() => Promise.resolve());
  mocks.sendMessage.mockImplementation(async () => undefined);
  mocks.draftLoad.mockImplementation(async () => "");
  mocks.statusListeners.length = 0;
  mocks.subscribeStatus.mockImplementation((cb: (status: unknown) => void) => {
    mocks.statusListeners.push(cb);
    cb("live");
    return () => {
      const at = mocks.statusListeners.indexOf(cb);
      if (at >= 0) mocks.statusListeners.splice(at, 1);
    };
  });
  mocks.getTypingUsers.mockImplementation(() => []);
  mocks.listForChannel.mockImplementation(async () => []);
  mocks.supabaseIn.mockImplementation(async () => ({ data: [] }));
});

afterEach(() => {
  vi.useRealTimers();
});

describe("send() re-entry", () => {
  it("collapses two taps landing in the same tick into exactly one sendMessage", async () => {
    // The regression: without `sendingRef`, a send held open by a slow POST
    // leaves the composer full and the button live. A second tap mints a *fresh*
    // client_message_id, which the server's dedupe index keys on and therefore
    // cannot collapse — the channel gets two identical messages. A state flag
    // cannot fix it, because the second tap lands before the re-render.
    const gate = deferred();
    mocks.sendMessage.mockImplementation(async () => {
      await gate.promise;
    });

    const { result } = renderChannel();
    await waitFor(() => expect(result.current.canSend).toBe(true));

    await act(async () => {
      void result.current.send("hello");
      void result.current.send("hello");
      await Promise.resolve();
    });

    expect(mocks.sendMessage).toHaveBeenCalledTimes(1);

    await act(async () => {
      gate.resolve();
      await gate.promise;
    });

    // And the guard releases, so the composer is not wedged for the session.
    await act(async () => {
      await result.current.send("second message");
    });
    expect(mocks.sendMessage).toHaveBeenCalledTimes(2);
  });
});

describe("send() failure", () => {
  it("restores the composer text and surfaces the error", async () => {
    // Mobile supplies no toast, so chat-core's failure toasts are silent no-ops
    // here. Restoring the text and naming the failure is the *only* way the
    // member learns the message went nowhere.
    mocks.sendMessage.mockImplementation(async () => {
      throw new Error("storage full");
    });

    const { result } = renderChannel();
    await waitFor(() => expect(result.current.canSend).toBe(true));

    await act(async () => {
      await result.current.send("unsent text");
    });

    expect(result.current.draft).toBe("unsent text");
    expect(result.current.sendError).toBe("storage full");
  });

  it("does not clear the persisted draft when the send never landed", async () => {
    // `clear` runs only after `sendMessage` resolves. If it were moved before
    // the await — or into a `finally` — a failed send would wipe the stored
    // draft while the composer still showed the text, so the words would
    // survive only until the next remount.
    mocks.sendMessage.mockImplementation(async () => {
      throw new Error("offline");
    });

    const { result } = renderChannel();
    await waitFor(() => expect(result.current.canSend).toBe(true));

    await act(async () => {
      await result.current.send("keep me");
    });

    expect(mocks.draftClear).not.toHaveBeenCalled();
  });

  it("clears the composer and the stale error once the send succeeds", async () => {
    const { result } = renderChannel();
    await waitFor(() => expect(result.current.canSend).toBe(true));

    // Fail once first. Without this the two assertions at the end hold on the
    // hook's *initial* state — `draft` starts "" and `sendError` starts null —
    // so they would pass even with `setDraftState("")` and `setSendError(null)`
    // deleted from `send`, which is exactly the stale-error-banner bug.
    mocks.sendMessage.mockImplementationOnce(async () => {
      throw new Error("first attempt failed");
    });
    await act(async () => {
      await result.current.send("delivered");
    });
    expect(result.current.sendError).toBe("first attempt failed");
    expect(result.current.draft).toBe("delivered");

    await act(async () => {
      await result.current.send("delivered");
    });

    expect(mocks.draftClear).toHaveBeenCalledWith(CHANNEL);
    expect(result.current.draft).toBe("");
    expect(result.current.sendError).toBeNull();
  });

  it("clears on a channel switch, so it never leaks onto the next thread (#1431)", async () => {
    // Mirrors reactionError's equivalent test below (#999's precedent) —
    // sendError had no channel-switch reset at all until this fix.
    mocks.sendMessage.mockImplementation(async () => {
      throw new Error("offline");
    });
    const queryClient = newQueryClient();
    const client = createClient();
    const { result, rerender } = renderHook(
      ({ channelId }: { channelId: string }) => useChatChannel(channelId),
      {
        initialProps: { channelId: CHANNEL },
        wrapper: createWrapper(client, queryClient),
      },
    );
    await waitFor(() => expect(result.current.canSend).toBe(true));

    await act(async () => {
      await result.current.send("unsent text");
    });
    expect(result.current.sendError).toBe("offline");

    rerender({ channelId: "channel-2" });

    expect(result.current.sendError).toBeNull();
  });

  it("ignores a stale send rejection that resolves after a channel switch", async () => {
    // The regression the channel/generation guard above closes: channel A's
    // send is still in flight when the member switches to channel B, then
    // A's send rejects. Its catch must not paint A's error — or restore A's
    // failed draft text — onto B, which is exactly the leak this fix exists
    // to close, just via the in-flight route rather than an already-settled
    // one (companion to reactionError's equivalent test below, #999).
    const gate = deferred();
    mocks.sendMessage.mockImplementation(async () => {
      await gate.promise;
    });
    const queryClient = newQueryClient();
    const client = createClient();
    const { result, rerender } = renderHook(
      ({ channelId }: { channelId: string }) => useChatChannel(channelId),
      {
        initialProps: { channelId: CHANNEL },
        wrapper: createWrapper(client, queryClient),
      },
    );
    await waitFor(() => expect(result.current.canSend).toBe(true));

    let sendPromise: Promise<void> = Promise.resolve();
    act(() => {
      sendPromise = result.current.send("unsent text");
    });

    rerender({ channelId: "channel-2" });
    expect(result.current.sendError).toBeNull();

    await act(async () => {
      gate.reject(new Error("too late"));
      await sendPromise;
    });

    expect(result.current.sendError).toBeNull();
    expect(result.current.draft).not.toBe("unsent text");
  });
});

describe("send() and the draft debounce", () => {
  it("cancels the pending draft write before clearing the composer", async () => {
    // The regression: `setDraft` schedules a 400ms write. Send without
    // cancelling it first and a keystroke from under 400ms ago re-persists the
    // draft *after* the send has already cleared it — so the composer comes back
    // populated with a message that was already delivered.
    const { result } = renderChannel();
    await waitFor(() => expect(result.current.canSend).toBe(true));
    // Only now. `waitFor` polls on timers, so faking them before the hook has
    // settled deadlocks the poll rather than testing anything.
    vi.useFakeTimers();

    act(() => {
      result.current.setDraft("about to send");
    });
    expect(mocks.draftSave).not.toHaveBeenCalled();

    await act(async () => {
      await result.current.send("about to send");
    });

    // Past the debounce window: the cancelled timer must not fire.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(DRAFT_DEBOUNCE_OVERSHOOT_MS);
    });

    expect(mocks.draftSave).not.toHaveBeenCalled();
  });

  it("cancels the debounce before awaiting the network, not in a finally", async () => {
    // The previous version of this test advanced the clock only after `send()`
    // had fully resolved, so a `cancelDraftTimer()` sitting anywhere in `send`
    // — including a `finally` — killed the timer in time and passed. That is
    // the broken shape: in production `sendMessage` awaits a network POST, and
    // if it takes longer than the 400ms debounce the write fires *mid-flight*,
    // re-persisting the very text the send is about to clear. So the clock has
    // to advance while the POST is still open.
    const gate = deferred();
    mocks.sendMessage.mockImplementation(async () => {
      await gate.promise;
    });

    const { result } = renderChannel();
    await waitFor(() => expect(result.current.canSend).toBe(true));
    vi.useFakeTimers();

    act(() => {
      result.current.setDraft("about to send");
    });

    let inFlight!: Promise<void>;
    act(() => {
      inFlight = result.current.send("about to send");
    });

    // The POST is still open here.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(DRAFT_DEBOUNCE_OVERSHOOT_MS);
    });

    expect(mocks.draftSave).not.toHaveBeenCalled();

    await act(async () => {
      gate.resolve();
      await inFlight;
    });
  });

  it("coalesces a burst of keystrokes into a single persisted write", async () => {
    // `setDraft` cancels its own pending timer before scheduling the next one —
    // a *different* `cancelDraftTimer()` call site from the one in `send`, and
    // previously untested. Without it every keystroke schedules its own write:
    // three characters become three AsyncStorage writes with no ordering
    // guarantee between them, so the persisted draft can end up as "a" while
    // the member sees "abc". This is the "a draft write never rides every
    // keystroke" invariant the debounce exists for.
    const { result } = renderChannel();
    await waitFor(() => expect(result.current.canSend).toBe(true));
    vi.useFakeTimers();

    act(() => {
      result.current.setDraft("a");
      result.current.setDraft("ab");
      result.current.setDraft("abc");
    });

    await act(async () => {
      await vi.advanceTimersByTimeAsync(DRAFT_DEBOUNCE_OVERSHOOT_MS);
    });

    expect(mocks.draftSave).toHaveBeenCalledTimes(1);
    expect(mocks.draftSave).toHaveBeenCalledWith(CHANNEL, "abc");
  });

  it("still persists a draft that is only typed, never sent", async () => {
    // The negative control for the test above. If `setDraft` stopped scheduling
    // at all, the cancellation test would pass vacuously and drafts would
    // silently stop persisting.
    const { result } = renderChannel();
    await waitFor(() => expect(result.current.canSend).toBe(true));
    vi.useFakeTimers();

    act(() => {
      result.current.setDraft("just typing");
    });

    await act(async () => {
      await vi.advanceTimersByTimeAsync(DRAFT_DEBOUNCE_OVERSHOOT_MS);
    });

    expect(mocks.draftSave).toHaveBeenCalledWith(CHANNEL, "just typing");
  });
});

describe("realtime attach", () => {
  it("waits for bootChatAdapters before subscribing", async () => {
    // The regression, and the subtlest one here: the runtime applies
    // `configure({viewerId})` inside a `.then` on this same boot promise. A
    // synchronous `subscribe()` runs one microtask *earlier*, so `installChannel`
    // captures `viewerId: null` and the channel never calls `channel.track`.
    // The viewer then has no presence entry — and the push worker reads presence
    // on `chat:channel:<id>` to skip members currently in the channel (ADR-10),
    // so they get pushed notifications for the thread they are actively reading.
    // Because the chat screen is a `Tabs.Screen` it stays mounted and the effect
    // never re-runs, so it persists for the channel's lifetime.
    const boot = deferred();
    mocks.bootChatAdapters.mockImplementation(() => boot.promise);

    renderChannel();

    // Drain the microtask queue while `boot` is still held. Asserting straight
    // after render would only rule out a *synchronous* subscribe, and the bug
    // this guards is one microtask wide: the runtime applies its
    // `configure({viewerId})` in a `.then` on this same promise, so a
    // merely-deferred `subscribe` would still land first and still capture
    // `viewerId: null`.
    await act(async () => {
      await Promise.resolve();
    });

    expect(mocks.subscribe).not.toHaveBeenCalled();

    await act(async () => {
      boot.resolve();
      await boot.promise;
    });

    expect(mocks.subscribe).toHaveBeenCalledWith(CHANNEL);
    // The third statement in the same `.then` body, and previously unasserted.
    // Without it a member who composed offline opens the channel to an empty
    // thread: the outbox row still exists, but nothing re-enters it into the
    // query cache until a flush happens to succeed.
    expect(mocks.hydrateOutboxIntoCache).toHaveBeenCalledWith(
      mocks.runtime.ctx,
      CHANNEL,
    );
  });

  it("releases only a refcount it actually took when unmount races boot", async () => {
    // `chatRealtime` refcounts per channel, so an unmount that fires before the
    // boot promise settles must not decrement — two screens can share a channel,
    // and an unearned `unsubscribe` tears down the other one's subscription.
    const boot = deferred();
    mocks.bootChatAdapters.mockImplementation(() => boot.promise);

    const { unmount } = renderChannel();
    unmount();

    await act(async () => {
      boot.resolve();
      await boot.promise;
    });

    expect(mocks.unsubscribe).not.toHaveBeenCalled();
    expect(mocks.subscribe).not.toHaveBeenCalled();
  });

  it("unsubscribes on unmount once it has attached", async () => {
    const { unmount } = renderChannel();
    await waitFor(() => expect(mocks.subscribe).toHaveBeenCalledWith(CHANNEL));

    unmount();

    expect(mocks.unsubscribe).toHaveBeenCalledWith(CHANNEL);
  });
});

describe("status subscription", () => {
  it("keeps the typing array identity when membership has not changed", async () => {
    // `getTypingUsers` builds a fresh array on every call, and the manager pings
    // status listeners on its 1.5s typing-expiry sweep. Returning that array
    // unconditionally never hits React's `Object.is` bail-out, so the whole
    // thread re-rendered every 1.5s while anyone was typing — rebuilding every
    // visible bubble's StyleSheet.
    mocks.getTypingUsers.mockImplementation(() => ["user-7"]);

    const { result } = renderChannel();
    await waitFor(() => expect(result.current.typingUsers).toEqual(["user-7"]));

    const before = result.current.typingUsers;
    act(() => {
      mocks.statusListeners.forEach((cb) => cb("live"));
    });
    // Same membership -> same reference, so React bails out of the re-render.
    expect(result.current.typingUsers).toBe(before);

    mocks.getTypingUsers.mockImplementation(() => ["user-7", "user-8"]);
    act(() => {
      mocks.statusListeners.forEach((cb) => cb("live"));
    });
    expect(result.current.typingUsers).toEqual(["user-7", "user-8"]);
  });

  it("releases every status listener on unmount", async () => {
    // Both the connection pill and the typing line subscribe. Dropping either
    // returned unsubscriber leaks a listener per channel open, each of which
    // calls setState on an unmounted component for the rest of the session.
    const { unmount } = renderChannel();
    await waitFor(() => expect(mocks.statusListeners.length).toBeGreaterThan(0));

    unmount();

    expect(mocks.statusListeners).toHaveLength(0);
  });
});

describe("initial queryFn", () => {
  it("merges onto cache written while the fetch was in flight", async () => {
    // The regression: merging onto `emptyCache()` discarded every concurrent
    // writer. Three of them target this key while the initial fetch is open —
    // an optimistic send, `hydrateOutboxIntoCache`, and the realtime merge — so
    // a message sent during the initial spinner vanished. Its outbox row had
    // already been dequeued on success, so nothing restored it until a remount.
    const gate = deferred<{ data: RawChatMessage[]; error: null }>();
    const client = createClient(vi.fn(() => gate.promise));

    const queryClient = newQueryClient();
    const { result } = renderHook(() => useChatChannel(CHANNEL), {
      wrapper: createWrapper(client, queryClient),
    });

    // A send lands mid-flight and writes an optimistic row into the same key.
    const optimistic: ChatMessage = {
      ...normalizeRow(rawRow("optimistic-id", "2026-08-27T00:00:01.000Z")),
      client_message_id: "client-abc",
      _status: "pending",
    };

    act(() => {
      queryClient.setQueryData<ChannelCache>(
        chatMessagesKey(CHANNEL),
        upsertOptimistic(emptyCache(), optimistic),
      );
    });

    await act(async () => {
      gate.resolve({
        data: [rawRow("server-1", "2026-08-27T00:00:00.000Z")],
        error: null,
      });
      await gate.promise;
    });

    // Wait on the rows themselves, not on `isLoading`. `setQueryData` above
    // dispatches a manual success on this key, so `isPending` is already false
    // by here — that barrier would return instantly on the optimistic-only
    // cache and flake on the assertion below rather than on the regression.
    await waitFor(() =>
      expect(result.current.messages.map((m) => m.id)).toContain("server-1"),
    );

    const ids = result.current.messages.map((m) => m.id);
    // The whole point: the in-flight write survives the backfill.
    expect(ids).toContain("optimistic-id");
  });

  it("hydrates reactions on a cold start, before ctx resolves", async () => {
    // The fourth C1 regression, and the one most easily reintroduced: this
    // query runs on first render with `staleTime: Infinity` and no `supabase`
    // in its key. `ctx` is null until the viewer's `users.id` resolves, so
    // sourcing the client from `ctx?.supabase` skipped hydration on *every*
    // cold start and — because nothing invalidates the key — never retried it.
    // Reactions stayed blank and poll cards read zero until a live action
    // INSERT happened to arrive. Web is not exposed to this because its client
    // comes from a provider; mobile reads the module directly, and that is the
    // distinction this test exists to hold.
    //
    // So: `ctx` is deliberately null for the whole test. Hydration must still
    // happen, which is only true while the client is read from
    // `getSupabaseClient()` rather than from `ctx`.
    mocks.runtime = { ctx: null, viewerId: null };
    mocks.supabaseIn.mockImplementation(async () => ({
      data: [
        {
          id: "action-1",
          message_id: "server-1",
          user_id: "user-9",
          action_type: "reaction:+1",
          created_at: "2026-08-27T00:00:02.000Z",
        },
      ],
    }));

    const client = createClient(
      vi.fn(async () => ({
        data: [rawRow("server-1", "2026-08-27T00:00:00.000Z")],
        error: null,
      })),
    );

    const { result } = renderChannel(client);
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    // The branch ran at all — with `ctx` null the whole time.
    expect(mocks.supabaseIn).toHaveBeenCalledWith("message_id", ["server-1"]);
    // And the reaction actually landed on the message, not just fetched.
    const message = result.current.messages.find((m) => m.id === "server-1");
    expect(message?.reactions["reaction:+1"]).toEqual(["user-9"]);
  });
});

describe("before the viewer's ctx resolves", () => {
  // `ctx` is null until the viewer's `users.id` resolves, and every callback in
  // the hook guards on it. Nothing exercised that: with `ctx` installed
  // synchronously in `beforeEach`, `canSend` is true on the very first render,
  // so `waitFor(canSend)` resolves immediately and is a barrier rather than an
  // assertion. Deleting `!!ctx &&` from `canSend` — the guard documented as
  // "the composer must disable rather than no-op silently" — left the whole
  // suite green until this block existed.
  it("reports canSend false and refuses every write path", async () => {
    mocks.runtime = { ctx: null, viewerId: null };
    mocks.listForChannel.mockImplementation(async () => [
      { clientId: "client-aaa", id: "server-zzz", channelId: CHANNEL },
    ]);

    const { result } = renderChannel();

    expect(result.current.canSend).toBe(false);

    await act(async () => {
      await result.current.send("should not send");
      await result.current.retry("client-aaa");
      await result.current.discard("client-aaa");
    });

    expect(mocks.sendMessage).not.toHaveBeenCalled();
    expect(mocks.retryOutboxRow).not.toHaveBeenCalled();
    expect(mocks.discardOutboxRow).not.toHaveBeenCalled();
    // And the composer was not silently emptied by the refused send.
    expect(result.current.draft).toBe("");
  });

  it("does not subscribe to realtime without a ctx", async () => {
    // The attach effect returns early on `!ctx`, so a channel is never
    // installed for a viewer the manager could not identify.
    mocks.runtime = { ctx: null, viewerId: null };

    renderChannel();
    await act(async () => {
      await Promise.resolve();
    });

    expect(mocks.subscribe).not.toHaveBeenCalled();
  });
});

describe("retry / discard", () => {
  const rows = [
    { clientId: "client-aaa", id: "server-zzz", channelId: CHANNEL },
    { clientId: "client-bbb", id: "server-yyy", channelId: CHANNEL },
  ];

  it("looks the row up by client_message_id, not by server id", async () => {
    // The port has no get-by-id, so the row is found through `listForChannel`.
    // Matching on the server id instead would miss every row that has not been
    // acknowledged yet — which is the entire population retry exists to serve.
    mocks.listForChannel.mockImplementation(async () => rows);

    const { result } = renderChannel();
    await waitFor(() => expect(result.current.canSend).toBe(true));

    await act(async () => {
      await result.current.retry("client-bbb");
    });

    expect(mocks.retryOutboxRow).toHaveBeenCalledTimes(1);
    expect(mocks.retryOutboxRow.mock.calls[0]?.[1]).toEqual(rows[1]);
  });

  it("discards by client_message_id too", async () => {
    mocks.listForChannel.mockImplementation(async () => rows);

    const { result } = renderChannel();
    await waitFor(() => expect(result.current.canSend).toBe(true));

    await act(async () => {
      await result.current.discard("client-aaa");
    });

    expect(mocks.discardOutboxRow).toHaveBeenCalledTimes(1);
    expect(mocks.discardOutboxRow.mock.calls[0]?.[1]).toEqual(rows[0]);
  });

  it("does nothing when the client id matches no queued row", async () => {
    mocks.listForChannel.mockImplementation(async () => rows);

    const { result } = renderChannel();
    await waitFor(() => expect(result.current.canSend).toBe(true));

    await act(async () => {
      await result.current.retry("client-not-here");
    });

    expect(mocks.retryOutboxRow).not.toHaveBeenCalled();
  });
});

describe("react()/unreact() failure surfacing (#999)", () => {
  // `reactAction`/`unreactAction` are mocked, so chat-core's own `onError` call
  // is not exercised here (that lives in chat-client.test.ts) — this proves the
  // hook wires a working `onError` into the ctx it hands chat-core, and that
  // invoking it lands in `reactionError`, which is the half only this hook owns.
  function captureOnErrorAt(mock: { mock: { calls: unknown[][] } }, index: number) {
    const call = index < 0 ? mock.mock.calls.at(index) : mock.mock.calls[index];
    const ctxArg = call?.[0] as
      | { onError?: (input: { title: string; description?: string }) => void }
      | undefined;
    return ctxArg?.onError;
  }

  function captureOnError(mock: { mock: { calls: unknown[][] } }) {
    return () => captureOnErrorAt(mock, -1);
  }

  it("starts null and reports a rejected react through onError", async () => {
    const { result } = renderChannel();
    await waitFor(() => expect(result.current.canSend).toBe(true));
    expect(result.current.reactionError).toBeNull();

    await act(async () => {
      await result.current.react("msg-1", "👍");
    });

    const onError = captureOnError(mocks.reactAction)();
    expect(onError).toBeTypeOf("function");
    act(() => onError!({ title: "Couldn't react", description: "Channel is read-only" }));

    expect(result.current.reactionError).toBe("Channel is read-only");
  });

  it("falls back to the title when onError carries no description", async () => {
    const { result } = renderChannel();
    await waitFor(() => expect(result.current.canSend).toBe(true));

    await act(async () => {
      await result.current.unreact("msg-1", "👍");
    });

    const onError = captureOnError(mocks.unreactAction)();
    act(() => onError!({ title: "Couldn't remove reaction" }));

    expect(result.current.reactionError).toBe("Couldn't remove reaction");
  });

  it("clears via clearReactionError", async () => {
    const { result } = renderChannel();
    await waitFor(() => expect(result.current.canSend).toBe(true));

    await act(async () => {
      await result.current.react("msg-1", "👍");
    });
    const onError = captureOnError(mocks.reactAction)();
    act(() => onError!({ title: "Couldn't react", description: "nope" }));
    expect(result.current.reactionError).toBe("nope");

    act(() => result.current.clearReactionError());

    expect(result.current.reactionError).toBeNull();
  });

  it("clears the previous error the moment a new reaction is dispatched", async () => {
    const { result } = renderChannel();
    await waitFor(() => expect(result.current.canSend).toBe(true));

    await act(async () => {
      await result.current.react("msg-1", "👍");
    });
    const firstOnError = captureOnError(mocks.reactAction)();
    act(() => firstOnError!({ title: "Couldn't react", description: "first" }));
    expect(result.current.reactionError).toBe("first");

    await act(async () => {
      await result.current.react("msg-2", "🎉");
    });

    expect(result.current.reactionError).toBeNull();
  });

  it("clears on a channel switch, so it never leaks onto the next thread", async () => {
    const queryClient = newQueryClient();
    const client = createClient();
    const { result, rerender } = renderHook(
      ({ channelId }: { channelId: string }) => useChatChannel(channelId),
      {
        initialProps: { channelId: CHANNEL },
        wrapper: createWrapper(client, queryClient),
      },
    );
    await waitFor(() => expect(result.current.canSend).toBe(true));

    await act(async () => {
      await result.current.react("msg-1", "👍");
    });
    const onError = captureOnError(mocks.reactAction)();
    act(() => onError!({ title: "Couldn't react", description: "nope" }));
    expect(result.current.reactionError).toBe("nope");

    rerender({ channelId: "channel-2" });

    expect(result.current.reactionError).toBeNull();
  });

  it("ignores a stale react/unreact rejection that resolves after a channel switch", async () => {
    // The regression this generation guard exists for: channel A's request is
    // still in flight when the member switches to channel B, then A's request
    // rejects. Its `onError` must not paint a banner about A onto B's screen.
    const queryClient = newQueryClient();
    const client = createClient();
    const { result, rerender } = renderHook(
      ({ channelId }: { channelId: string }) => useChatChannel(channelId),
      {
        initialProps: { channelId: CHANNEL },
        wrapper: createWrapper(client, queryClient),
      },
    );
    await waitFor(() => expect(result.current.canSend).toBe(true));

    await act(async () => {
      await result.current.react("msg-1", "👍");
    });
    const staleOnError = captureOnErrorAt(mocks.reactAction, -1);

    rerender({ channelId: "channel-2" });
    expect(result.current.reactionError).toBeNull();

    // Channel A's request finally settles, after the switch.
    act(() => staleOnError!({ title: "Couldn't react", description: "too late" }));

    expect(result.current.reactionError).toBeNull();
  });

  it("ignores a stale rejection superseded by a later reaction on the same channel", async () => {
    // Companion regression: message 1's slow request rejects after message 2's
    // faster one already succeeded (or is itself pending) — the stale failure
    // must not overwrite state a newer action already owns.
    const { result } = renderChannel();
    await waitFor(() => expect(result.current.canSend).toBe(true));

    await act(async () => {
      await result.current.react("msg-1", "👍");
    });
    const staleOnError = captureOnErrorAt(mocks.reactAction, -1);

    await act(async () => {
      await result.current.react("msg-2", "🎉");
    });
    expect(result.current.reactionError).toBeNull();

    // msg-1's request finally settles, after msg-2 already superseded it.
    act(() => staleOnError!({ title: "Couldn't react", description: "too late" }));

    expect(result.current.reactionError).toBeNull();
  });
});

describe("act() failure surfacing (#528/#999)", () => {
  // Mirrors the react()/unreact() suite above — `actWithErrorSink` is the
  // same generation-guarded pattern, kept as its own `actionError` state
  // (see the field doc in use-chat-channel.ts) so a failed vote can't
  // dismiss a failed reaction or vice versa.
  function captureOnError(mock: { mock: { calls: unknown[][] } }) {
    const call = mock.mock.calls.at(-1);
    const ctxArg = call?.[0] as
      | { onError?: (input: { title: string; description?: string }) => void }
      | undefined;
    return ctxArg?.onError;
  }

  it("dispatches through actOnCard with the given args, and starts actionError null", async () => {
    const { result } = renderChannel();
    await waitFor(() => expect(result.current.canSend).toBe(true));
    expect(result.current.actionError).toBeNull();

    await act(async () => {
      await result.current.act("msg-1", "vote", { option_id: "opt-1" });
    });

    expect(mocks.actOnCard).toHaveBeenCalledTimes(1);
    expect(mocks.actOnCard.mock.calls[0]?.[1]).toEqual({
      channelId: CHANNEL,
      messageId: "msg-1",
      actionType: "vote",
      payload: { option_id: "opt-1" },
    });
    expect(result.current.actionError).toBeNull();
  });

  it("reports a rejected action through onError into actionError, independent of reactionError", async () => {
    const { result } = renderChannel();
    await waitFor(() => expect(result.current.canSend).toBe(true));

    await act(async () => {
      await result.current.act("msg-1", "vote", { option_id: "opt-1" });
    });

    const onError = captureOnError(mocks.actOnCard);
    act(() => onError!({ title: "Couldn't record action", description: "Poll is closed" }));

    expect(result.current.actionError).toBe("Poll is closed");
    expect(result.current.reactionError).toBeNull();
  });

  it("clears via clearActionError", async () => {
    const { result } = renderChannel();
    await waitFor(() => expect(result.current.canSend).toBe(true));

    await act(async () => {
      await result.current.act("msg-1", "vote", { option_id: "opt-1" });
    });
    const onError = captureOnError(mocks.actOnCard);
    act(() => onError!({ title: "Couldn't record action", description: "nope" }));
    expect(result.current.actionError).toBe("nope");

    act(() => result.current.clearActionError());

    expect(result.current.actionError).toBeNull();
  });

  it("clears on a channel switch, so it never leaks onto the next thread", async () => {
    const queryClient = newQueryClient();
    const client = createClient();
    const { result, rerender } = renderHook(
      ({ channelId }: { channelId: string }) => useChatChannel(channelId),
      {
        initialProps: { channelId: CHANNEL },
        wrapper: createWrapper(client, queryClient),
      },
    );
    await waitFor(() => expect(result.current.canSend).toBe(true));

    await act(async () => {
      await result.current.act("msg-1", "vote", { option_id: "opt-1" });
    });
    const onError = captureOnError(mocks.actOnCard);
    act(() => onError!({ title: "Couldn't record action", description: "nope" }));
    expect(result.current.actionError).toBe("nope");

    rerender({ channelId: "channel-2" });

    expect(result.current.actionError).toBeNull();
  });

  it("ignores a stale action rejection that resolves after a channel switch", async () => {
    const queryClient = newQueryClient();
    const client = createClient();
    const { result, rerender } = renderHook(
      ({ channelId }: { channelId: string }) => useChatChannel(channelId),
      {
        initialProps: { channelId: CHANNEL },
        wrapper: createWrapper(client, queryClient),
      },
    );
    await waitFor(() => expect(result.current.canSend).toBe(true));

    await act(async () => {
      await result.current.act("msg-1", "vote", { option_id: "opt-1" });
    });
    const staleOnError = captureOnError(mocks.actOnCard);

    rerender({ channelId: "channel-2" });
    expect(result.current.actionError).toBeNull();

    act(() => staleOnError!({ title: "Couldn't record action", description: "too late" }));

    expect(result.current.actionError).toBeNull();
  });
});
