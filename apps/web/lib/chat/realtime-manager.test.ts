import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { QueryClient } from "@tanstack/react-query";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  chatRealtime,
  POLL_DEGRADE_AFTER_MS,
  POLL_INTERVAL_MS,
  type BackfillFetcher,
  type ConnectionStatus,
} from "./realtime-manager";
import {
  chatMessagesKey,
  type ChannelCache,
  type RawChatMessage,
} from "./types";

type SubscribeStatus =
  | "SUBSCRIBED"
  | "CHANNEL_ERROR"
  | "TIMED_OUT"
  | "CLOSED";

/** Mirrors `CHANNEL_STATES` in @supabase/realtime-js. */
type FakeChannelState = "closed" | "errored" | "joined" | "joining" | "leaving";

interface FakeChannel {
  on: ReturnType<typeof vi.fn>;
  subscribe: ReturnType<typeof vi.fn>;
  send: ReturnType<typeof vi.fn>;
  unsubscribe: ReturnType<typeof vi.fn>;
  teardown: ReturnType<typeof vi.fn>;
  track: ReturnType<typeof vi.fn>;
  /** Prefixed `realtime:` exactly as the real client does. */
  topic: string;
  state: FakeChannelState;
  trigger: (status: SubscribeStatus) => void;
}

/**
 * A fake that reproduces the two library behaviours #783 turns on:
 *
 *   - `on("postgres_changes" | "presence", …)` throws once the channel is
 *     `joined` or `joining` (`RealtimeChannel.on`); and
 *   - `subscribe()` moves it to `joining` immediately.
 *
 * The previous fake accepted `on()` unconditionally, which is why a suite of
 * ten tests never noticed the manager was recreating channels unsafely.
 */
function makeFakeChannel(topic: string, onTeardown: () => void): FakeChannel {
  let captured: ((status: SubscribeStatus) => void) | null = null;
  const channel: FakeChannel = {
    topic: `realtime:${topic}`,
    state: "closed",
    on: vi.fn((type: string) => {
      if (
        (type === "postgres_changes" || type === "presence") &&
        (channel.state === "joined" || channel.state === "joining")
      ) {
        throw new Error(
          `cannot add \`${type}\` callbacks for ${channel.topic} after \`subscribe()\`.`,
        );
      }
      return channel;
    }),
    subscribe: vi.fn((cb?: (status: SubscribeStatus) => void) => {
      if (cb) captured = cb;
      channel.state = "joining";
      return channel;
    }),
    send: vi.fn(),
    track: vi.fn(),
    unsubscribe: vi.fn(async () => {
      channel.state = "leaving";
      return "ok";
    }),
    // Only teardown unregisters the channel — same as the real client.
    teardown: vi.fn(() => {
      channel.state = "closed";
      onTeardown();
    }),
    trigger: (status) => {
      if (!captured) throw new Error("subscribe callback not captured");
      channel.state = status === "SUBSCRIBED" ? "joined" : "errored";
      captured(status);
    },
  };
  return channel;
}

/**
 * A fake Supabase client with a real channel registry: `channel(topic)` hands
 * back the live instance for an already-registered topic instead of minting a
 * fresh one (`RealtimeClient.channel`).
 */
function makeFakeSupabase(): {
  supabase: SupabaseClient;
  /** Newest channel created per bare topic, including superseded ones. */
  channels: Map<string, FakeChannel>;
  registry: Map<string, FakeChannel>;
  created: () => number;
} {
  const channels = new Map<string, FakeChannel>();
  const registry = new Map<string, FakeChannel>();
  let created = 0;
  const supabase = {
    channel: vi.fn((topic: string) => {
      const existing = registry.get(topic);
      if (existing) return existing;
      created += 1;
      const ch = makeFakeChannel(topic, () => {
        if (registry.get(topic) === ch) registry.delete(topic);
      });
      registry.set(topic, ch);
      channels.set(topic, ch);
      return ch;
    }),
    getChannels: vi.fn(() => [...registry.values()]),
    removeChannel: vi.fn(async (ch: FakeChannel) => {
      const status = await ch.unsubscribe();
      if (status === "ok") ch.teardown();
      return status;
    }),
  } as unknown as SupabaseClient;
  return { supabase, channels, registry, created: () => created };
}

describe("ChatRealtimeManager — subscribe-then-backfill gate", () => {
  let backfill: ReturnType<typeof vi.fn> & BackfillFetcher;
  let queryClient: QueryClient;
  let channels: Map<string, FakeChannel>;
  let supabase: SupabaseClient;

  beforeEach(() => {
    channels = new Map();
    backfill = vi.fn(async (): Promise<RawChatMessage[]> => []) as ReturnType<
      typeof vi.fn
    > &
      BackfillFetcher;
    queryClient = new QueryClient();
    ({ supabase, channels } = makeFakeSupabase());

    chatRealtime.configure({
      queryClient,
      supabase,
      backfill,
    });
  });

  afterEach(() => {
    chatRealtime.destroy();
    queryClient.clear();
  });

  test("subscribe() does not fire backfill until SUBSCRIBED is received", async () => {
    chatRealtime.subscribe("channel-1");

    // No synchronous backfill on subscribe.
    expect(backfill).not.toHaveBeenCalled();

    // Flush microtasks — still no backfill before SUBSCRIBED arrives.
    await Promise.resolve();
    await Promise.resolve();
    expect(backfill).not.toHaveBeenCalled();

    // SUBSCRIBED callback is the gate.
    const ch = channels.get("chat:channel:channel-1");
    expect(ch).toBeDefined();
    ch!.trigger("SUBSCRIBED");

    expect(backfill).toHaveBeenCalledTimes(1);
    expect(backfill).toHaveBeenLastCalledWith("channel-1", null);
  });

  test("a subsequent SUBSCRIBED (simulating reconnect) fires backfill again with the advanced cursor", async () => {
    const newest: RawChatMessage = {
      id: "msg-newest",
      channel_id: "channel-1",
      sender_id: "user-1",
      created_at: "2026-01-01T00:00:00.000Z",
      client_message_id: "client-newest",
    };
    backfill.mockResolvedValueOnce([newest]);

    chatRealtime.subscribe("channel-1");
    const ch = channels.get("chat:channel:channel-1");
    expect(ch).toBeDefined();

    ch!.trigger("SUBSCRIBED");
    expect(backfill).toHaveBeenCalledTimes(1);
    expect(backfill).toHaveBeenLastCalledWith("channel-1", null);

    // Let the first backfill resolve and persist its last-seen cursor.
    await vi.waitFor(() =>
      expect(window.localStorage.getItem("chat:lastSeen:channel-1")).toBe(
        "msg-newest",
      ),
    );

    backfill.mockResolvedValueOnce([]);
    ch!.trigger("SUBSCRIBED");

    expect(backfill).toHaveBeenCalledTimes(2);
    expect(backfill).toHaveBeenLastCalledWith("channel-1", "msg-newest");
  });
});

describe("ChatRealtimeManager — polling fallback (spec/ui/resilience.md §3.2)", () => {
  let backfill: ReturnType<typeof vi.fn> & BackfillFetcher;
  let queryClient: QueryClient;
  let channels: Map<string, FakeChannel>;
  let supabase: SupabaseClient;
  let status: ConnectionStatus;
  let unsubStatus: () => void;

  beforeEach(() => {
    vi.useFakeTimers();
    window.localStorage.clear();
    channels = new Map();
    backfill = vi.fn(async (): Promise<RawChatMessage[]> => []) as ReturnType<
      typeof vi.fn
    > &
      BackfillFetcher;
    queryClient = new QueryClient();
    ({ supabase, channels } = makeFakeSupabase());

    chatRealtime.configure({ queryClient, supabase, backfill });
    status = "live";
    unsubStatus = chatRealtime.subscribeStatus((s) => {
      status = s;
    });
  });

  afterEach(() => {
    unsubStatus();
    chatRealtime.destroy();
    queryClient.clear();
    window.localStorage.clear();
    vi.useRealTimers();
  });

  /** The live channel for a topic — `openChannel` replaces it on every retry. */
  function current(channelId: string): FakeChannel {
    const ch = channels.get(`chat:channel:${channelId}`);
    if (!ch) throw new Error(`no fake channel for ${channelId}`);
    return ch;
  }

  test("a disconnect longer than the degrade window starts polling at the spec'd cadence", async () => {
    chatRealtime.subscribe("channel-1");
    current("channel-1").trigger("CHANNEL_ERROR");
    expect(status).toBe("reconnecting");

    // Just inside the window: still only reconnecting, no REST traffic.
    await vi.advanceTimersByTimeAsync(POLL_DEGRADE_AFTER_MS - 1);
    expect(status).toBe("reconnecting");
    expect(backfill).not.toHaveBeenCalled();

    // Crossing it degrades to polling and polls immediately.
    await vi.advanceTimersByTimeAsync(1);
    expect(status).toBe("polling");
    expect(backfill).toHaveBeenCalledTimes(1);
    expect(backfill).toHaveBeenLastCalledWith("channel-1", null);

    // ...then once per interval for as long as Realtime stays down.
    await vi.advanceTimersByTimeAsync(POLL_INTERVAL_MS);
    expect(backfill).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(POLL_INTERVAL_MS);
    expect(backfill).toHaveBeenCalledTimes(3);
    expect(status).toBe("polling");
  });

  test("a reconnect inside the degrade window never starts polling", async () => {
    chatRealtime.subscribe("channel-1");
    current("channel-1").trigger("CHANNEL_ERROR");

    await vi.advanceTimersByTimeAsync(POLL_DEGRADE_AFTER_MS / 2);
    current("channel-1").trigger("SUBSCRIBED");
    expect(status).toBe("live");

    // One backfill from the SUBSCRIBED gate, and nothing from a poll loop
    // that was disarmed before it could fire.
    expect(backfill).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(POLL_DEGRADE_AFTER_MS * 3);
    expect(backfill).toHaveBeenCalledTimes(1);
    expect(status).toBe("live");
  });

  test("polled messages land in the cache and do not duplicate when Realtime returns", async () => {
    const row: RawChatMessage = {
      id: "msg-1",
      channel_id: "channel-1",
      sender_id: "user-1",
      created_at: "2026-01-01T00:00:00.000Z",
      client_message_id: "client-1",
    };
    // Every fetch — polled or post-reconnect — replays the same row.
    backfill.mockResolvedValue([row]);

    chatRealtime.subscribe("channel-1");
    current("channel-1").trigger("CHANNEL_ERROR");
    await vi.advanceTimersByTimeAsync(POLL_DEGRADE_AFTER_MS);
    expect(status).toBe("polling");

    // Poll it in twice, then let the reconnect backfill deliver it a third time.
    await vi.advanceTimersByTimeAsync(POLL_INTERVAL_MS);
    current("channel-1").trigger("SUBSCRIBED");
    await vi.advanceTimersByTimeAsync(0);

    const cache = queryClient.getQueryData<ChannelCache>(
      chatMessagesKey("channel-1"),
    );
    // Three deliveries of one row collapse to a single entry, keyed by the
    // server id (`mergeServerRow` → `byId[serverKey]`), not repeated three times.
    expect(cache).toBeDefined();
    expect(cache!.order).toEqual(["msg-1"]);
    expect(Object.keys(cache!.byId)).toHaveLength(1);
    expect(backfill.mock.calls.length).toBeGreaterThanOrEqual(3);
  });

  test("polling stops once Realtime reconnects", async () => {
    chatRealtime.subscribe("channel-1");
    current("channel-1").trigger("CHANNEL_ERROR");
    await vi.advanceTimersByTimeAsync(POLL_DEGRADE_AFTER_MS);
    expect(status).toBe("polling");

    current("channel-1").trigger("SUBSCRIBED");
    expect(status).toBe("live");

    const afterReconnect = backfill.mock.calls.length;
    await vi.advanceTimersByTimeAsync(POLL_INTERVAL_MS * 4);
    expect(backfill).toHaveBeenCalledTimes(afterReconnect);
  });

  test("going offline suspends polling, and coming back re-arms it", async () => {
    chatRealtime.subscribe("channel-1");
    current("channel-1").trigger("CHANNEL_ERROR");
    await vi.advanceTimersByTimeAsync(POLL_DEGRADE_AFTER_MS);
    expect(status).toBe("polling");
    const beforeOffline = backfill.mock.calls.length;

    window.dispatchEvent(new Event("offline"));
    expect(status).toBe("offline");

    // No REST attempts while the browser reports no network.
    await vi.advanceTimersByTimeAsync(POLL_INTERVAL_MS * 4);
    expect(backfill).toHaveBeenCalledTimes(beforeOffline);

    // Back online: channels reopen, and a still-dead Realtime degrades again.
    window.dispatchEvent(new Event("online"));
    expect(status).toBe("reconnecting");
    await vi.advanceTimersByTimeAsync(POLL_DEGRADE_AFTER_MS);
    expect(status).toBe("polling");
    expect(backfill.mock.calls.length).toBeGreaterThan(beforeOffline);
  });

  test("a slow poll does not stack requests on the next tick", async () => {
    let release!: (rows: RawChatMessage[]) => void;
    backfill.mockImplementationOnce(
      () =>
        new Promise<RawChatMessage[]>((resolve) => {
          release = resolve;
        }),
    );

    chatRealtime.subscribe("channel-1");
    current("channel-1").trigger("CHANNEL_ERROR");
    await vi.advanceTimersByTimeAsync(POLL_DEGRADE_AFTER_MS);
    expect(backfill).toHaveBeenCalledTimes(1); // in flight, unresolved

    // Two intervals elapse while the first fetch is still hanging.
    await vi.advanceTimersByTimeAsync(POLL_INTERVAL_MS * 2);
    expect(backfill).toHaveBeenCalledTimes(1);

    // Once it settles, the loop resumes on the next tick.
    release([]);
    await vi.advanceTimersByTimeAsync(POLL_INTERVAL_MS);
    expect(backfill).toHaveBeenCalledTimes(2);
  });

  test("a fresh join stays quiet in the UI but still arms the degrade timer", async () => {
    // Switching channels is a fresh join; flashing "Reconnecting…" every time
    // the user clicks a channel would be noise.
    chatRealtime.subscribe("channel-1");
    expect(status).toBe("live");
    await vi.advanceTimersByTimeAsync(POLL_DEGRADE_AFTER_MS - 1);
    expect(status).toBe("live");

    // A join that genuinely stalls is still caught — by the poll loop.
    await vi.advanceTimersByTimeAsync(1);
    expect(status).toBe("polling");
    expect(backfill).toHaveBeenCalledWith("channel-1", null);
  });

  test("a poll left hanging at destroy() does not wedge the next session", async () => {
    // The manager is a module singleton, so a latched in-flight flag would
    // survive teardown and silently disable polling forever.
    backfill.mockImplementationOnce(() => new Promise<RawChatMessage[]>(() => {}));

    chatRealtime.subscribe("channel-1");
    current("channel-1").trigger("CHANNEL_ERROR");
    await vi.advanceTimersByTimeAsync(POLL_DEGRADE_AFTER_MS);
    expect(backfill).toHaveBeenCalledTimes(1); // hung, never settles

    chatRealtime.destroy();

    // Fresh mount over the same singleton, Realtime still down.
    chatRealtime.configure({ queryClient, supabase, backfill });
    chatRealtime.subscribe("channel-1");
    current("channel-1").trigger("CHANNEL_ERROR");
    await vi.advanceTimersByTimeAsync(POLL_DEGRADE_AFTER_MS);
    expect(backfill).toHaveBeenCalledTimes(2);
  });

  test("destroy() tears the poll loop down", async () => {
    chatRealtime.subscribe("channel-1");
    current("channel-1").trigger("CHANNEL_ERROR");
    await vi.advanceTimersByTimeAsync(POLL_DEGRADE_AFTER_MS);
    const atDestroy = backfill.mock.calls.length;
    expect(atDestroy).toBeGreaterThan(0);

    chatRealtime.destroy();
    await vi.advanceTimersByTimeAsync(POLL_INTERVAL_MS * 4);
    expect(backfill).toHaveBeenCalledTimes(atDestroy);
  });
});

describe("ChatRealtimeManager — channel reopen (#783)", () => {
  let backfill: ReturnType<typeof vi.fn> & BackfillFetcher;
  let queryClient: QueryClient;
  let channels: Map<string, FakeChannel>;
  let supabase: SupabaseClient;

  beforeEach(() => {
    window.localStorage.clear();
    backfill = vi.fn(async (): Promise<RawChatMessage[]> => []) as ReturnType<
      typeof vi.fn
    > &
      BackfillFetcher;
    queryClient = new QueryClient();
    ({ supabase, channels } = makeFakeSupabase());
    chatRealtime.configure({ queryClient, supabase, backfill });
  });

  afterEach(() => {
    chatRealtime.destroy();
    queryClient.clear();
    window.localStorage.clear();
  });

  function current(channelId: string): FakeChannel {
    const ch = channels.get(`chat:channel:${channelId}`);
    if (!ch) throw new Error(`no fake channel for ${channelId}`);
    return ch;
  }

  test("re-subscribing while the previous channel is still unregistering does not throw", async () => {
    chatRealtime.subscribe("channel-1");
    const first = current("channel-1");
    first.trigger("SUBSCRIBED");
    expect(first.state).toBe("joined");

    // Exactly what `use-chat-channel`'s effect does when its deps change:
    // cleanup then re-run, with the removal still in flight. Before the fix
    // this handed back `first` and `.on("postgres_changes", …)` threw straight
    // out of `subscribe()` — into React's commit phase, unmounting the shell.
    chatRealtime.unsubscribe("channel-1");
    expect(() => chatRealtime.subscribe("channel-1")).not.toThrow();

    await vi.waitFor(() => expect(current("channel-1")).not.toBe(first));
    expect(first.teardown).toHaveBeenCalled();

    // The replacement is a genuinely fresh instance that got its binding.
    const second = current("channel-1");
    expect(second).not.toBe(first);
    expect(second.on).toHaveBeenCalledWith(
      "postgres_changes",
      expect.objectContaining({ table: "chat_messages" }),
      expect.any(Function),
    );
    second.trigger("SUBSCRIBED");
    expect(second.state).toBe("joined");
  });

  test("the reopened channel keeps the topic the push worker reads presence on", async () => {
    // ADR-10: `chat:channel:<id>` is a cross-service contract — re-keying the
    // topic to dodge the collision would silently disable push suppression.
    chatRealtime.subscribe("channel-1");
    const first = current("channel-1");
    first.trigger("SUBSCRIBED");
    chatRealtime.unsubscribe("channel-1");
    chatRealtime.subscribe("channel-1");

    await vi.waitFor(() => expect(current("channel-1")).not.toBe(first));
    const topics = (supabase.channel as unknown as ReturnType<typeof vi.fn>).mock
      .calls.map((c) => c[0] as string)
      .filter((t) => t.startsWith("chat:channel:"));
    expect(new Set(topics)).toEqual(new Set(["chat:channel:channel-1"]));
  });

  test("an attach that throws cannot escape into the caller's render pass", async () => {
    chatRealtime.subscribe("channel-1");
    current("channel-1").trigger("SUBSCRIBED");

    const channelFn = supabase.channel as unknown as ReturnType<typeof vi.fn>;
    channelFn.mockImplementationOnce(() => {
      throw new Error("realtime exploded");
    });

    // Criterion 2: a failed or racing resubscribe must not unmount the shell.
    chatRealtime.unsubscribe("channel-1");
    expect(() => chatRealtime.subscribe("channel-1")).not.toThrow();
    await vi.waitFor(() => expect(channelFn).toHaveBeenCalled());
  });

  test("the global actions channel survives a destroy/configure cycle", async () => {
    const firstActions = channels.get("chat:actions:global");
    expect(firstActions).toBeDefined();

    // `ChatProvider`'s effect deps include `apiClient`/`userId`, so this is an
    // ordinary re-auth: destroy() removes the actions channel fire-and-forget
    // and configure() immediately recreates it on the same topic.
    chatRealtime.destroy();
    expect(() =>
      chatRealtime.configure({ queryClient, supabase, backfill }),
    ).not.toThrow();

    await vi.waitFor(() =>
      expect(channels.get("chat:actions:global")).not.toBe(firstActions),
    );
    expect(firstActions!.teardown).toHaveBeenCalled();
  });
});
