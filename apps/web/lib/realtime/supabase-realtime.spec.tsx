import { beforeEach, describe, expect, test, vi } from "vitest";
import { createElement, type ReactNode } from "react";
import { act, renderHook } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { RealtimeChannel, SupabaseClient } from "@supabase/supabase-js";

/**
 * Regression cover for #817: `attachRealtimeChannel` re-attaching on a topic it
 * has not actually freed yet.
 *
 * The fake below is the one from
 * `packages/chat-core/src/realtime-manager.spec.ts` — the same
 * two library behaviours #783 turned on, which is what makes the bug
 * observable at all:
 *
 *   - `channel(topic)` hands back the **live** instance for a topic that is
 *     still registered, rather than minting a fresh one; and
 *   - `on("postgres_changes", …)` **throws** once the channel is `joined` or
 *     `joining`, and only `teardown()` unregisters it.
 *
 * Without both, a suite can pass while the code recreates channels unsafely.
 */

/** Mirrors `CHANNEL_STATES` in @supabase/realtime-js. */
type FakeChannelState = "closed" | "errored" | "joined" | "joining" | "leaving";

interface FakeChannel {
  on: ReturnType<typeof vi.fn>;
  subscribe: ReturnType<typeof vi.fn>;
  // Intersected with their call signatures so the fake `removeChannel` below
  // can invoke them — `ReturnType<typeof vi.fn>` alone is not callable.
  unsubscribe: ReturnType<typeof vi.fn> & (() => Promise<string>);
  teardown: ReturnType<typeof vi.fn> & (() => void);
  /** Prefixed `realtime:` exactly as the real client does. */
  topic: string;
  state: FakeChannelState;
  /** The `config` the channel was minted with, so private-ness is assertable. */
  config: { private?: boolean } | undefined;
}

function makeFakeChannel(
  topic: string,
  onTeardown: () => void,
  config?: { private?: boolean },
): FakeChannel {
  const channel: FakeChannel = {
    topic: `realtime:${topic}`,
    state: "closed",
    config,
    on: vi.fn((type: string) => {
      if (
        type === "postgres_changes" &&
        (channel.state === "joined" || channel.state === "joining")
      ) {
        throw new Error(
          `cannot add \`${type}\` callbacks for ${channel.topic} after \`subscribe()\`.`,
        );
      }
      return channel;
    }),
    subscribe: vi.fn(() => {
      channel.state = "joining";
      return channel;
    }),
    unsubscribe: vi.fn(async () => {
      channel.state = "leaving";
      return "ok";
    }),
    // Only teardown unregisters the channel — same as the real client.
    teardown: vi.fn(() => {
      channel.state = "closed";
      onTeardown();
    }),
  };
  return channel;
}

function makeFakeSupabase(): {
  supabase: SupabaseClient;
  /** Every channel ever minted, in creation order, including superseded ones. */
  created: FakeChannel[];
} {
  const created: FakeChannel[] = [];
  /** Live registry, mirroring `RealtimeClient.channels`. */
  const registry = new Map<string, FakeChannel>();
  const supabase = {
    channel: vi.fn((topic: string, opts?: { config?: { private?: boolean } }) => {
      const existing = registry.get(topic);
      if (existing) return existing;
      const channel = makeFakeChannel(
        topic,
        () => {
          if (registry.get(topic) === channel) registry.delete(topic);
        },
        opts?.config,
      );
      registry.set(topic, channel);
      created.push(channel);
      return channel;
    }),
    getChannels: vi.fn(() => [...registry.values()]),
    removeChannel: vi.fn(async (channel: FakeChannel) => {
      const status = await channel.unsubscribe();
      if (status === "ok") channel.teardown();
      return status;
    }),
  } as unknown as SupabaseClient;
  return { supabase, created };
}

const mocks = vi.hoisted(() => ({ supabase: null as SupabaseClient | null }));

vi.mock("@/lib/supabase/client", () => ({
  createSupabaseBrowserClient: () => mocks.supabase,
}));

/** Drain the microtask queue so the topic queue settles. */
async function flush(): Promise<void> {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

/** The `postgres_changes` registration `useRealtimeTable` performs. */
function configure(channel: RealtimeChannel): RealtimeChannel {
  return channel.on(
    "postgres_changes" as never,
    { event: "*", schema: "public", table: "event_attendance" } as never,
    () => {},
  );
}

describe("attachRealtimeChannel — topic reuse (#817)", () => {
  let created: FakeChannel[];
  let attachRealtimeChannel: typeof import("./supabase-realtime").attachRealtimeChannel;
  let warn: ReturnType<typeof vi.spyOn>;

  beforeEach(async () => {
    // The client is cached at module scope, so each test needs a fresh module.
    vi.resetModules();
    // `vi.spyOn` hands back the *existing* spy for an already-spied method, so
    // without this the warn assertions below inherit the previous test's calls.
    vi.restoreAllMocks();
    const fake = makeFakeSupabase();
    mocks.supabase = fake.supabase;
    created = fake.created;
    warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    ({ attachRealtimeChannel } = await import("./supabase-realtime"));
  });

  test("a cleanup followed by an immediate re-attach mints a fresh channel", async () => {
    const detach = attachRealtimeChannel("event_attendance:all", configure);
    await flush();
    expect(created).toHaveLength(1);
    expect(created[0]!.subscribe).toHaveBeenCalledTimes(1);

    // The collision: cleanup and re-attach in the same tick, unchanged topic.
    detach();
    attachRealtimeChannel("event_attendance:all", configure);
    await flush();

    expect(created).toHaveLength(2);
    expect(created[1]).not.toBe(created[0]);
    expect(created[0]!.teardown).toHaveBeenCalledTimes(1);
    expect(created[1]!.subscribe).toHaveBeenCalledTimes(1);
    // Before the fix, `configure()` threw here on the reused instance.
    expect(warn).not.toHaveBeenCalled();
  });

  test("a re-attach with no await in between still frees the topic first", async () => {
    // React StrictMode's dev mount → cleanup → remount, which never yields.
    const detach = attachRealtimeChannel("event_attendance:all", configure);
    detach();
    attachRealtimeChannel("event_attendance:all", configure);
    await flush();

    const live = created.filter((channel) => channel.state === "joining");
    expect(live).toHaveLength(1);
    expect(warn).not.toHaveBeenCalled();
  });

  test("a queued cleanup never tears down its successor's channel", async () => {
    const detach = attachRealtimeChannel("event_attendance:all", configure);
    await flush();
    detach();
    attachRealtimeChannel("event_attendance:all", configure);
    await flush();

    // The whole point of serializing per topic: the first cleanup's release
    // must not iterate the registry after the successor has registered.
    const successor = created[1]!;
    expect(successor.teardown).not.toHaveBeenCalled();
    expect(successor.state).toBe("joining");
  });

  test("a configure() that throws is contained and never reaches the caller", async () => {
    let detach: (() => void) | undefined;
    expect(() => {
      detach = attachRealtimeChannel("event_attendance:all", () => {
        throw new Error("boom");
      });
    }).not.toThrow();
    await flush();

    expect(() => detach?.()).not.toThrow();
    await flush();
    expect(warn).toHaveBeenCalled();

    // `client.channel(topic)` registers before `configure` is called, so the
    // cleanup still has to free the topic — otherwise it stays occupied by a
    // channel no caller holds a reference to.
    expect(created).toHaveLength(1);
    expect(created[0]!.teardown).toHaveBeenCalledTimes(1);
  });

  test("unrelated topics are freed independently", async () => {
    const detachA = attachRealtimeChannel("events:all", configure);
    attachRealtimeChannel("notifications:all", configure);
    await flush();
    expect(created).toHaveLength(2);

    detachA();
    await flush();

    const notifications = created.find(
      (channel) => channel.topic === "realtime:notifications:all",
    )!;
    expect(notifications.teardown).not.toHaveBeenCalled();
    expect(notifications.state).toBe("joining");
  });
});

describe("useRealtimeTable — effect re-run on an unchanged topic (#817)", () => {
  let created: FakeChannel[];
  let useRealtimeTable: typeof import("./use-realtime-table").useRealtimeTable;
  let warn: ReturnType<typeof vi.spyOn>;

  beforeEach(async () => {
    vi.resetModules();
    // See the note in the sibling suite: a re-spied method keeps its calls.
    vi.restoreAllMocks();
    const fake = makeFakeSupabase();
    mocks.supabase = fake.supabase;
    created = fake.created;
    warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    ({ useRealtimeTable } = await import("./use-realtime-table"));
  });

  test("a changed invalidate key does NOT resubscribe (broadcast has no replay)", async () => {
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    const wrapper = ({ children }: { children: ReactNode }) =>
      createElement(QueryClientProvider, { client: queryClient }, children);

    // `attendance-panel.tsx` shape: the topic is derived from `eventId` alone,
    // but `invalidate` also carries `chapterId`, so a chapter switch changes the
    // array without changing the topic.
    //
    // The channel must SURVIVE that. Broadcast is fire-and-forget with no
    // replay, so a detach/re-attach drops any ping landing inside the cycle
    // permanently — and the REST poll never covers it, since it only arms after
    // >10s non-live and a clean resubscribe never goes non-live. The keys are
    // read through a ref that is reassigned every render, so nothing is stale.
    const { rerender, unmount } = renderHook(
      ({ chapterId }: { chapterId: string }) =>
        useRealtimeTable({
          table: "event_attendance",
          scopeId: "evt-1",
          invalidate: [
            ["attendance", "evt-1"],
            ["events", chapterId, "evt-1"],
          ],
        }),
      { wrapper, initialProps: { chapterId: "chapter-a" } },
    );
    await flush();
    expect(created).toHaveLength(1);

    rerender({ chapterId: "chapter-b" });
    await flush();

    // Still exactly one channel, still the original instance, never torn down.
    expect(created).toHaveLength(1);
    expect(created[0]!.teardown).not.toHaveBeenCalled();
    expect(created[0]!.subscribe).toHaveBeenCalledTimes(1);
    expect(warn).not.toHaveBeenCalled();

    unmount();
    await flush();
    expect(created[0]!.teardown).toHaveBeenCalledTimes(1);
  });

  test("the handler invalidates the CURRENT keys after a rerender, not the ones it closed over", async () => {
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    const invalidateSpy = vi.spyOn(queryClient, "invalidateQueries");
    const wrapper = ({ children }: { children: ReactNode }) =>
      createElement(QueryClientProvider, { client: queryClient }, children);

    // The other half of dropping `invalidateKey` from the deps: because the
    // channel is no longer re-minted, the ref is the ONLY thing keeping the
    // handler current. If it ever stopped being reassigned per render, this
    // test is what catches it.
    const { rerender } = renderHook(
      ({ chapterId }: { chapterId: string }) =>
        useRealtimeTable({
          table: "event_attendance",
          scopeId: "evt-1",
          invalidate: [["events", chapterId, "evt-1"]],
        }),
      { wrapper, initialProps: { chapterId: "chapter-a" } },
    );
    await flush();
    rerender({ chapterId: "chapter-b" });
    await flush();

    // Fire the broadcast handler the live channel registered.
    const handler = created[0]!.on.mock.calls.find(
      (call) => call[0] === "broadcast",
    )?.[2] as (() => void) | undefined;
    expect(handler).toBeTypeOf("function");
    invalidateSpy.mockClear();
    handler!();

    expect(invalidateSpy).toHaveBeenCalledWith({
      queryKey: ["events", "chapter-b", "evt-1"],
    });
  });

  test("subscribes on the scoped topic as a PRIVATE channel", async () => {
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    const wrapper = ({ children }: { children: ReactNode }) =>
      createElement(QueryClientProvider, { client: queryClient }, children);

    renderHook(
      () =>
        useRealtimeTable({
          table: "notifications",
          scopeId: "user-1",
          invalidate: [["notifications"]],
        }),
      { wrapper },
    );
    await flush();

    expect(created).toHaveLength(1);
    // The topic half of the contract in `change-topics.ts`.
    expect(created[0]!.topic).toBe("realtime:notif:user-1");
    // `private` is a security control here, not a tuning knob: a public channel
    // on this topic would hand every ping to anyone who guessed the string,
    // because public channels bypass `realtime.messages` RLS entirely.
    expect(created[0]!.config?.private).toBe(true);
    expect(warn).not.toHaveBeenCalled();
  });

  test("does not subscribe at all while the scope id is undefined", async () => {
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    const wrapper = ({ children }: { children: ReactNode }) =>
      createElement(QueryClientProvider, { client: queryClient }, children);

    // `frappUser.userId` is undefined on first render. Attaching anyway would
    // mint the topic `notif:undefined`, which every signed-out tab would share.
    renderHook(
      () =>
        useRealtimeTable({
          table: "notifications",
          scopeId: undefined,
          invalidate: [["notifications"]],
        }),
      { wrapper },
    );
    await flush();

    expect(created).toHaveLength(0);
  });
});

/**
 * `onSubscribed` exists because a caller cannot reach the joined moment on its
 * own: the channel is minted inside the topic queue (a microtask), so code
 * after `attachRealtimeChannel(...)` returns still sees nothing, and `configure`
 * runs before the join, where a push throws. Chapter presence needs exactly
 * this seam — `track()` is only meaningful once joined, and must be re-sent on
 * every reconnect or the member silently vanishes from the presence map.
 */
describe("attachRealtimeChannel — onSubscribed", () => {
  let created: FakeChannel[];
  let attachRealtimeChannel: typeof import("./supabase-realtime").attachRealtimeChannel;
  let warn: ReturnType<typeof vi.spyOn>;

  beforeEach(async () => {
    vi.resetModules();
    vi.restoreAllMocks();
    const fake = makeFakeSupabase();
    mocks.supabase = fake.supabase;
    created = fake.created;
    warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    ({ attachRealtimeChannel } = await import("./supabase-realtime"));
  });

  /** The status callback the helper hands to `subscribe()`. */
  function statusCallback(channel: FakeChannel): (status: string) => void {
    return channel.subscribe.mock.calls[0]![0] as (status: string) => void;
  }

  test("is not called before the channel reaches SUBSCRIBED", async () => {
    const onSubscribed = vi.fn();
    attachRealtimeChannel("presence:chapter:x", (c) => c, { onSubscribed });
    await flush();

    expect(created).toHaveLength(1);
    expect(onSubscribed).not.toHaveBeenCalled();
  });

  test("fires with the channel on SUBSCRIBED, and again on every re-join", async () => {
    const onSubscribed = vi.fn();
    attachRealtimeChannel("presence:chapter:x", (c) => c, { onSubscribed });
    await flush();
    const notify = statusCallback(created[0]!);

    notify("SUBSCRIBED");
    expect(onSubscribed).toHaveBeenCalledTimes(1);
    expect(onSubscribed.mock.calls[0]![0]).toBe(created[0]);

    // A reconnect re-runs the same callback — this is what re-publishes
    // presence after a drop.
    notify("SUBSCRIBED");
    expect(onSubscribed).toHaveBeenCalledTimes(2);
  });

  test("is not called for an error status, and the error is still warned", async () => {
    const onSubscribed = vi.fn();
    attachRealtimeChannel("presence:chapter:x", (c) => c, { onSubscribed });
    await flush();

    statusCallback(created[0]!)("CHANNEL_ERROR");

    expect(onSubscribed).not.toHaveBeenCalled();
    expect(warn).toHaveBeenCalled();
  });

  /**
   * The callback runs inside a library callback, where a throw has no owner and
   * would surface mid-commit — the shape that unmounted the shell in #783.
   */
  test("a throwing callback is contained, not propagated", async () => {
    attachRealtimeChannel("presence:chapter:x", (c) => c, {
      onSubscribed: () => {
        throw new Error("boom");
      },
    });
    await flush();

    expect(() => statusCallback(created[0]!)("SUBSCRIBED")).not.toThrow();
    expect(warn).toHaveBeenCalled();
  });

  test("attaching without the option still subscribes normally", async () => {
    attachRealtimeChannel("presence:chapter:x", (c) => c);
    await flush();

    expect(() => statusCallback(created[0]!)("SUBSCRIBED")).not.toThrow();
  });
});

/**
 * `onDisconnected` is `onSubscribed`'s counterpart. The silent version of this
 * is the dangerous one: a dropped channel that never re-joins looks exactly
 * like a quiet one, so a subscriber holding state read off the channel would
 * keep rendering the last thing it saw as fact.
 */
describe("attachRealtimeChannel — onDisconnected", () => {
  let created: FakeChannel[];
  let attachRealtimeChannel: typeof import("./supabase-realtime").attachRealtimeChannel;
  let warn: ReturnType<typeof vi.spyOn>;

  beforeEach(async () => {
    vi.resetModules();
    vi.restoreAllMocks();
    const fake = makeFakeSupabase();
    mocks.supabase = fake.supabase;
    created = fake.created;
    warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    ({ attachRealtimeChannel } = await import("./supabase-realtime"));
  });

  function statusCallback(channel: FakeChannel): (status: string) => void {
    return channel.subscribe.mock.calls[0]![0] as (status: string) => void;
  }

  test.each(["CHANNEL_ERROR", "TIMED_OUT", "CLOSED"])(
    "fires on %s",
    async (status) => {
      const onDisconnected = vi.fn();
      attachRealtimeChannel("presence:chapter:x", (c) => c, { onDisconnected });
      await flush();

      statusCallback(created[0]!)(status);

      expect(onDisconnected).toHaveBeenCalledWith(status);
    },
  );

  test("does not fire on SUBSCRIBED", async () => {
    const onDisconnected = vi.fn();
    attachRealtimeChannel("presence:chapter:x", (c) => c, { onDisconnected });
    await flush();

    statusCallback(created[0]!)("SUBSCRIBED");

    expect(onDisconnected).not.toHaveBeenCalled();
  });

  /**
   * CLOSED is the ordinary end of a teardown, so it notifies without the noise
   * — unlike the two genuine failures, which still warn.
   */
  test("CLOSED notifies without warning; a failure both notifies and warns", async () => {
    const onDisconnected = vi.fn();
    attachRealtimeChannel("presence:chapter:x", (c) => c, { onDisconnected });
    await flush();
    const notify = statusCallback(created[0]!);

    notify("CLOSED");
    expect(warn).not.toHaveBeenCalled();

    notify("CHANNEL_ERROR");
    expect(warn).toHaveBeenCalled();
  });

  test("a throwing callback is contained, not propagated", async () => {
    attachRealtimeChannel("presence:chapter:x", (c) => c, {
      onDisconnected: () => {
        throw new Error("boom");
      },
    });
    await flush();

    expect(() => statusCallback(created[0]!)("CHANNEL_ERROR")).not.toThrow();
  });
});
