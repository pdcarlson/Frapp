/**
 * `SUBSCRIBED` has to mean "every row from here on arrives" (#5022).
 *
 * Realtime can report `SUBSCRIBED` once a channel has joined, before the
 * replication behind its `postgres_changes` is streaming. A row written in
 * between is never delivered, and the manager has already acted on the
 * `SUBSCRIBED`: a thread ran its gap-recovery read, the inbox reported
 * `joined`. The fake server below models exactly that gap, from realtime-js
 * 2.119's own description of `postgres_changes_options.wait`: without `wait`
 * the join reports `SUBSCRIBED` at once and frames are dropped until
 * `startStreaming`; with it, `SUBSCRIBED` waits for the stream. Each test
 * writes a row inside the gap and expects it to reach the member. Against
 * local Realtime the same gap was real: the first join after a restart
 * missed such a row without `wait` and caught it with it.
 */

import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { QueryClient } from "@tanstack/react-query";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  chatRealtime,
  INBOX_TOPIC,
  type BackfillFetcher,
  type MessageActivity,
} from "./realtime-manager";
import {
  chatMessagesKey,
  type ChannelCache,
  type RawChatMessage,
} from "./types";

type SubscribeStatus = "SUBSCRIBED" | "CHANNEL_ERROR" | "TIMED_OUT" | "CLOSED";

type ChangeHandler = (payload: {
  eventType: "INSERT";
  new: RawChatMessage;
}) => void;

interface ServerChannel {
  topic: string;
  wait: boolean;
  streaming: boolean;
  joinedNotReported: boolean;
  bindings: Array<{ filter?: string; handler: ChangeHandler }>;
  status: ((status: SubscribeStatus) => void) | null;
}

/**
 * A Supabase client whose server joins a channel and starts its
 * `postgres_changes` stream as two separate steps, the way Realtime does.
 */
function makeServer() {
  const byTopic = new Map<string, ServerChannel>();
  const fakes = new Map<string, unknown>();
  const rows: RawChatMessage[] = [];

  const supabase = {
    channel: vi.fn(
      (topic: string, opts?: { config?: Record<string, unknown> }) => {
        const existing = fakes.get(topic);
        if (existing) return existing;
        const options = opts?.config?.postgres_changes_options as
          { wait?: boolean } | undefined;
        const server: ServerChannel = {
          topic,
          wait: options?.wait === true,
          streaming: false,
          joinedNotReported: false,
          bindings: [],
          status: null,
        };
        const fake = {
          topic: `realtime:${topic}`,
          on: vi.fn(
            (
              type: string,
              filter: { table?: string; filter?: string },
              handler: ChangeHandler,
            ) => {
              if (
                type === "postgres_changes" &&
                filter.table === "chat_messages"
              ) {
                server.bindings.push({ filter: filter.filter, handler });
              }
              return fake;
            },
          ),
          subscribe: vi.fn((cb?: (status: SubscribeStatus) => void) => {
            server.status = cb ?? null;
            return fake;
          }),
          send: vi.fn(),
          track: vi.fn(),
          unsubscribe: vi.fn(async () => "ok"),
          teardown: vi.fn(() => {
            fakes.delete(topic);
            byTopic.delete(topic);
          }),
        };
        byTopic.set(topic, server);
        fakes.set(topic, fake);
        return fake;
      },
    ),
    getChannels: vi.fn(() => [...fakes.values()]),
    removeChannel: vi.fn(
      async (ch: {
        unsubscribe: () => Promise<string>;
        teardown: () => void;
      }) => {
        const status = await ch.unsubscribe();
        if (status === "ok") ch.teardown();
        return status;
      },
    ),
  } as unknown as SupabaseClient;

  const channel = (topic: string): ServerChannel => {
    const found = byTopic.get(topic);
    if (!found) throw new Error(`no channel on ${topic}`);
    return found;
  };

  return {
    supabase,
    rows,
    /** The channel has joined. Without `wait`, that is what `SUBSCRIBED` reports. */
    join(topic: string) {
      const ch = channel(topic);
      if (ch.wait) ch.joinedNotReported = true;
      else ch.status?.("SUBSCRIBED");
    },
    /** The replication behind the channel is live. With `wait`, `SUBSCRIBED` now. */
    startStreaming(topic: string) {
      const ch = channel(topic);
      ch.streaming = true;
      if (ch.joinedNotReported) {
        ch.joinedNotReported = false;
        ch.status?.("SUBSCRIBED");
      }
    },
    /** A message is written; each streaming channel whose filter matches gets it. */
    insert(row: RawChatMessage) {
      rows.push(row);
      for (const ch of byTopic.values()) {
        if (!ch.streaming) continue;
        for (const b of ch.bindings) {
          if (b.filter && b.filter !== `channel_id=eq.${row.channel_id}`)
            continue;
          b.handler({ eventType: "INSERT", new: row });
        }
      }
    },
  };
}

const message = (id: string, channelId: string): RawChatMessage => ({
  id,
  channel_id: channelId,
  sender_id: "someone-else",
  author_name: null,
  author_avatar_path: null,
  author_external_id: null,
  created_at: "2026-11-15T00:00:00.000Z",
  client_message_id: null,
});

const flush = async () => {
  for (let i = 0; i < 5; i++) await Promise.resolve();
};

describe("ChatRealtimeManager — SUBSCRIBED means streaming (#5022)", () => {
  let server: ReturnType<typeof makeServer>;
  let queryClient: QueryClient;
  let activity: ReturnType<typeof vi.fn<(a: MessageActivity) => void>>;

  beforeEach(() => {
    window.localStorage.clear();
    server = makeServer();
    queryClient = new QueryClient();
    activity = vi.fn<(a: MessageActivity) => void>();
    // The gap-recovery read sees what the database holds when it is made.
    const backfill = vi.fn(async (channelId: string) =>
      server.rows.filter((r) => r.channel_id === channelId),
    ) as unknown as BackfillFetcher;
    chatRealtime.configure({
      queryClient,
      supabase: server.supabase,
      backfill,
      onMessageActivity: activity,
    });
  });

  afterEach(() => {
    chatRealtime.destroy();
    queryClient.clear();
  });

  test("a thread gets a message written after its join and before its stream is live", async () => {
    chatRealtime.subscribe("c1");
    await flush();
    const topic = "chat:channel:c1";

    server.join(topic);
    await flush();
    server.insert(message("in-the-gap", "c1"));
    server.startStreaming(topic);
    await flush();
    server.insert(message("after", "c1"));
    await flush();

    const cache = queryClient.getQueryData<ChannelCache>(chatMessagesKey("c1"));
    expect(Object.keys(cache?.byId ?? {}).sort()).toEqual([
      "after",
      "in-the-gap",
    ]);
  });

  test("the inbox reports `joined` only once a message written after its join would be reported", async () => {
    const timeline: string[] = [];
    activity.mockImplementation((a) => {
      timeline.push(a.type === "message" ? `reported ${a.channelId}` : a.type);
    });
    const write = (id: string) => {
      timeline.push(`wrote ${id}`);
      server.insert(message(id, id));
    };
    await flush();

    server.join(INBOX_TOPIC);
    await flush();
    write("in-the-gap");
    server.startStreaming(INBOX_TOPIC);
    await flush();
    write("after");
    await flush();

    // A message the stream never carried lands before `joined`, so the
    // re-read `joined` can trigger (#4961) covers it; everything after
    // `joined` arrives as activity.
    expect(timeline).toEqual([
      "wrote in-the-gap",
      "joined",
      "wrote after",
      "reported after",
    ]);
  });
});
