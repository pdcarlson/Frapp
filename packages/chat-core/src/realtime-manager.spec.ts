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
  normalizeRow,
  type ChannelCache,
  type RawChatMessage,
} from "./types";
import { emptyCache, upsertOptimistic } from "./cache";
import type { KeyValueStore } from "./adapters";
import { persistNotice, readNotices } from "./heavy-command-notices";
import { visibleTypingUsers, type BlockState } from "./blocks";
import { memoryStore } from "./test/memory-store";
import { unconfirmedNotice } from "./test/notices";

type SubscribeStatus = "SUBSCRIBED" | "CHANNEL_ERROR" | "TIMED_OUT" | "CLOSED";

/** Mirrors `CHANNEL_STATES` in @supabase/realtime-js. */
type FakeChannelState = "closed" | "errored" | "joined" | "joining" | "leaving";

interface FakeChannel {
  on: ReturnType<typeof vi.fn>;
  subscribe: ReturnType<typeof vi.fn>;
  send: ReturnType<typeof vi.fn>;
  unsubscribe: ReturnType<typeof vi.fn> & (() => Promise<string>);
  teardown: ReturnType<typeof vi.fn> & (() => void);
  track: ReturnType<typeof vi.fn>;
  /** Prefixed `realtime:` exactly as the real client does. */
  topic: string;
  state: FakeChannelState;
  trigger: (status: SubscribeStatus) => void;
  /** Delivers a `postgres_changes` frame to whatever the manager registered. */
  emitPostgresChange: (payload: {
    eventType?: "INSERT" | "UPDATE" | "DELETE";
    new?: unknown;
    old?: unknown;
  }) => void;
  /** Delivers a Broadcast frame to the handler bound for its event. */
  emitBroadcast: (event: string, payload: unknown) => void;
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
  let onChange: ((payload: { new?: unknown; old?: unknown }) => void) | null =
    null;
  const onBroadcast = new Map<string, (msg: { payload: unknown }) => void>();
  const channel: FakeChannel = {
    topic: `realtime:${topic}`,
    state: "closed",
    on: vi.fn(
      (
        type: string,
        filter: unknown,
        handler?: (payload: { new?: unknown; old?: unknown }) => void,
      ) => {
        if (
          (type === "postgres_changes" || type === "presence") &&
          (channel.state === "joined" || channel.state === "joining")
        ) {
          throw new Error(
            `cannot add \`${type}\` callbacks for ${channel.topic} after \`subscribe()\`.`,
          );
        }
        if (
          type === "postgres_changes" &&
          (filter as { table?: string } | undefined)?.table === "chat_messages"
        ) {
          onChange = handler ?? null;
        }
        if (type === "broadcast" && handler) {
          onBroadcast.set(
            (filter as { event: string }).event,
            handler as (msg: { payload: unknown }) => void,
          );
        }
        return channel;
      },
    ),
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
    emitPostgresChange: (payload) => {
      if (!onChange) throw new Error("postgres_changes handler not captured");
      onChange(payload);
    },
    emitBroadcast: (event, payload) => {
      const handler = onBroadcast.get(event);
      if (!handler)
        throw new Error(`broadcast handler for ${event} not captured`);
      handler({ payload });
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
} {
  const channels = new Map<string, FakeChannel>();
  /** Live registry, mirroring `RealtimeClient.channels`. */
  const registry = new Map<string, FakeChannel>();
  const supabase = {
    channel: vi.fn((topic: string) => {
      const existing = registry.get(topic);
      if (existing) return existing;
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
  return { supabase, channels };
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
      author_name: null,
      author_avatar_path: null,
      author_external_id: null,
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

describe("ChatRealtimeManager — polling fallback (spec/ui/resilience/message-delivery.md#receiving-messages-realtime)", () => {
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
      author_name: null,
      author_avatar_path: null,
      author_external_id: null,
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
    backfill.mockImplementationOnce(
      () => new Promise<RawChatMessage[]>(() => {}),
    );

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
    const topics = (
      supabase.channel as unknown as ReturnType<typeof vi.fn>
    ).mock.calls
      .map((c) => c[0] as string)
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

  test("an imported archive row never enters the live cache", () => {
    // The server already keeps these off the wire — the `chat_messages` RLS
    // policy, which is what Realtime evaluates per subscriber, excludes
    // `kind = 'imported'` — so reaching the handler at all means that policy
    // regressed. Guarding here is cheap and the failure it prevents is not:
    // there is no batching on this path, so every frame is its own
    // `setQueryData`, full cache-object spread and list re-render. An import
    // aimed at a channel somebody has open would otherwise walk thousands of
    // years-old messages into a live timeline one render at a time.
    chatRealtime.subscribe("channel-1");
    const ch = current("channel-1");
    ch.trigger("SUBSCRIBED");

    ch.emitPostgresChange({
      new: {
        id: "msg-imported",
        channel_id: "channel-1",
        sender_id: null,
        author_name: "DiscordUser",
        author_external_id: "9911",
        kind: "imported",
        content: "a message from 2019",
        created_at: "2019-03-04T00:00:00.000Z",
      },
    });

    const cache = queryClient.getQueryData<ChannelCache>(
      chatMessagesKey("channel-1"),
    );
    expect(cache?.order ?? []).not.toContain("msg-imported");
    // And it must not advance the reconnect cursor either — an archive row is
    // not the channel's new tail, so backfilling from it would skip live
    // messages written before it landed.
    expect(window.localStorage.getItem("chat:lastSeen:channel-1")).not.toBe(
      "msg-imported",
    );
  });

  test("a live row still enters the cache through the same handler", () => {
    // Pins that the guard above is a `kind` check and not an accidental
    // short-circuit of the whole INSERT path.
    chatRealtime.subscribe("channel-1");
    const ch = current("channel-1");
    ch.trigger("SUBSCRIBED");

    ch.emitPostgresChange({
      new: {
        id: "msg-live",
        channel_id: "channel-1",
        sender_id: "user-2",
        kind: "text",
        content: "hello",
        created_at: "2026-01-01T00:00:00.000Z",
        client_message_id: "client-live",
      },
    });

    const cache = queryClient.getQueryData<ChannelCache>(
      chatMessagesKey("channel-1"),
    );
    expect(cache?.order).toContain("msg-live");
  });

  test("an UPDATE echo of a message the window doesn't hold stays out, so paging can't skip history (#2871)", () => {
    // An old message edited, pinned or deleted while only the newest page is
    // loaded. Spliced in, it would become the cache's oldest row and the next
    // older-page read would start below everything in between.
    chatRealtime.subscribe("channel-1");
    const ch = current("channel-1");
    ch.trigger("SUBSCRIBED");
    ch.emitPostgresChange({
      eventType: "INSERT",
      new: {
        id: "msg-new",
        channel_id: "channel-1",
        sender_id: "user-2",
        kind: "text",
        content: "newest",
        created_at: "2026-02-01T00:00:00.000Z",
        client_message_id: "client-new",
      },
    });

    ch.emitPostgresChange({
      eventType: "UPDATE",
      new: {
        id: "msg-old",
        channel_id: "channel-1",
        sender_id: "user-2",
        kind: "text",
        content: "edited long ago",
        created_at: "2026-01-01T00:00:00.000Z",
        edited_at: "2026-02-02T00:00:00.000Z",
        client_message_id: "client-old",
      },
    });

    const cache = queryClient.getQueryData<ChannelCache>(
      chatMessagesKey("channel-1"),
    );
    expect(cache?.order).toEqual(["msg-new"]);
    expect(cache?.byId["msg-old"]).toBeUndefined();
  });

  test("an UPDATE echo before the channel's first read creates no cache", () => {
    chatRealtime.subscribe("channel-1");
    const ch = current("channel-1");
    ch.trigger("SUBSCRIBED");
    ch.emitPostgresChange({
      eventType: "UPDATE",
      new: {
        id: "msg-old",
        channel_id: "channel-1",
        sender_id: "user-2",
        kind: "text",
        content: "edited",
        created_at: "2026-01-01T00:00:00.000Z",
      },
    });
    expect(
      queryClient.getQueryData(chatMessagesKey("channel-1")),
    ).toBeUndefined();
  });

  test("an UPDATE echo of a row still held under its client_message_id lands", () => {
    chatRealtime.subscribe("channel-1");
    const ch = current("channel-1");
    ch.trigger("SUBSCRIBED");
    queryClient.setQueryData(
      chatMessagesKey("channel-1"),
      upsertOptimistic(emptyCache(), {
        ...normalizeRow({
          id: "client-pending",
          channel_id: "channel-1",
          sender_id: "user-1",
          kind: "text",
          content: "sending",
          created_at: "2026-02-01T00:00:00.000Z",
          client_message_id: "client-pending",
        }),
        _status: "pending",
      }),
    );
    ch.emitPostgresChange({
      eventType: "UPDATE",
      new: {
        id: "msg-server",
        channel_id: "channel-1",
        sender_id: "user-1",
        kind: "text",
        content: "sent, then edited",
        created_at: "2026-02-01T00:00:00.000Z",
        client_message_id: "client-pending",
      },
    });
    const cache = queryClient.getQueryData<ChannelCache>(
      chatMessagesKey("channel-1"),
    );
    expect(cache?.byId["msg-server"]?.content).toBe("sent, then edited");
    expect(cache?.byId["client-pending"]).toBeUndefined();
  });

  test("an UPDATE echo of a held message still lands", () => {
    chatRealtime.subscribe("channel-1");
    const ch = current("channel-1");
    ch.trigger("SUBSCRIBED");
    const row = {
      id: "msg-held",
      channel_id: "channel-1",
      sender_id: "user-2",
      kind: "text",
      content: "before",
      created_at: "2026-02-01T00:00:00.000Z",
      client_message_id: "client-held",
    };
    ch.emitPostgresChange({ eventType: "INSERT", new: row });
    ch.emitPostgresChange({
      eventType: "INSERT",
      new: {
        ...row,
        id: "msg-newer",
        created_at: "2026-02-01T00:01:00.000Z",
        client_message_id: "client-newer",
      },
    });
    ch.emitPostgresChange({
      eventType: "UPDATE",
      new: { ...row, content: "after", edited_at: "2026-02-01T00:05:00.000Z" },
    });

    const cache = queryClient.getQueryData<ChannelCache>(
      chatMessagesKey("channel-1"),
    );
    expect(cache?.byId["msg-held"]?.content).toBe("after");
    // Only an INSERT moves the reconnect cursor (ADR-05): the edit of an
    // older message doesn't drag it back.
    expect(window.localStorage.getItem("chat:lastSeen:channel-1")).toBe(
      "msg-newer",
    );
  });

  test("an echo never lands server-evaluated, even carrying a sender_blocked of its own (#2315)", () => {
    // `sender_blocked`'s presence is how a REST row says the server applied
    // the viewer's block list. An echo has no viewer, so whatever it carries
    // must not read that way — an evaluated row renders in the clear while the
    // list is loading or unavailable. The timestamp is the shape local
    // Realtime v2.113.4 actually delivered, not a `.toISOString()` stand-in.
    chatRealtime.subscribe("channel-1");
    const ch = current("channel-1");
    ch.trigger("SUBSCRIBED");

    ch.emitPostgresChange({
      new: {
        id: "msg-echo",
        channel_id: "channel-1",
        sender_id: "user-2",
        kind: "text",
        content: "raw words",
        sender_blocked: false,
        created_at: "2026-09-23T01:49:55.661142+00:00",
        client_message_id: "client-echo",
      },
    });

    const cache = queryClient.getQueryData<ChannelCache>(
      chatMessagesKey("channel-1"),
    );
    expect(cache?.byId["msg-echo"]?.content).toBe("raw words");
    expect(cache?.byId["msg-echo"]?._blockEvaluated).toBe(false);
  });

  test("a reconnect backfill lands server-evaluated, even over the echo of the same row (#2315)", async () => {
    // The backfill merges through `setQueryData`, never the thread's
    // `queryFn`, so provenance kept anywhere but on the row itself never
    // advanced here and every row a reconnect pulled rendered as held. Here it
    // re-reads a row an echo already delivered: the REST copy must replace the
    // echo's provenance, not inherit it.
    chatRealtime.subscribe("channel-1");
    const ch = current("channel-1");
    ch.trigger("SUBSCRIBED");
    await vi.waitFor(() => expect(backfill).toHaveBeenCalledTimes(1));

    ch.emitPostgresChange({
      new: {
        id: "msg-both",
        channel_id: "channel-1",
        sender_id: "user-2",
        kind: "text",
        content: "raw words",
        created_at: "2026-09-23T01:49:55.661142+00:00",
        client_message_id: "client-both",
      },
    });
    const key = chatMessagesKey("channel-1");
    expect(
      queryClient.getQueryData<ChannelCache>(key)?.byId["msg-both"]
        ?._blockEvaluated,
    ).toBe(false);

    // The reconnect, simulated as the rest of this suite does it: the channel
    // errors, then subscribes again, and the backfill returns the same row as
    // the server serves it to this viewer — masked.
    ch.trigger("CHANNEL_ERROR");
    backfill.mockResolvedValueOnce([
      {
        id: "msg-both",
        channel_id: "channel-1",
        sender_id: "user-2",
        kind: "text",
        content: "[masked by the server]",
        sender_blocked: true,
        created_at: "2026-09-23T01:49:55.661142+00:00",
        client_message_id: "client-both",
      },
    ]);
    current("channel-1").trigger("SUBSCRIBED");

    await vi.waitFor(() => {
      const row = queryClient.getQueryData<ChannelCache>(key)?.byId["msg-both"];
      expect(row?._blockEvaluated).toBe(true);
      expect(row?.sender_blocked).toBe(true);
      expect(row?.content).toBe("[masked by the server]");
    });
  });
});

/**
 * #1909 — a persisted heavy-command notice is evicted the moment its card
 * arrives, live or by backfill. Waiting for the next load is not enough: by
 * then the card can be outside the loaded window, and an entry still on disk
 * would come back as a Retry for a request that already committed.
 */
describe("ChatRealtimeManager — heavy-command notice eviction (#1909)", () => {
  let backfill: ReturnType<typeof vi.fn> & BackfillFetcher;
  let queryClient: QueryClient;
  let channels: Map<string, FakeChannel>;
  let kv: KeyValueStore;

  const card: RawChatMessage = {
    id: "server-1",
    channel_id: "chan-1",
    sender_id: "user-1",
    kind: "points",
    content: "+5 points",
    created_at: "2026-09-09T00:00:01.000Z",
    client_message_id: "cm-1",
  };

  beforeEach(() => {
    backfill = vi.fn(async (): Promise<RawChatMessage[]> => []) as ReturnType<
      typeof vi.fn
    > &
      BackfillFetcher;
    queryClient = new QueryClient();
    kv = memoryStore();
    let supabase: SupabaseClient;
    ({ supabase, channels } = makeFakeSupabase());
    chatRealtime.configure({ queryClient, supabase, backfill, kv });
    persistNotice(unconfirmedNotice(), kv);
  });

  afterEach(() => {
    chatRealtime.destroy();
    queryClient.clear();
  });

  function joined(): FakeChannel {
    chatRealtime.subscribe("chan-1");
    const ch = channels.get("chat:channel:chan-1");
    if (!ch) throw new Error("no fake channel for chan-1");
    ch.trigger("SUBSCRIBED");
    return ch;
  }

  test("the card's live echo evicts the stored entry", async () => {
    const ch = joined();
    await vi.waitFor(() => expect(backfill).toHaveBeenCalled());

    ch.emitPostgresChange({ new: card });

    expect(readNotices("chan-1", "user-1", kv)).toEqual([]);
  });

  test("a card that arrives by backfill evicts it too", async () => {
    backfill.mockResolvedValueOnce([card]);
    joined();

    await vi.waitFor(() =>
      expect(readNotices("chan-1", "user-1", kv)).toEqual([]),
    );
  });

  // A notice is filed under the member who dispatched, and the server posts
  // that command's card as them — so the card's sender addresses the entry.
  test("an echo from another sender leaves the entry alone", async () => {
    const ch = joined();
    await vi.waitFor(() => expect(backfill).toHaveBeenCalled());

    ch.emitPostgresChange({ new: { ...card, sender_id: "user-9" } });

    expect(readNotices("chan-1", "user-1", kv)).toHaveLength(1);
  });

  // Same guard as `readLastSeen`/`writeLastSeen`: an injected store is not
  // trusted to be no-throw, and a throw here would abort the frame after the
  // merge and stop the cursor advancing.
  test("a store that throws on the notice key cannot break the echo", async () => {
    const throwing: KeyValueStore = {
      ...kv,
      get: (key) => {
        if (key.startsWith("chat:heavy:")) throw new Error("storage exploded");
        return kv.get(key);
      },
    };
    chatRealtime.destroy();
    let supabase: SupabaseClient;
    ({ supabase, channels } = makeFakeSupabase());
    chatRealtime.configure({ queryClient, supabase, backfill, kv: throwing });
    const ch = joined();
    await vi.waitFor(() => expect(backfill).toHaveBeenCalled());

    expect(() => ch.emitPostgresChange({ new: card })).not.toThrow();

    const cache = queryClient.getQueryData<ChannelCache>(
      chatMessagesKey("chan-1"),
    );
    expect(cache?.order).toContain("server-1");
    expect(kv.get("chat:lastSeen:chan-1")).toBe("server-1");
  });

  test("an unrelated message leaves the entry alone", async () => {
    const ch = joined();
    await vi.waitFor(() => expect(backfill).toHaveBeenCalled());

    ch.emitPostgresChange({
      new: { ...card, id: "server-2", client_message_id: "cm-other" },
    });

    expect(readNotices("chan-1", "user-1", kv)).toHaveLength(1);
  });
});

describe("ChatRealtimeManager — typing after the viewer's block list (#2496)", () => {
  const BLOCKED = "22222222-2222-4222-8222-222222222222";
  const FRIEND = "33333333-3333-4333-8333-333333333333";
  const VIEWER = "11111111-1111-4111-8111-111111111111";
  const blockedList: BlockState = {
    status: "ready",
    ids: new Set([BLOCKED]),
    unblocked: new Set(),
    cleared: new Set(),
  };
  let queryClient: QueryClient;
  let channels: Map<string, FakeChannel>;

  beforeEach(() => {
    queryClient = new QueryClient();
    let supabase: SupabaseClient;
    ({ supabase, channels } = makeFakeSupabase());
    chatRealtime.configure({
      queryClient,
      supabase,
      backfill: vi.fn(async () => []),
      kv: memoryStore(),
      viewerId: VIEWER,
    });
  });

  afterEach(() => {
    chatRealtime.destroy();
    queryClient.clear();
  });

  function joined(): FakeChannel {
    chatRealtime.subscribe("dm-1");
    const ch = channels.get("chat:channel:dm-1");
    if (!ch) throw new Error("no fake channel for dm-1");
    ch.trigger("SUBSCRIBED");
    return ch;
  }

  /** What both clients draw: the manager's list after the viewer's block list. */
  const indicator = () =>
    visibleTypingUsers(
      chatRealtime.getTypingUsers("dm-1"),
      blockedList,
      VIEWER,
    );

  test("a blocked member's typing broadcast leaves the indicator empty", () => {
    const ch = joined();
    ch.emitBroadcast("typing", { userId: BLOCKED, displayName: null });

    // The server delivered it, and the manager holds it…
    expect(chatRealtime.getTypingUsers("dm-1")).toEqual([BLOCKED]);
    // …but it never reaches the indicator.
    expect(indicator()).toEqual([]);
  });

  test("a member the viewer has not blocked still shows as typing", () => {
    const ch = joined();
    ch.emitBroadcast("typing", { userId: BLOCKED, displayName: null });
    ch.emitBroadcast("typing", { userId: FRIEND, displayName: null });

    expect(indicator()).toEqual([FRIEND]);
  });
});

describe("ChatRealtimeManager — typing list identity (#1004)", () => {
  const A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
  const B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
  let queryClient: QueryClient;
  let channels: Map<string, FakeChannel>;

  beforeEach(() => {
    vi.useFakeTimers();
    queryClient = new QueryClient();
    let supabase: SupabaseClient;
    ({ supabase, channels } = makeFakeSupabase());
    chatRealtime.configure({
      queryClient,
      supabase,
      backfill: vi.fn(async () => []),
      kv: memoryStore(),
    });
  });

  afterEach(() => {
    chatRealtime.destroy();
    queryClient.clear();
    vi.useRealTimers();
  });

  function joined(channelId: string): FakeChannel {
    chatRealtime.subscribe(channelId);
    const ch = channels.get(`chat:channel:${channelId}`);
    if (!ch) throw new Error(`no fake channel for ${channelId}`);
    ch.trigger("SUBSCRIBED");
    return ch;
  }

  test("hands back the same array while the typists are unchanged", () => {
    const ch = joined("c1");
    const other = joined("c2");
    ch.emitBroadcast("typing", { userId: A, displayName: null });
    const first = chatRealtime.getTypingUsers("c1");
    expect(first).toEqual([A]);

    // Pings that carry no change for c1: the same typist re-announcing, and
    // someone typing in another channel. Each one re-reads the list.
    vi.advanceTimersByTime(1000);
    ch.emitBroadcast("typing", { userId: A, displayName: null });
    expect(chatRealtime.getTypingUsers("c1")).toBe(first);
    other.emitBroadcast("typing", { userId: B, displayName: null });
    expect(chatRealtime.getTypingUsers("c1")).toBe(first);
  });

  test("returns a new array when someone starts or stops typing", () => {
    const ch = joined("c1");
    ch.emitBroadcast("typing", { userId: A, displayName: null });
    const one = chatRealtime.getTypingUsers("c1");

    ch.emitBroadcast("typing", { userId: B, displayName: null });
    const two = chatRealtime.getTypingUsers("c1");
    expect(two).not.toBe(one);
    expect(two).toEqual([A, B]);
    expect(chatRealtime.getTypingUsers("c1")).toBe(two);

    // Both expire (4 s) and the sweep drops them.
    vi.advanceTimersByTime(4500);
    const none = chatRealtime.getTypingUsers("c1");
    expect(none).toEqual([]);
    expect(chatRealtime.getTypingUsers("c1")).toBe(none);
  });

  test("an unknown channel's empty list is one identity", () => {
    expect(chatRealtime.getTypingUsers("nobody")).toEqual([]);
    expect(chatRealtime.getTypingUsers("nobody")).toBe(
      chatRealtime.getTypingUsers("nobody-else"),
    );
  });
});

describe("ChatRealtimeManager — configure attaches waiting channels and follows the viewer (#3002)", () => {
  const VIEWER = "11111111-1111-4111-8111-111111111111";
  const OTHER = "44444444-4444-4444-8444-444444444444";
  let backfill: ReturnType<typeof vi.fn> & BackfillFetcher;
  let queryClient: QueryClient;
  let channels: Map<string, FakeChannel>;
  let supabase: SupabaseClient;

  beforeEach(() => {
    backfill = vi.fn(async (): Promise<RawChatMessage[]> => []) as ReturnType<
      typeof vi.fn
    > &
      BackfillFetcher;
    queryClient = new QueryClient();
    ({ supabase, channels } = makeFakeSupabase());
    // Unconfigured, as the manager is before a provider's first configure and
    // after every destroy().
    chatRealtime.destroy();
  });

  afterEach(() => {
    chatRealtime.destroy();
    queryClient.clear();
  });

  const ctx = (viewerId: string | null) => ({
    queryClient,
    supabase,
    backfill,
    kv: memoryStore(),
    viewerId,
  });

  function current(channelId: string): FakeChannel | undefined {
    return channels.get(`chat:channel:${channelId}`);
  }

  test("a channel subscribed before configure attaches when configure lands", () => {
    // A child's effects run before its parent's: the thread subscribes, then
    // the provider configures. Before #3002 the subscribe found no ctx and the
    // channel sat in `joining` for good.
    chatRealtime.subscribe("c1");
    expect(current("c1")).toBeUndefined();

    chatRealtime.configure(ctx(VIEWER));
    const ch = current("c1");
    expect(ch).toBeDefined();
    ch!.trigger("SUBSCRIBED");

    expect(ch!.track).toHaveBeenCalledWith(
      expect.objectContaining({ userId: VIEWER }),
    );
    expect(backfill).toHaveBeenCalledWith("c1", null);
  });

  test("a viewer that resolves after the attach reopens the channel and tracks them", async () => {
    chatRealtime.configure(ctx(null));
    chatRealtime.subscribe("c1");
    const first = current("c1")!;
    first.trigger("SUBSCRIBED");
    expect(first.track).not.toHaveBeenCalled();

    chatRealtime.configure(ctx(VIEWER));

    await vi.waitFor(() => expect(current("c1")).not.toBe(first));
    expect(first.teardown).toHaveBeenCalled();
    const second = current("c1")!;
    second.trigger("SUBSCRIBED");
    expect(second.track).toHaveBeenCalledWith(
      expect.objectContaining({ userId: VIEWER }),
    );
  });

  test("a different viewer reopens every channel under the new one", async () => {
    chatRealtime.configure(ctx(VIEWER));
    chatRealtime.subscribe("c1");
    chatRealtime.subscribe("c2");
    const first1 = current("c1")!;
    const first2 = current("c2")!;
    first1.trigger("SUBSCRIBED");
    first2.trigger("SUBSCRIBED");

    chatRealtime.configure(ctx(OTHER));

    await vi.waitFor(() => {
      expect(current("c1")).not.toBe(first1);
      expect(current("c2")).not.toBe(first2);
    });
    current("c1")!.trigger("SUBSCRIBED");
    expect(current("c1")!.track).toHaveBeenCalledWith(
      expect.objectContaining({ userId: OTHER }),
    );
  });

  test("re-configuring for the same viewer leaves live channels alone", async () => {
    chatRealtime.configure(ctx(VIEWER));
    chatRealtime.subscribe("c1");
    const first = current("c1")!;
    first.trigger("SUBSCRIBED");
    const channelFn = supabase.channel as unknown as ReturnType<typeof vi.fn>;
    const calls = channelFn.mock.calls.length;

    // What a new `apiClient` (and so a new backfill closure) does.
    chatRealtime.configure(ctx(VIEWER));
    await Promise.resolve();

    expect(current("c1")).toBe(first);
    expect(first.unsubscribe).not.toHaveBeenCalled();
    expect(channelFn.mock.calls.length).toBe(calls);
  });

  test("a subscribe after destroy() attaches on the next configure (a remount)", async () => {
    chatRealtime.configure(ctx(VIEWER));
    chatRealtime.subscribe("c1");
    current("c1")!.trigger("SUBSCRIBED");

    // Unmount: the thread releases, then the provider destroys. Remount: the
    // thread subscribes first, then the provider configures.
    chatRealtime.unsubscribe("c1");
    chatRealtime.destroy();
    const channelFn = supabase.channel as unknown as ReturnType<typeof vi.fn>;
    const calls = channelFn.mock.calls.length;
    chatRealtime.subscribe("c1");
    expect(channelFn.mock.calls.length).toBe(calls);

    // The unmount's removal may still be leaving, so the attach waits for the
    // topic to free (#783) before it installs.
    chatRealtime.configure(ctx(VIEWER));
    await vi.waitFor(() =>
      expect(
        channelFn.mock.calls
          .slice(calls)
          .some(([topic]) => topic === "chat:channel:c1"),
      ).toBe(true),
    );
    current("c1")!.trigger("SUBSCRIBED");
    expect(current("c1")!.track).toHaveBeenCalledWith(
      expect.objectContaining({ userId: VIEWER }),
    );
  });
});
