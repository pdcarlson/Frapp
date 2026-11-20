import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { attachTopicChannel, DENIED_RETRY_AFTER_AUTH_MS } from "./topic-attach";
import { isJoinDenied } from "./join-denied";

/**
 * A join Realtime refuses for RLS is let go rather than left to phoenix's
 * rejoin loop (#5765). The fake keeps the two registry behaviours every
 * attach depends on (`channel(topic)` hands back a registered instance, and
 * only `teardown()` unregisters one), plus an auth listener set.
 */

type Status = "SUBSCRIBED" | "CHANNEL_ERROR" | "TIMED_OUT" | "CLOSED";

interface FakeChannel {
  topic: string;
  subscribe: ReturnType<typeof vi.fn>;
  unsubscribe: ReturnType<typeof vi.fn>;
  teardown: ReturnType<typeof vi.fn>;
  report: (status: Status, error?: Error) => void;
}

function makeFake() {
  const created: FakeChannel[] = [];
  const registry = new Map<string, FakeChannel>();
  const authListeners = new Set<(event: string) => void>();
  const supabase = {
    channel: vi.fn((topic: string) => {
      const existing = registry.get(topic);
      if (existing) return existing;
      let callback: ((status: Status, error?: Error) => void) | null = null;
      const channel: FakeChannel = {
        topic: `realtime:${topic}`,
        subscribe: vi.fn((cb: (status: Status, error?: Error) => void) => {
          callback = cb;
          return channel;
        }),
        unsubscribe: vi.fn(async () => "ok"),
        teardown: vi.fn(() => {
          if (registry.get(topic) === channel) registry.delete(topic);
        }),
        report: (status, error) => callback?.(status, error),
      };
      registry.set(topic, channel);
      created.push(channel);
      return channel;
    }),
    getChannels: vi.fn(() => [...registry.values()]),
    auth: {
      onAuthStateChange: vi.fn((listener: (event: string) => void) => {
        authListeners.add(listener);
        return {
          data: {
            subscription: { unsubscribe: () => authListeners.delete(listener) },
          },
        };
      }),
    },
  } as unknown as SupabaseClient;
  const emitAuth = (event: string) => {
    for (const listener of [...authListeners]) listener(event);
  };
  return { supabase, created, emitAuth, authListeners, registry };
}

function denied(topic: string): Error {
  const reason = `Unauthorized: You do not have permissions to read from this Channel topic: ${topic}`;
  return new Error(reason, { cause: { reason } });
}

const TOPIC = "events:old-chapter";

describe("attachTopicChannel — a refused join (#5765)", () => {
  let fake: ReturnType<typeof makeFake>;

  beforeEach(() => {
    vi.useFakeTimers();
    vi.spyOn(console, "warn").mockImplementation(() => {});
    fake = makeFake();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  test("is released, reported once, and not asked for again on a timer", async () => {
    const onDisconnected = vi.fn();
    attachTopicChannel(fake.supabase, TOPIC, (c) => c, {
      private: true,
      onDisconnected,
    });
    await vi.advanceTimersByTimeAsync(0);
    const first = fake.created[0]!;

    first.report("CHANNEL_ERROR", denied(TOPIC));
    // A rejoin phoenix already had in flight, then the teardown's CLOSED.
    first.report("CHANNEL_ERROR", denied(TOPIC));
    await vi.advanceTimersByTimeAsync(0);
    first.report("CLOSED");

    expect(first.unsubscribe).toHaveBeenCalled();
    expect(first.teardown).toHaveBeenCalled();
    expect(fake.registry.size).toBe(0);
    expect(onDisconnected).toHaveBeenCalledTimes(1);
    expect(onDisconnected).toHaveBeenCalledWith("CHANNEL_ERROR");

    await vi.advanceTimersByTimeAsync(10 * 60_000);
    expect(fake.created).toHaveLength(1);
  });

  test("a refreshed token asks once more", async () => {
    const onSubscribed = vi.fn();
    attachTopicChannel(fake.supabase, TOPIC, (c) => c, {
      private: true,
      onSubscribed,
    });
    await vi.advanceTimersByTimeAsync(0);
    fake.created[0]!.report("CHANNEL_ERROR", denied(TOPIC));
    await vi.advanceTimersByTimeAsync(0);

    fake.emitAuth("INITIAL_SESSION");
    await vi.advanceTimersByTimeAsync(60_000);
    expect(fake.created).toHaveLength(1);

    fake.emitAuth("TOKEN_REFRESHED");
    await vi.advanceTimersByTimeAsync(DENIED_RETRY_AFTER_AUTH_MS);
    expect(fake.created).toHaveLength(2);
    // The listener was for that one retry.
    expect(fake.authListeners.size).toBe(0);

    fake.created[1]!.report("SUBSCRIBED");
    expect(onSubscribed).toHaveBeenCalledTimes(1);
  });

  test("unmounting while it waits for a token cancels the retry", async () => {
    const detach = attachTopicChannel(fake.supabase, TOPIC, (c) => c, {
      private: true,
    });
    await vi.advanceTimersByTimeAsync(0);
    fake.created[0]!.report("CHANNEL_ERROR", denied(TOPIC));
    await vi.advanceTimersByTimeAsync(0);

    detach();
    expect(fake.authListeners.size).toBe(0);
    fake.emitAuth("TOKEN_REFRESHED");
    await vi.advanceTimersByTimeAsync(60_000);
    expect(fake.created).toHaveLength(1);
  });

  test("any other failure stays registered for phoenix to rejoin, as before", async () => {
    const onDisconnected = vi.fn();
    attachTopicChannel(fake.supabase, TOPIC, (c) => c, {
      private: true,
      onDisconnected,
    });
    await vi.advanceTimersByTimeAsync(0);
    const first = fake.created[0]!;

    first.report("TIMED_OUT");
    first.report("CHANNEL_ERROR");
    first.report("CHANNEL_ERROR", new Error("PostgresChangesSubscribeTimeout"));
    await vi.advanceTimersByTimeAsync(0);

    expect(first.teardown).not.toHaveBeenCalled();
    expect(onDisconnected).toHaveBeenCalledTimes(3);
    expect(fake.authListeners.size).toBe(0);
  });
});

describe("isJoinDenied", () => {
  test("reads Realtime's RLS refusal from the message or the cause", () => {
    expect(isJoinDenied(denied("chat:channel:x"))).toBe(true);
    expect(
      isJoinDenied(
        new Error("error", {
          cause: {
            reason:
              "You do not have permissions to read from this Channel topic: notif:1",
          },
        }),
      ),
    ).toBe(true);
    expect(isJoinDenied("Unauthorized: nope")).toBe(true);
  });

  test("leaves every transient failure alone", () => {
    expect(isJoinDenied(undefined)).toBe(false);
    expect(isJoinDenied(new Error("error"))).toBe(false);
    expect(isJoinDenied(new Error("PostgresChangesSubscribeTimeout"))).toBe(
      false,
    );
    expect(
      isJoinDenied(
        new Error(
          "mismatch between server and client bindings for postgres changes",
        ),
      ),
    ).toBe(false);
  });
});
