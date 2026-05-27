import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { QueryClient } from "@tanstack/react-query";
import type { SupabaseClient } from "@supabase/supabase-js";
import { chatRealtime, type BackfillFetcher } from "./realtime-manager";
import type { RawChatMessage } from "./types";

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
