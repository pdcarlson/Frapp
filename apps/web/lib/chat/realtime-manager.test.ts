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

interface FakeChannel {
  on: ReturnType<typeof vi.fn>;
  subscribe: ReturnType<typeof vi.fn>;
  send: ReturnType<typeof vi.fn>;
  unsubscribe: ReturnType<typeof vi.fn>;
  topic: string;
  trigger: (status: SubscribeStatus) => void;
}

function makeFakeChannel(topic: string): FakeChannel {
  let captured: ((status: SubscribeStatus) => void) | null = null;
  const channel: FakeChannel = {
    topic,
    on: vi.fn(() => channel),
    subscribe: vi.fn((cb?: (status: SubscribeStatus) => void) => {
      if (cb) captured = cb;
      return channel;
    }),
    send: vi.fn(),
    unsubscribe: vi.fn(),
    trigger: (status) => {
      if (!captured) throw new Error("subscribe callback not captured");
      captured(status);
    },
  };
  return channel;
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
    supabase = {
      channel: vi.fn((topic: string) => {
        const ch = makeFakeChannel(topic);
        channels.set(topic, ch);
        return ch;
      }),
      removeChannel: vi.fn(),
    } as unknown as SupabaseClient;

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
    supabase = {
      channel: vi.fn((topic: string) => {
        const ch = makeFakeChannel(topic);
        channels.set(topic, ch);
        return ch;
      }),
      removeChannel: vi.fn(),
    } as unknown as SupabaseClient;

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
