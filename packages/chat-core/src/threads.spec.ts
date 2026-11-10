import { describe, expect, test, vi } from "vitest";
import { QueryClient } from "@tanstack/react-query";
import {
  applyThreadRealtimeRow,
  chatThreadRepliesKey,
  sendThreadReply,
  threadChipLabel,
} from "./threads";
import { emptyCache } from "./cache";
import type { ChannelCache, RawChatMessage } from "./types";
import type { FrappApiClient } from "./chat-client";

const CH = "channel-1";
const ROOT = "root-1";

function reply(
  id: string,
  extra: Partial<RawChatMessage> = {},
): RawChatMessage {
  return {
    id,
    channel_id: CH,
    sender_id: "user-2",
    kind: "text",
    content: `reply ${id}`,
    thread_root_id: ROOT,
    created_at: "2026-11-10T12:00:00.000Z",
    ...extra,
  } as RawChatMessage;
}

function cacheOf(queryClient: QueryClient): ChannelCache | undefined {
  return queryClient.getQueryData<ChannelCache>(chatThreadRepliesKey(CH, ROOT));
}

describe("threadChipLabel (#3785)", () => {
  const now = Date.parse("2026-11-10T12:00:00.000Z");
  test("counts replies and says how long ago the last one was", () => {
    expect(threadChipLabel(1, "2026-11-10T11:55:00.000Z", now)).toEqual({
      replies: "1 reply",
      lastReply: "last reply 5m ago",
    });
    expect(threadChipLabel(3, "2026-11-10T09:00:00.000Z", now)).toEqual({
      replies: "3 replies",
      lastReply: "last reply 3h ago",
    });
    expect(threadChipLabel(2, null, now).lastReply).toBeNull();
    expect(threadChipLabel(2, "2026-11-10T11:59:40.000Z", now).lastReply).toBe(
      "last reply just now",
    );
  });
});

describe("applyThreadRealtimeRow (#3785)", () => {
  test("merges this thread's INSERT once the first read has landed", () => {
    const queryClient = new QueryClient();
    applyThreadRealtimeRow(queryClient, CH, ROOT, reply("a"), "INSERT");
    expect(cacheOf(queryClient)).toBeUndefined();

    queryClient.setQueryData(chatThreadRepliesKey(CH, ROOT), emptyCache());
    applyThreadRealtimeRow(queryClient, CH, ROOT, reply("a"), "INSERT");
    applyThreadRealtimeRow(queryClient, CH, ROOT, reply("a"), "INSERT");
    applyThreadRealtimeRow(
      queryClient,
      CH,
      ROOT,
      reply("b", { thread_root_id: "other-root" }),
      "INSERT",
    );
    expect(cacheOf(queryClient)?.order).toEqual(["a"]);
  });

  test("an UPDATE touches only a reply the cache holds", () => {
    const queryClient = new QueryClient();
    queryClient.setQueryData(chatThreadRepliesKey(CH, ROOT), emptyCache());
    applyThreadRealtimeRow(queryClient, CH, ROOT, reply("a"), "INSERT");
    applyThreadRealtimeRow(
      queryClient,
      CH,
      ROOT,
      reply("a", { content: "edited" }),
      "UPDATE",
    );
    applyThreadRealtimeRow(queryClient, CH, ROOT, reply("z"), "UPDATE");
    expect(cacheOf(queryClient)?.order).toEqual(["a"]);
    expect(cacheOf(queryClient)?.byId.a?.content).toBe("edited");
  });
});

describe("sendThreadReply (#3785)", () => {
  test("posts with thread_root_id and replaces the optimistic row", async () => {
    const queryClient = new QueryClient();
    const POST = vi.fn(
      async (_path: string, init: { body: { client_message_id: string } }) => ({
        data: {
          message: reply("server-1", {
            client_message_id: init.body.client_message_id,
            sender_id: "me",
          }),
        },
        error: undefined,
      }),
    );
    const api = { POST } as unknown as FrappApiClient;
    const result = await sendThreadReply(queryClient, api, {
      channelId: CH,
      rootId: ROOT,
      senderId: "me",
      content: "hello",
    });
    expect(result.error).toBeNull();
    expect(POST.mock.calls[0]?.[1]).toMatchObject({
      body: { content: "hello", thread_root_id: ROOT },
    });
    expect(cacheOf(queryClient)?.order).toEqual(["server-1"]);
  });

  test("a refusal leaves the row failed with the reason", async () => {
    const queryClient = new QueryClient();
    const api = {
      POST: vi.fn(async () => ({
        data: undefined,
        error: { message: "No posting here" },
        response: { status: 403 },
      })),
    } as unknown as FrappApiClient;
    const result = await sendThreadReply(queryClient, api, {
      channelId: CH,
      rootId: ROOT,
      senderId: "me",
      content: "hello",
      clientMessageId: "client-1",
    });
    expect(result.error).toBeTruthy();
    const row = cacheOf(queryClient)?.byId["client-1"];
    expect(row?._status).toBe("failed");
    expect(row?.thread_root_id).toBe(ROOT);
  });
});
