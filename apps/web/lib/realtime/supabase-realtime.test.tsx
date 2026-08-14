import { beforeEach, describe, expect, test, vi } from "vitest";
import { createElement, type ReactNode } from "react";
import { act, renderHook } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { RealtimeChannel, SupabaseClient } from "@supabase/supabase-js";

/**
 * Regression cover for #817: `attachRealtimeChannel` re-attaching on a topic it
 * has not actually freed yet.
 *
 * The fake below is the one from `lib/chat/realtime-manager.test.ts` — the same
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
}

function makeFakeChannel(topic: string, onTeardown: () => void): FakeChannel {
  const channel: FakeChannel = {
    topic: `realtime:${topic}`,
    state: "closed",
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
    channel: vi.fn((topic: string) => {
      const existing = registry.get(topic);
      if (existing) return existing;
      const channel = makeFakeChannel(topic, () => {
        if (registry.get(topic) === channel) registry.delete(topic);
      });
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

  test("a changed invalidate key with a stable topic does not throw", async () => {
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    const wrapper = ({ children }: { children: ReactNode }) =>
      createElement(QueryClientProvider, { client: queryClient }, children);

    // `attendance-panel.tsx` shape: the topic is derived from `eventId` alone,
    // but `invalidate` also carries `chapterId` — so a chapter switch re-runs
    // the effect with an unchanged topic.
    const { rerender, unmount } = renderHook(
      ({ chapterId }: { chapterId: string }) =>
        useRealtimeTable({
          table: "event_attendance",
          filter: "event_id=eq.evt-1",
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

    expect(created).toHaveLength(2);
    expect(created[1]).not.toBe(created[0]);
    expect(created[1]!.subscribe).toHaveBeenCalledTimes(1);
    expect(warn).not.toHaveBeenCalled();

    unmount();
    await flush();
    expect(created[1]!.teardown).toHaveBeenCalledTimes(1);
  });
});
