/**
 * Pins the ADR-10 cross-service contract between this manager and the API's
 * push worker (`apps/api/src/modules/chat-push-worker/chat-push-worker.service.ts`):
 *
 *   - the channel topic is exactly `chat:channel:<id>`, with the exact
 *     channel config `{ broadcast: { self: false }, presence: { key: "" } }`
 *     (the worker joins the same topic with a byte-identical config to read
 *     presence), and
 *   - the presence payload is exactly `{ userId, ts }` — the worker reads
 *     `userId` (string) to skip recipients already in the channel; `ts` is
 *     written but unconsumed.
 *
 * These assertions are deliberately exact (key-set equality, not subset):
 * renaming, adding, or dropping a field here silently breaks push
 * suppression in production, so the test must fail loudly instead. See
 * `spec/architecture/README.md` ADR-10.
 */

import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { QueryClient } from "@tanstack/react-query";
import type { SupabaseClient } from "@supabase/supabase-js";
import { chatRealtime } from "./realtime-manager";

type SubscribeStatus = "SUBSCRIBED" | "CHANNEL_ERROR" | "TIMED_OUT" | "CLOSED";

interface FakeChannel {
  on: ReturnType<typeof vi.fn>;
  subscribe: ReturnType<typeof vi.fn>;
  send: ReturnType<typeof vi.fn>;
  unsubscribe: ReturnType<typeof vi.fn> & (() => Promise<string>);
  teardown: ReturnType<typeof vi.fn> & (() => void);
  track: ReturnType<typeof vi.fn>;
  /** Prefixed `realtime:` exactly as the real client does. */
  topic: string;
  trigger: (status: SubscribeStatus) => void;
}

/**
 * A minimal fake — a trimmed sibling of the one in
 * `./realtime-manager.test.ts` (kept local on purpose: the traveling suite
 * must stay byte-identical to its pre-extraction form, so it does not export
 * its fakes). Fresh channels only; the reuse/throw semantics the bigger fake
 * reproduces are out of scope here.
 */
function makeFakeSupabase() {
  const channels = new Map<string, FakeChannel>();
  const channelCalls: Array<{ topic: string; opts: unknown }> = [];

  const client = {
    channel: vi.fn((topic: string, opts?: unknown) => {
      channelCalls.push({ topic, opts });
      const existing = channels.get(topic);
      if (existing) return existing;
      let captured: ((status: SubscribeStatus) => void) | null = null;
      const fake: FakeChannel = {
        topic: `realtime:${topic}`,
        on: vi.fn(() => fake),
        subscribe: vi.fn((cb?: (status: SubscribeStatus) => void) => {
          captured = cb ?? null;
          return fake;
        }),
        send: vi.fn(),
        unsubscribe: vi.fn(async () => "ok"),
        teardown: vi.fn(() => {
          channels.delete(topic);
        }),
        track: vi.fn(),
        trigger: (status) => captured?.(status),
      };
      channels.set(topic, fake);
      return fake;
    }),
    getChannels: vi.fn(() => [...channels.values()]),
    removeChannel: vi.fn(async (ch: FakeChannel) => {
      await ch.unsubscribe();
      ch.teardown();
      return "ok";
    }),
  };

  return {
    client: client as unknown as SupabaseClient,
    channels,
    channelCalls,
  };
}

describe("ADR-10 presence contract (read by the push worker)", () => {
  let queryClient: QueryClient;

  beforeEach(() => {
    queryClient = new QueryClient();
  });

  afterEach(() => {
    chatRealtime.destroy();
    queryClient.clear();
    window.localStorage.clear();
  });

  test("subscribes on exactly `chat:channel:<id>` with the worker's channel config", () => {
    const { client, channelCalls } = makeFakeSupabase();
    chatRealtime.configure({
      queryClient,
      supabase: client,
      backfill: vi.fn(async () => []),
    });
    chatRealtime.subscribe("channel-1");

    const call = channelCalls.find((c) => c.topic.startsWith("chat:channel:"));
    expect(call).toBeDefined();
    expect(call!.topic).toBe("chat:channel:channel-1");
    // Byte-identical to chat-push-worker.service.ts's `ensurePresenceChannel`.
    expect(call!.opts).toEqual({
      config: { broadcast: { self: false }, presence: { key: "" } },
    });
  });

  test("tracks presence as exactly `{ userId, ts }` once SUBSCRIBED", () => {
    const { client, channels } = makeFakeSupabase();
    chatRealtime.configure({
      queryClient,
      supabase: client,
      backfill: vi.fn(async () => []),
      viewerId: "viewer-1",
    });
    chatRealtime.subscribe("channel-1");

    const channel = channels.get("chat:channel:channel-1");
    expect(channel).toBeDefined();
    channel!.trigger("SUBSCRIBED");

    expect(channel!.track).toHaveBeenCalledTimes(1);
    const payload = channel!.track.mock.calls[0]![0] as Record<string, unknown>;
    // Exact key set: the worker reads `userId`; anything renamed, added, or
    // removed here is a silent production break, so fail loudly instead.
    expect(Object.keys(payload).sort()).toEqual(["ts", "userId"]);
    expect(payload.userId).toBe("viewer-1");
    expect(typeof payload.ts).toBe("number");
  });

  test("does not track presence for a viewerless (signed-out / test) context", () => {
    const { client, channels } = makeFakeSupabase();
    chatRealtime.configure({
      queryClient,
      supabase: client,
      backfill: vi.fn(async () => []),
    });
    chatRealtime.subscribe("channel-1");

    const channel = channels.get("chat:channel:channel-1");
    channel!.trigger("SUBSCRIBED");
    expect(channel!.track).not.toHaveBeenCalled();
  });
});
