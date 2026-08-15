/**
 * Direct cover for the one invariant this module exists to hold (#783/#817):
 * `releaseTopic` runs `teardown()` — the step `removeChannel()` skips —
 * **unconditionally**, even when `unsubscribe()` rejects or resolves
 * something other than `"ok"`. The manager and web realtime suites exercise
 * the registry only through happy-path fakes whose `unsubscribe()` resolves
 * `"ok"`, so without this file the airtight branch is untested.
 */

import { describe, expect, test, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { isTopicOccupied, releaseTopic } from "./topic-registry";

interface FakeChannel {
  topic: string;
  unsubscribe: ReturnType<typeof vi.fn>;
  teardown: ReturnType<typeof vi.fn>;
}

function makeChannel(
  topic: string,
  opts: {
    unsubscribe?: () => Promise<string>;
    teardown?: () => void;
  } = {},
): FakeChannel {
  return {
    // The real client registers under a `realtime:` prefix; callers pass the
    // bare topic.
    topic: `realtime:${topic}`,
    unsubscribe: vi.fn(opts.unsubscribe ?? (async () => "ok")),
    teardown: vi.fn(opts.teardown ?? (() => {})),
  };
}

function makeClient(channels: FakeChannel[]): SupabaseClient {
  return { getChannels: () => channels } as unknown as SupabaseClient;
}

describe("isTopicOccupied", () => {
  test("matches only the prefixed registry topic", () => {
    const client = makeClient([makeChannel("chat:channel:a")]);
    expect(isTopicOccupied(client, "chat:channel:a")).toBe(true);
    expect(isTopicOccupied(client, "chat:channel:b")).toBe(false);
    // A bare (unprefixed) lookup must not match the prefixed registration.
    expect(isTopicOccupied(client, "realtime:chat:channel:a")).toBe(false);
  });
});

describe("releaseTopic", () => {
  test("tears down even when unsubscribe() rejects", async () => {
    const channel = makeChannel("chat:channel:a", {
      unsubscribe: async () => {
        throw new Error("socket down");
      },
    });
    await releaseTopic(makeClient([channel]), "chat:channel:a");
    expect(channel.unsubscribe).toHaveBeenCalledTimes(1);
    expect(channel.teardown).toHaveBeenCalledTimes(1);
  });

  test('tears down when unsubscribe() resolves something other than "ok"', async () => {
    const channel = makeChannel("chat:channel:a", {
      unsubscribe: async () => "timed out",
    });
    await releaseTopic(makeClient([channel]), "chat:channel:a");
    expect(channel.teardown).toHaveBeenCalledTimes(1);
  });

  test("a throwing teardown() does not stop the sweep over remaining matches", async () => {
    const first = makeChannel("chat:channel:a", {
      teardown: () => {
        throw new Error("already torn down");
      },
    });
    const second = makeChannel("chat:channel:a");
    await expect(
      releaseTopic(makeClient([first, second]), "chat:channel:a"),
    ).resolves.toBeUndefined();
    expect(second.teardown).toHaveBeenCalledTimes(1);
  });

  test("leaves channels on other topics untouched", async () => {
    const other = makeChannel("chat:channel:b");
    await releaseTopic(makeClient([other]), "chat:channel:a");
    expect(other.unsubscribe).not.toHaveBeenCalled();
    expect(other.teardown).not.toHaveBeenCalled();
  });
});
