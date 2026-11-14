import { describe, expect, test, vi } from "vitest";
import { QueryClient } from "@tanstack/react-query";
import {
  applyThreadRealtimeRow,
  backfillThreadReplies,
  chatThreadRepliesKey,
  fetchThread,
  fetchThreadUnread,
  loadThreadReplies,
  outgoingGifOf,
  sendThreadReply,
  threadCardLabel,
  threadChipLabel,
  threadPreviewParts,
  threadVersion,
} from "./threads";
import { emptyCache } from "./cache";
import type { ChannelCache, ChatMessage, RawChatMessage } from "./types";
import { normalizeRow } from "./types";
import type { FrappApiClient } from "./chat-client";
import type { SupabaseClient } from "@supabase/supabase-js";

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

const versionRow = (id: string, last_reply_at: string | null | undefined) =>
  ({
    id,
    thread:
      last_reply_at === undefined
        ? null
        : { reply_count: 1, last_reply_at, recent_sender_ids: [] },
  }) as ChatMessage;

describe("threadVersion (#4297)", () => {
  test("is empty when no loaded message has a thread, so nothing is read", () => {
    expect(threadVersion([versionRow("a", undefined)])).toBe("");
  });

  test("changes when a parent's last reply moves, and only then", () => {
    const before = [
      versionRow("a", "2026-11-11T20:00:00Z"),
      versionRow("b", undefined),
    ];
    const after = [
      versionRow("a", "2026-11-11T20:05:00Z"),
      versionRow("b", undefined),
    ];
    expect(threadVersion([...before])).toBe(threadVersion(before));
    expect(threadVersion(after)).not.toBe(threadVersion(before));
  });

  test("holds when an older page brings a thread with an older reply", () => {
    // The server's answer already covers every followed thread in the
    // channel, loaded or not, so an older page needs no read of its own.
    const one = [versionRow("a", "2026-11-11T20:00:00Z")];
    const two = [versionRow("z", "2026-11-10T09:00:00Z"), ...one];
    expect(threadVersion(two)).toBe(threadVersion(one));
  });

  test("leaves the open thread out, which re-reads on its own when read", () => {
    const before = [
      versionRow("a", "2026-11-11T20:00:00Z"),
      versionRow("open", "2026-11-11T20:01:00Z"),
    ];
    const after = [
      versionRow("a", "2026-11-11T20:00:00Z"),
      versionRow("open", "2026-11-11T20:09:00Z"),
    ];
    expect(threadVersion(after, "open")).toBe(threadVersion(before, "open"));
  });

  test("still reads when the open thread is the only one", () => {
    expect(
      threadVersion([versionRow("open", "2026-11-11T20:01:00Z")], "open"),
    ).toBe("-");
  });
});

describe("fetchThreadUnread (#4297)", () => {
  test("keys what's new by root, leaving out muted and caught-up threads", async () => {
    const GET = vi.fn(async () => ({
      data: [
        {
          thread_root_id: "a",
          state: "following",
          last_read_at: null,
          unread_count: 2,
        },
        {
          thread_root_id: "b",
          state: "following",
          last_read_at: "x",
          unread_count: 0,
        },
        {
          thread_root_id: "c",
          state: "muted",
          last_read_at: null,
          unread_count: 0,
        },
      ],
      error: undefined,
    }));
    const unread = await fetchThreadUnread(
      { GET } as unknown as FrappApiClient,
      "chan-1",
    );
    expect(unread).toEqual({ a: 2 });
    expect(GET).toHaveBeenCalledWith("/v1/channels/{id}/threads/followed", {
      params: { path: { id: "chan-1" } },
    });
  });

  test("throws when the read fails, so the query keeps its last answer", async () => {
    const GET = vi.fn(async () => ({
      data: undefined,
      error: { message: "no" },
    }));
    await expect(
      fetchThreadUnread({ GET } as unknown as FrappApiClient, "chan-1"),
    ).rejects.toThrow();
  });
});

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
  test("keeps an INSERT that lands before the first read, once", () => {
    const queryClient = new QueryClient();
    // The first read's snapshot may predate this row; dropping it lost it.
    applyThreadRealtimeRow(queryClient, CH, ROOT, reply("a"), "INSERT");
    expect(cacheOf(queryClient)?.order).toEqual(["a"]);
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

describe("backfillThreadReplies (#3785)", () => {
  test("pages back from the newest until it meets a held reply", async () => {
    const queryClient = new QueryClient();
    queryClient.setQueryData(chatThreadRepliesKey(CH, ROOT), emptyCache());
    applyThreadRealtimeRow(
      queryClient,
      CH,
      ROOT,
      reply("held", { created_at: "2026-11-10T10:00:00.000Z" }),
      "INSERT",
    );
    // 60 replies after it: one full page of the newest 50, then the 10 older.
    const after = Array.from({ length: 60 }, (_, i) =>
      reply(`n${String(i).padStart(2, "0")}`, {
        created_at: new Date(
          Date.parse("2026-11-10T11:00:00.000Z") + i * 1000,
        ).toISOString(),
      }),
    ).reverse();
    const GET = vi.fn(
      async (
        _path: string,
        init: { params: { query: { before?: string } } },
      ) => {
        const before = init.params.query.before;
        const page = before
          ? after.filter((r) => r.created_at < before).slice(0, 50)
          : after.slice(0, 50);
        return { data: page, error: undefined };
      },
    );
    await backfillThreadReplies(
      queryClient,
      { GET } as unknown as FrappApiClient,
      CH,
      ROOT,
    );
    expect(GET.mock.calls[0]?.[1]).toMatchObject({
      params: { query: { since: "held" } },
    });
    expect(cacheOf(queryClient)?.order).toHaveLength(61);
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

describe("a GIF as a thread reply (#4657)", () => {
  const GIF = {
    provider: "klipy",
    id: "g1",
    title: "wave",
    url: "https://static.klipy.com/g1.webp",
    width: 200,
    height: 150,
    token: "signed",
  };

  test("posts the GIF with its token and no text, drawn at once", async () => {
    const queryClient = new QueryClient();
    let seen: ChannelCache | undefined;
    const POST = vi.fn<
      (
        path: string,
        init: unknown,
      ) => Promise<{
        data: undefined;
        error: { message: string };
        response: { status: number };
      }>
    >(async () => {
      seen = cacheOf(queryClient);
      return {
        data: undefined,
        error: { message: "offline" },
        response: { status: 503 },
      };
    });
    const api = { POST } as unknown as FrappApiClient;
    await sendThreadReply(queryClient, api, {
      channelId: CH,
      rootId: ROOT,
      senderId: "me",
      content: "",
      gif: GIF,
      clientMessageId: "client-gif",
    });
    expect(POST.mock.calls[0]?.[1]).toMatchObject({
      body: {
        content: "",
        thread_root_id: ROOT,
        gif: {
          id: "g1",
          url: GIF.url,
          width: 200,
          height: 150,
          token: "signed",
        },
      },
    });
    expect(seen?.byId["client-gif"]?.gif?.url).toBe(GIF.url);
    // The failed row keeps the token, so Retry can send the GIF again.
    const failed = cacheOf(queryClient)?.byId["client-gif"];
    expect(outgoingGifOf(failed?.gif)).toEqual(GIF);
  });

  test("a confirmed GIF, which carries no token, is nothing to resend", () => {
    const stored = { ...GIF, token: undefined };
    expect(outgoingGifOf(stored)).toBeNull();
    expect(outgoingGifOf(undefined)).toBeNull();
  });
});

/**
 * A thread's reads bring the reactions and votes on what they read (#4034),
 * the way the timeline's pages do, so they show on first paint.
 */
describe("thread reads carry their actions (#4034)", () => {
  function supabaseWith(actions: unknown[], fail = false) {
    const range = vi.fn(async () =>
      fail
        ? { data: null, error: { message: "boom" }, count: null }
        : { data: actions, error: null, count: actions.length },
    );
    const inIds = vi.fn(() => ({ order: () => ({ range }) }));
    return {
      client: {
        from: vi.fn(() => ({ select: () => ({ in: inIds }) })),
      } as unknown as SupabaseClient,
      inIds,
    };
  }
  const thumbs = {
    id: "act-1",
    message_id: "a",
    user_id: "user-3",
    action_type: "reaction:👍",
    payload: {},
    created_at: "2026-11-10T12:01:00.000Z",
  };

  test("a page of replies lands with its reactions", async () => {
    const queryClient = new QueryClient();
    const api = {
      GET: vi.fn(async () => ({ data: [reply("a"), reply("b")], error: null })),
    } as unknown as FrappApiClient;
    const { client, inIds } = supabaseWith([thumbs]);

    await loadThreadReplies(queryClient, api, CH, ROOT, undefined, client);

    expect(inIds).toHaveBeenCalledWith("message_id", ["a", "b"]);
    expect(cacheOf(queryClient)?.byId["a"]?.reactions["reaction:👍"]).toEqual([
      "user-3",
    ]);
  });

  test("a failed action read still shows the replies", async () => {
    const queryClient = new QueryClient();
    const api = {
      GET: vi.fn(async () => ({ data: [reply("a")], error: null })),
    } as unknown as FrappApiClient;

    await loadThreadReplies(
      queryClient,
      api,
      CH,
      ROOT,
      undefined,
      supabaseWith([], true).client,
    );

    expect(cacheOf(queryClient)?.order).toEqual(["a"]);
  });

  test("an older page whose actions came back incomplete is refused", async () => {
    const queryClient = new QueryClient();
    const api = {
      GET: vi.fn(async () => ({ data: [reply("a")], error: null })),
    } as unknown as FrappApiClient;

    await expect(
      loadThreadReplies(
        queryClient,
        api,
        CH,
        ROOT,
        "2026-11-10T13:00:00.000Z",
        supabaseWith([thumbs], true).client,
      ),
    ).rejects.toThrow(/reactions and votes/);
    // Merged, it would never be read again.
    expect(cacheOf(queryClient)).toBeUndefined();
  });

  test("a gap read puts held replies' reactions right", async () => {
    const queryClient = new QueryClient();
    const api = {
      GET: vi.fn(async () => ({ data: [reply("a")], error: null })),
    } as unknown as FrappApiClient;
    await loadThreadReplies(
      queryClient,
      api,
      CH,
      ROOT,
      undefined,
      supabaseWith([thumbs]).client,
    );
    expect(cacheOf(queryClient)?.byId["a"]?.reactions["reaction:👍"]).toEqual([
      "user-3",
    ]);

    // During a gap user-3 took the 👍 back and user-4 added 🎉. The gap
    // read brings no new rows, and still reads the held reply's actions.
    const party = {
      ...thumbs,
      id: "act-2",
      user_id: "user-4",
      action_type: "reaction:🎉",
    };
    const gap = {
      GET: vi.fn(async () => ({ data: [], error: null })),
    } as unknown as FrappApiClient;
    const { client, inIds } = supabaseWith([party]);
    await backfillThreadReplies(queryClient, gap, CH, ROOT, client);

    expect(inIds).toHaveBeenCalledWith("message_id", ["a"]);
    expect(cacheOf(queryClient)!.byId["a"]!.reactions).toEqual({
      "reaction:🎉": ["user-4"],
    });
    expect(cacheOf(queryClient)!.actionIndex["act-1"]).toBeUndefined();
  });

  test("a gap read whose actions come back incomplete keeps what was held", async () => {
    const queryClient = new QueryClient();
    const api = {
      GET: vi.fn(async () => ({ data: [reply("a")], error: null })),
    } as unknown as FrappApiClient;
    await loadThreadReplies(
      queryClient,
      api,
      CH,
      ROOT,
      undefined,
      supabaseWith([thumbs]).client,
    );
    const gap = {
      GET: vi.fn(async () => ({ data: [], error: null })),
    } as unknown as FrappApiClient;

    await backfillThreadReplies(
      queryClient,
      gap,
      CH,
      ROOT,
      supabaseWith([], true).client,
    );

    expect(cacheOf(queryClient)?.byId["a"]?.reactions["reaction:👍"]).toEqual([
      "user-3",
    ]);
  });

  test("the parent comes back with its actions", async () => {
    const api = {
      GET: vi.fn(async () => ({
        data: { root: reply("root-1"), follow_state: null, last_read_at: null },
        error: null,
      })),
    } as unknown as FrappApiClient;
    const onRoot = { ...thumbs, message_id: "root-1" };

    const meta = await fetchThread(
      api,
      CH,
      ROOT,
      supabaseWith([onRoot]).client,
    );

    expect(meta.root_actions).toEqual([onRoot]);
  });
});

describe("threadPreviewParts and threadCardLabel (#4297)", () => {
  const names = {
    nameOf: (id: string) => (id === "u1" ? "Devin Okafor" : null),
    fallbackLabel: (id: string) => `Member ${id.slice(0, 6)}`,
  };
  const reply = (
    sender_id: string | null,
    content = "grill is in my **garage**",
  ) => ({
    id: "r1",
    sender_id,
    content,
    kind: "text" as const,
    attachment_count: 0,
    has_gif: false,
    created_at: "2026-11-11T20:00:00.000Z",
    sender_blocked: false,
  });

  test("names the replier by first name, the viewer as You, a stranger by the fallback", () => {
    expect(threadPreviewParts(reply("u1"), "me", names)).toEqual({
      name: "Devin",
      fullName: "Devin Okafor",
      text: "grill is in my garage",
    });
    expect(threadPreviewParts(reply("me"), "me", names).name).toBe("You");
    expect(threadPreviewParts(reply("2f4a1c99"), "me", names).name).toBe(
      "Member 2f4a1c",
    );
    expect(threadPreviewParts(reply(null), "me", names).name).toBeNull();
  });

  test("reads a file-only reply as its quote does", () => {
    expect(
      threadPreviewParts(
        { ...reply("u1", ""), attachment_count: 2 },
        null,
        names,
      ).text,
    ).toBe("2 attachments");
  });

  test("reads a GIF reply as GIF (#4657)", () => {
    // As the parent row carries it, through the defensive read.
    const parent = normalizeRow({
      ...reply("p0"),
      id: "p0",
      channel_id: CH,
      thread_reply_count: 1,
      thread_last_reply: { ...reply("u1", ""), has_gif: true },
    } as unknown as RawChatMessage);
    expect(parent.thread?.last_reply?.has_gif).toBe(true);
    expect(
      threadPreviewParts({ ...reply("u1", ""), has_gif: true }, null, names)
        .text,
    ).toBe("GIF");
  });

  test("says only what the card draws", () => {
    expect(
      threadCardLabel({
        replies: "3 replies",
        fresh: "2 new",
        lastReply: "last reply 5m ago",
        preview: { name: "Devin", text: "on my way" },
      }),
    ).toBe("3 replies, 2 new, last reply 5m ago, latest from Devin: on my way");
    expect(
      threadCardLabel({
        replies: "1 reply",
        fresh: null,
        lastReply: null,
        preview: { name: null, text: "hi" },
      }),
    ).toBe("1 reply, latest: hi");
  });
});
