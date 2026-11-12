import { describe, it, expect, vi, beforeEach } from "vitest";
import { QueryClient } from "@tanstack/react-query";
import {
  actOnCard,
  AttachmentsNotReadyError,
  classifyChatError,
  definitiveRefusalMessage,
  closePoll,
  deleteMessage,
  discardOutboxRow,
  editMessage,
  flushOutbox,
  hydrateOutboxIntoCache,
  insertLocalPlaceholder,
  markLocalRecorded,
  markLocalUnconfirmed,
  POSTED_OUTBOX_WARNING,
  RATE_LIMITED_COPY,
  react,
  removeLocalPlaceholder,
  retryOutboxRow,
  sendMessage,
  unreact,
  type ChatActionContext,
  type ChatErrorFn,
  type ToastFn,
} from "./chat-client";
import type { OutboxRow, OutboxStore } from "./adapters";
import {
  DURABLE_NOTICE_MARGIN_MS,
  persistNotice,
  readNotices,
  UNCONFIRMED_NOTICE_TTL_MS,
} from "./heavy-command-notices";
import { OUTBOX_ANALYTICS_EVENTS } from "./outbox-analytics";
import {
  assertContentFreeProperties,
  moduleDisabledMessage,
} from "@repo/validation";
import { memberFacingRefusal, POLLS_OFF_COPY } from "./polls";
import {
  chatMessagesKey,
  chatThreadRepliesKey,
  type ChannelCache,
} from "./types";
import { emptyCache, mergeServerRows, selectMessages } from "./cache";
import { memoryStore } from "./test/memory-store";
import { stubOutbox } from "./test/outbox-stub";
import {
  pointsReplay,
  recordedNotice,
  unconfirmedNotice,
} from "./test/notices";

/**
 * Covers #999: a rejected react/unreact must reach `ctx.onError`, the
 * platform-neutral sink mobile relies on since it supplies no `toast`.
 * `toast` must keep firing unchanged (web's mechanism) — this is additive,
 * not a replacement.
 */

function buildCtx(overrides: Partial<ChatActionContext>): ChatActionContext {
  return {
    queryClient: new QueryClient(),
    apiClient: { POST: vi.fn() } as unknown as ChatActionContext["apiClient"],
    supabase: {
      from: vi.fn(),
    } as unknown as ChatActionContext["supabase"],
    userId: "user-1",
    outbox: {} as OutboxStore,
    ...overrides,
  };
}

describe("react", () => {
  let toast: ToastFn;
  let onError: ChatErrorFn;

  beforeEach(() => {
    toast = vi.fn() as ToastFn;
    onError = vi.fn() as ChatErrorFn;
  });

  it("calls neither toast nor onError on success", async () => {
    const apiClient = {
      POST: vi.fn().mockResolvedValue({
        data: { action: { id: "act-1", message_id: "msg-1" } },
        error: null,
        response: { status: 201 },
      }),
    };
    const ctx = buildCtx({
      apiClient: apiClient as unknown as ChatActionContext["apiClient"],
      toast,
      onError,
    });

    await react(ctx, { channelId: "chan-1", messageId: "msg-1", emoji: "👍" });

    expect(toast).not.toHaveBeenCalled();
    expect(onError).not.toHaveBeenCalled();
  });

  it("fires both toast and onError, with the same message, on a rejected reaction", async () => {
    const apiClient = {
      POST: vi.fn().mockResolvedValue({
        data: null,
        error: { message: "Channel is read-only" },
        response: { status: 403 },
      }),
    };
    const ctx = buildCtx({
      apiClient: apiClient as unknown as ChatActionContext["apiClient"],
      toast,
      onError,
    });

    await react(ctx, { channelId: "chan-1", messageId: "msg-1", emoji: "👍" });

    expect(toast).toHaveBeenCalledWith(
      expect.objectContaining({
        title: "Couldn't react",
        description: "Your role can't do this. Ask an officer if you need it.",
      }),
    );
    expect(onError).toHaveBeenCalledWith({
      title: "Couldn't react",
      description: "Your role can't do this. Ask an officer if you need it.",
    });
  });

  it("still fires onError when no toast is supplied (the mobile shape)", async () => {
    const apiClient = {
      POST: vi.fn().mockResolvedValue({
        data: null,
        error: { message: "Channel is read-only" },
        response: { status: 403 },
      }),
    };
    const ctx = buildCtx({
      apiClient: apiClient as unknown as ChatActionContext["apiClient"],
      onError,
    });

    await react(ctx, { channelId: "chan-1", messageId: "msg-1", emoji: "👍" });

    expect(onError).toHaveBeenCalledTimes(1);
  });

  it("is a no-op with no userId, and never calls onError", async () => {
    const apiClient = { POST: vi.fn() };
    const ctx = buildCtx({
      apiClient: apiClient as unknown as ChatActionContext["apiClient"],
      userId: null,
      onError,
    });

    await react(ctx, { channelId: "chan-1", messageId: "msg-1", emoji: "👍" });

    expect(apiClient.POST).not.toHaveBeenCalled();
    expect(onError).not.toHaveBeenCalled();
  });
});

describe("unreact", () => {
  let toast: ToastFn;
  let onError: ChatErrorFn;

  beforeEach(() => {
    toast = vi.fn() as ToastFn;
    onError = vi.fn() as ChatErrorFn;
  });

  function buildSupabase(error: unknown) {
    return {
      from: vi.fn().mockReturnValue({
        delete: vi.fn().mockReturnValue({
          match: vi.fn().mockResolvedValue({ error }),
        }),
      }),
    };
  }

  it("calls neither toast nor onError on success", async () => {
    const ctx = buildCtx({
      supabase: buildSupabase(null) as unknown as ChatActionContext["supabase"],
      toast,
      onError,
    });

    await unreact(ctx, {
      channelId: "chan-1",
      messageId: "msg-1",
      emoji: "👍",
    });

    expect(toast).not.toHaveBeenCalled();
    expect(onError).not.toHaveBeenCalled();
  });

  it("fires both toast and onError, with the same message, on a rejected removal", async () => {
    const ctx = buildCtx({
      supabase: buildSupabase({
        message: "Row not found",
      }) as unknown as ChatActionContext["supabase"],
      toast,
      onError,
    });

    await unreact(ctx, {
      channelId: "chan-1",
      messageId: "msg-1",
      emoji: "👍",
    });

    expect(toast).toHaveBeenCalledWith(
      expect.objectContaining({
        title: "Couldn't remove reaction",
        description:
          "Couldn't reach Frapp. Check your connection and try again.",
      }),
    );
    expect(onError).toHaveBeenCalledWith({
      title: "Couldn't remove reaction",
      description: "Couldn't reach Frapp. Check your connection and try again.",
    });
  });

  it("still fires onError when no toast is supplied (the mobile shape)", async () => {
    const ctx = buildCtx({
      supabase: buildSupabase({
        message: "Row not found",
      }) as unknown as ChatActionContext["supabase"],
      onError,
    });

    await unreact(ctx, {
      channelId: "chan-1",
      messageId: "msg-1",
      emoji: "👍",
    });

    expect(onError).toHaveBeenCalledTimes(1);
  });
});

describe("editMessage", () => {
  let toast: ToastFn;
  let onError: ChatErrorFn;

  beforeEach(() => {
    toast = vi.fn() as ToastFn;
    onError = vi.fn() as ChatErrorFn;
  });

  it("calls neither toast nor onError, and merges the server row into the cache, on success", async () => {
    const queryClient = new QueryClient();
    const apiClient = {
      PATCH: vi.fn().mockResolvedValue({
        data: {
          id: "msg-1",
          channel_id: "chan-1",
          sender_id: "user-1",
          content: "edited body",
          created_at: "2026-01-01T00:00:00.000Z",
          edited_at: "2026-01-01T00:01:00.000Z",
        },
        error: null,
        response: { status: 200 },
      }),
    };
    // The row being edited is on screen, so the cache holds it.
    queryClient.setQueryData(
      chatMessagesKey("chan-1"),
      mergeServerRows(emptyCache(), [
        {
          id: "msg-1",
          channel_id: "chan-1",
          sender_id: "user-1",
          content: "original body",
          created_at: "2026-01-01T00:00:00.000Z",
        },
      ]),
    );
    const ctx = buildCtx({
      apiClient: apiClient as unknown as ChatActionContext["apiClient"],
      queryClient,
      toast,
      onError,
    });

    await editMessage(ctx, {
      channelId: "chan-1",
      messageId: "msg-1",
      content: "edited body",
    });

    expect(toast).not.toHaveBeenCalled();
    expect(onError).not.toHaveBeenCalled();
    expect(apiClient.PATCH).toHaveBeenCalledWith(
      "/v1/channels/messages/{messageId}",
      expect.objectContaining({
        params: { path: { messageId: "msg-1" } },
        body: { content: "edited body" },
      }),
    );
    const cache = queryClient.getQueryData(chatMessagesKey("chan-1")) as
      ReturnType<typeof emptyCache> | undefined;
    expect(cache?.byId["msg-1"]?.content).toBe("edited body");
    expect(cache?.byId["msg-1"]?.edited_at).toBe("2026-01-01T00:01:00.000Z");
  });

  it("never splices in a row the window doesn't hold, which would break older-page paging (#2775)", async () => {
    const queryClient = new QueryClient();
    // The window holds only a newer message; the edited one is older than it.
    queryClient.setQueryData(
      chatMessagesKey("chan-1"),
      mergeServerRows(emptyCache(), [
        {
          id: "msg-new",
          channel_id: "chan-1",
          sender_id: "user-2",
          content: "newest",
          created_at: "2026-02-01T00:00:00.000Z",
        },
      ]),
    );
    const apiClient = {
      PATCH: vi.fn().mockResolvedValue({
        data: {
          id: "msg-old",
          channel_id: "chan-1",
          sender_id: "user-1",
          content: "edited body",
          created_at: "2026-01-01T00:00:00.000Z",
          edited_at: "2026-02-02T00:00:00.000Z",
        },
        error: null,
        response: { status: 200 },
      }),
    };
    const ctx = buildCtx({
      apiClient: apiClient as unknown as ChatActionContext["apiClient"],
      queryClient,
      toast,
      onError,
    });

    await editMessage(ctx, {
      channelId: "chan-1",
      messageId: "msg-old",
      content: "edited body",
    });

    const cache = queryClient.getQueryData(
      chatMessagesKey("chan-1"),
    ) as ChannelCache;
    expect(cache.order).toEqual(["msg-new"]);
    expect(cache.byId["msg-old"]).toBeUndefined();
  });

  it("rejects rather than crash-toasting when the response carries no error but no body either", async () => {
    // The OpenAPI contract for this route documents no response schema
    // (`"200": {"description": ""}`), so nothing guarantees the client
    // always gets a parsed row back even on a genuine success — this is
    // the same `!data` guard `sendMessage`/`react`/`actOnCard` already use
    // before touching `data`.
    const apiClient = {
      PATCH: vi.fn().mockResolvedValue({
        data: undefined,
        error: null,
        response: { status: 200 },
      }),
    };
    const ctx = buildCtx({
      apiClient: apiClient as unknown as ChatActionContext["apiClient"],
      toast,
      onError,
    });

    await expect(
      editMessage(ctx, {
        channelId: "chan-1",
        messageId: "msg-1",
        content: "edited body",
      }),
    ).rejects.toThrow();

    expect(toast).toHaveBeenCalledWith(
      expect.objectContaining({ title: "Couldn't edit message" }),
    );
  });

  it("fires both toast and onError, with the same message, and rejects on a denied edit", async () => {
    const apiClient = {
      PATCH: vi.fn().mockResolvedValue({
        data: null,
        error: { message: "You can only edit your own messages" },
        response: { status: 403 },
      }),
    };
    const ctx = buildCtx({
      apiClient: apiClient as unknown as ChatActionContext["apiClient"],
      toast,
      onError,
    });

    await expect(
      editMessage(ctx, {
        channelId: "chan-1",
        messageId: "msg-1",
        content: "edited body",
      }),
    ).rejects.toThrow();

    expect(toast).toHaveBeenCalledWith(
      expect.objectContaining({
        title: "Couldn't edit message",
        description: "You can only edit your own messages.",
      }),
    );
    expect(onError).toHaveBeenCalledWith({
      title: "Couldn't edit message",
      description: "You can only edit your own messages.",
    });
  });

  // A ValidationPipe 400 carries `message` as an array of field-named lines,
  // written for a developer: the member reads the shared map's words instead
  // (principles.md P2.3).
  it("never shows a validation refusal's field-named reasons", async () => {
    const apiClient = {
      PATCH: vi.fn().mockResolvedValue({
        data: null,
        error: {
          statusCode: 400,
          error: "Bad Request",
          message: ["content must be shorter than or equal to 4000 characters"],
        },
        response: { status: 400 },
      }),
    };
    const ctx = buildCtx({
      apiClient: apiClient as unknown as ChatActionContext["apiClient"],
      toast,
      onError,
    });

    await expect(
      editMessage(ctx, {
        channelId: "chan-1",
        messageId: "msg-1",
        content: "edited body",
      }),
    ).rejects.toThrow();

    expect(toast).toHaveBeenCalledWith(
      expect.objectContaining({
        title: "Couldn't edit message",
        description: "Try again in a moment.",
      }),
    );
  });

  it("is a no-op with no userId, and never calls onError", async () => {
    const apiClient = { PATCH: vi.fn() };
    const ctx = buildCtx({
      apiClient: apiClient as unknown as ChatActionContext["apiClient"],
      userId: null,
      onError,
    });

    await editMessage(ctx, {
      channelId: "chan-1",
      messageId: "msg-1",
      content: "edited body",
    });

    expect(apiClient.PATCH).not.toHaveBeenCalled();
    expect(onError).not.toHaveBeenCalled();
  });
});

describe("closePoll (#3794)", () => {
  let toast: ToastFn;
  let onError: ChatErrorFn;

  const openCard = {
    question: "Who is driving Saturday?",
    options: [
      { id: "a", label: "Me" },
      { id: "b", label: "Not me" },
    ],
    closes_at: "2999-01-01T00:00:00.000Z",
  };

  beforeEach(() => {
    toast = vi.fn() as ToastFn;
    onError = vi.fn() as ChatErrorFn;
  });

  it("posts the close and merges the closed card into the cache before any Realtime echo", async () => {
    const queryClient = new QueryClient();
    queryClient.setQueryData(
      chatMessagesKey("chan-1"),
      mergeServerRows(emptyCache(), [
        {
          id: "msg-1",
          channel_id: "chan-1",
          sender_id: "user-1",
          content: openCard.question,
          kind: "poll",
          payload: openCard,
          created_at: "2026-01-01T00:00:00.000Z",
        },
      ]),
    );
    const apiClient = {
      POST: vi.fn().mockResolvedValue({
        data: {
          id: "msg-1",
          channel_id: "chan-1",
          sender_id: "user-1",
          content: openCard.question,
          kind: "poll",
          payload: {
            ...openCard,
            closed_at: "2026-06-01T00:00:00.000Z",
            closed_by: "user-1",
          },
          created_at: "2026-01-01T00:00:00.000Z",
        },
        error: null,
        response: { status: 201 },
      }),
    };
    const ctx = buildCtx({
      apiClient: apiClient as unknown as ChatActionContext["apiClient"],
      queryClient,
      toast,
      onError,
    });

    await closePoll(ctx, { channelId: "chan-1", messageId: "msg-1" });

    expect(apiClient.POST).toHaveBeenCalledWith("/v1/polls/{messageId}/close", {
      params: { path: { messageId: "msg-1" } },
    });
    expect(toast).not.toHaveBeenCalled();
    const cache = queryClient.getQueryData(chatMessagesKey("chan-1")) as
      ReturnType<typeof emptyCache> | undefined;
    expect(
      (cache?.byId["msg-1"]?.payload as { closed_at?: string })?.closed_at,
    ).toBe("2026-06-01T00:00:00.000Z");
  });

  it("toasts, reports and rejects when the server refuses", async () => {
    const apiClient = {
      POST: vi.fn().mockResolvedValue({
        data: null,
        error: {
          message:
            "Only the poll creator or a member who manages channels can close it",
        },
        response: { status: 403 },
      }),
    };
    const ctx = buildCtx({
      apiClient: apiClient as unknown as ChatActionContext["apiClient"],
      toast,
      onError,
    });

    await expect(
      closePoll(ctx, { channelId: "chan-1", messageId: "msg-1" }),
    ).rejects.toThrow();
    expect(toast).toHaveBeenCalledWith(
      expect.objectContaining({ title: "Couldn't close poll" }),
    );
    expect(onError).toHaveBeenCalledWith(
      expect.objectContaining({ title: "Couldn't close poll" }),
    );
  });

  it("is a no-op with no userId", async () => {
    const apiClient = { POST: vi.fn() };
    const ctx = buildCtx({
      apiClient: apiClient as unknown as ChatActionContext["apiClient"],
      userId: null,
    });

    await closePoll(ctx, { channelId: "chan-1", messageId: "msg-1" });

    expect(apiClient.POST).not.toHaveBeenCalled();
  });
});

describe("deleteMessage", () => {
  let toast: ToastFn;
  let onError: ChatErrorFn;

  beforeEach(() => {
    toast = vi.fn() as ToastFn;
    onError = vi.fn() as ChatErrorFn;
  });

  it("calls neither toast nor onError, and merges the deleted server row into the cache, on success", async () => {
    const queryClient = new QueryClient();
    // A prior confirmed row, so the merge is provably an *update* rather
    // than the cache merely being seeded from nothing by `patchCache`'s
    // `emptyCache()` fallback.
    queryClient.setQueryData(
      chatMessagesKey("chan-1"),
      mergeServerRows(emptyCache(), [
        {
          id: "msg-1",
          channel_id: "chan-1",
          sender_id: "user-1",
          content: "hello",
          created_at: "2026-01-01T00:00:00.000Z",
        },
      ]),
    );
    const apiClient = {
      DELETE: vi.fn().mockResolvedValue({
        data: {
          id: "msg-1",
          channel_id: "chan-1",
          sender_id: "user-1",
          content: "[message deleted]",
          is_deleted: true,
          created_at: "2026-01-01T00:00:00.000Z",
        },
        error: null,
        response: { status: 200 },
      }),
    };
    const ctx = buildCtx({
      apiClient: apiClient as unknown as ChatActionContext["apiClient"],
      queryClient,
      toast,
      onError,
    });

    await deleteMessage(ctx, { channelId: "chan-1", messageId: "msg-1" });

    expect(toast).not.toHaveBeenCalled();
    expect(onError).not.toHaveBeenCalled();
    expect(apiClient.DELETE).toHaveBeenCalledWith(
      "/v1/channels/messages/{messageId}",
      expect.objectContaining({ params: { path: { messageId: "msg-1" } } }),
    );
    const cache = queryClient.getQueryData(chatMessagesKey("chan-1")) as
      ReturnType<typeof emptyCache> | undefined;
    expect(cache?.byId["msg-1"]?.is_deleted).toBe(true);
    expect(cache?.byId["msg-1"]?.content).toBe("[message deleted]");
  });

  it("rejects rather than crash-toasting when the response carries no error but no body either", async () => {
    const apiClient = {
      DELETE: vi.fn().mockResolvedValue({
        data: undefined,
        error: null,
        response: { status: 200 },
      }),
    };
    const ctx = buildCtx({
      apiClient: apiClient as unknown as ChatActionContext["apiClient"],
      toast,
      onError,
    });

    await expect(
      deleteMessage(ctx, { channelId: "chan-1", messageId: "msg-1" }),
    ).rejects.toThrow();

    expect(toast).toHaveBeenCalledWith(
      expect.objectContaining({ title: "Couldn't delete message" }),
    );
  });

  it("fires both toast and onError, with the same message, and rejects on a denied delete", async () => {
    const apiClient = {
      DELETE: vi.fn().mockResolvedValue({
        data: null,
        error: {
          message:
            "You can only delete your own messages unless you have channels:manage permission",
        },
        response: { status: 403 },
      }),
    };
    const ctx = buildCtx({
      apiClient: apiClient as unknown as ChatActionContext["apiClient"],
      toast,
      onError,
    });

    await expect(
      deleteMessage(ctx, { channelId: "chan-1", messageId: "msg-1" }),
    ).rejects.toThrow();

    expect(toast).toHaveBeenCalledWith(
      expect.objectContaining({ title: "Couldn't delete message" }),
    );
    expect(onError).toHaveBeenCalledWith(
      expect.objectContaining({ title: "Couldn't delete message" }),
    );
  });

  it("is a no-op with no userId, and never calls onError", async () => {
    const apiClient = { DELETE: vi.fn() };
    const ctx = buildCtx({
      apiClient: apiClient as unknown as ChatActionContext["apiClient"],
      userId: null,
      onError,
    });

    await deleteMessage(ctx, { channelId: "chan-1", messageId: "msg-1" });

    expect(apiClient.DELETE).not.toHaveBeenCalled();
    expect(onError).not.toHaveBeenCalled();
  });
});

describe("actOnCard", () => {
  let toast: ToastFn;
  let onError: ChatErrorFn;

  beforeEach(() => {
    toast = vi.fn() as ToastFn;
    onError = vi.fn() as ChatErrorFn;
  });

  it("calls neither toast nor onError on success", async () => {
    const apiClient = {
      POST: vi.fn().mockResolvedValue({
        data: { action: { id: "act-1", message_id: "msg-1" } },
        error: null,
        response: { status: 201 },
      }),
    };
    const ctx = buildCtx({
      apiClient: apiClient as unknown as ChatActionContext["apiClient"],
      toast,
      onError,
    });

    await actOnCard(ctx, {
      channelId: "chan-1",
      messageId: "msg-1",
      actionType: "vote",
      payload: { option_id: "opt-1" },
    });

    expect(toast).not.toHaveBeenCalled();
    expect(onError).not.toHaveBeenCalled();
  });

  it("gives a member their own copy when a vote is refused because Polls is off (#2993)", async () => {
    // The vote path feeds mobile's action-error banner (through onError) and
    // the web toast. Both must carry the member's row, not the guard's
    // sentence to an officer.
    const apiClient = {
      POST: vi.fn().mockResolvedValue({
        data: null,
        error: {
          code: "chapter.module.disabled",
          message: moduleDisabledMessage("polls"),
        },
        response: { status: 403 },
      }),
    };
    const ctx = buildCtx({
      apiClient: apiClient as unknown as ChatActionContext["apiClient"],
      toast,
      onError,
    });

    await actOnCard(ctx, {
      channelId: "chan-1",
      messageId: "msg-1",
      actionType: "vote",
      payload: { option_id: "opt-1" },
    });

    expect(toast).toHaveBeenCalledWith(
      expect.objectContaining({ description: POLLS_OFF_COPY }),
    );
    expect(onError).toHaveBeenCalledWith({
      title: "Couldn't record action",
      description: POLLS_OFF_COPY,
    });
  });

  it("fires both toast and onError, with the same message, on a rejected action", async () => {
    const apiClient = {
      POST: vi.fn().mockResolvedValue({
        data: null,
        error: { message: "Poll is closed" },
        response: { status: 409 },
      }),
    };
    const ctx = buildCtx({
      apiClient: apiClient as unknown as ChatActionContext["apiClient"],
      toast,
      onError,
    });

    await actOnCard(ctx, {
      channelId: "chan-1",
      messageId: "msg-1",
      actionType: "vote",
      payload: { option_id: "opt-1" },
    });

    expect(toast).toHaveBeenCalledWith(
      expect.objectContaining({
        title: "Couldn't record action",
        description: "Try again in a moment.",
      }),
    );
    expect(onError).toHaveBeenCalledWith({
      title: "Couldn't record action",
      description: "Try again in a moment.",
    });
  });

  it("still fires onError when no toast is supplied (the mobile shape)", async () => {
    const apiClient = {
      POST: vi.fn().mockResolvedValue({
        data: null,
        error: { message: "Poll is closed" },
        response: { status: 409 },
      }),
    };
    const ctx = buildCtx({
      apiClient: apiClient as unknown as ChatActionContext["apiClient"],
      onError,
    });

    await actOnCard(ctx, {
      channelId: "chan-1",
      messageId: "msg-1",
      actionType: "vote",
      payload: { option_id: "opt-1" },
    });

    expect(onError).toHaveBeenCalledTimes(1);
  });

  it("is a no-op with no userId, and never calls onError", async () => {
    const apiClient = { POST: vi.fn() };
    const ctx = buildCtx({
      apiClient: apiClient as unknown as ChatActionContext["apiClient"],
      userId: null,
      onError,
    });

    await actOnCard(ctx, {
      channelId: "chan-1",
      messageId: "msg-1",
      actionType: "vote",
      payload: { option_id: "opt-1" },
    });

    expect(apiClient.POST).not.toHaveBeenCalled();
    expect(onError).not.toHaveBeenCalled();
  });
});

const GIF_TO_SEND = {
  provider: "klipy",
  id: "dance",
  title: "Happy dance",
  url: "https://static.klipy.com/ii/a/dance.webp",
  width: 498,
  height: 280,
  token: "signed-token",
};

describe("sendMessage with a GIF (#4631)", () => {
  it("posts the GIF with its token, and no text", async () => {
    const apiClient = {
      POST: vi.fn().mockResolvedValue({
        data: { message: { id: "msg-1", client_message_id: "c-1" } },
        error: null,
        response: { status: 201 },
      }),
    };
    const outbox = stubOutbox();
    const ctx = buildCtx({
      apiClient: apiClient as unknown as ChatActionContext["apiClient"],
      outbox,
    });

    await sendMessage(ctx, {
      channelId: "chan-1",
      content: "",
      gif: GIF_TO_SEND,
    });

    const init = apiClient.POST.mock.calls[0]?.[1] as {
      body: { content: string; gif?: unknown };
    };
    expect(init.body.content).toBe("");
    expect(init.body.gif).toEqual({
      id: "dance",
      title: "Happy dance",
      url: GIF_TO_SEND.url,
      width: 498,
      height: 280,
      token: "signed-token",
    });
    // Queued with the GIF, so a flush or a retry resends it, not an empty text.
    expect(outbox.enqueue).toHaveBeenCalledWith(
      expect.objectContaining({ gif: GIF_TO_SEND }),
    );
  });
});

describe("outbox analytics", () => {
  it("emits queued then confirmed on a successful send, with an elapsed_ms property", async () => {
    const track = vi.fn();
    const apiClient = {
      POST: vi.fn().mockResolvedValue({
        data: { message: { id: "msg-1", client_message_id: "c-1" } },
        error: null,
        response: { status: 201 },
      }),
    };
    const ctx = buildCtx({
      apiClient: apiClient as unknown as ChatActionContext["apiClient"],
      outbox: stubOutbox(),
      track,
    });

    await sendMessage(ctx, { channelId: "chan-1", content: "hi" });

    expect(track).toHaveBeenNthCalledWith(
      1,
      OUTBOX_ANALYTICS_EVENTS.queued,
      expect.objectContaining({ channel_id: "chan-1" }),
    );
    expect(track).toHaveBeenNthCalledWith(
      2,
      OUTBOX_ANALYTICS_EVENTS.confirmed,
      expect.objectContaining({
        channel_id: "chan-1",
        elapsed_ms: expect.any(Number),
      }),
    );
  });

  it("emits failed-4xx (not failed-network) on a terminal rejection", async () => {
    const track = vi.fn();
    const apiClient = {
      POST: vi.fn().mockResolvedValue({
        data: null,
        error: { message: "Channel is read-only" },
        response: { status: 403 },
      }),
    };
    const ctx = buildCtx({
      apiClient: apiClient as unknown as ChatActionContext["apiClient"],
      outbox: stubOutbox(),
      track,
    });

    await sendMessage(ctx, { channelId: "chan-1", content: "hi" });

    expect(track).toHaveBeenCalledWith(
      OUTBOX_ANALYTICS_EVENTS.failedTerminal,
      expect.objectContaining({ channel_id: "chan-1", status: 403 }),
    );
    expect(track).not.toHaveBeenCalledWith(
      OUTBOX_ANALYTICS_EVENTS.failedTransient,
      expect.anything(),
    );
  });

  it("gives a member their own copy for the Polls refusal: toast, failed row and outbox (#2993)", async () => {
    // The module gate's sentence tells an officer to re-enable Polls in
    // Settings, which a member can't do. Every place chat-core surfaces the
    // server's message carries the member's row instead.
    const toast = vi.fn() as ToastFn;
    const outbox = stubOutbox();
    const apiClient = {
      POST: vi.fn().mockResolvedValue({
        data: null,
        error: {
          code: "chapter.module.disabled",
          message: moduleDisabledMessage("polls"),
        },
        response: { status: 403 },
      }),
    };
    const ctx = buildCtx({
      apiClient: apiClient as unknown as ChatActionContext["apiClient"],
      outbox,
      toast,
    });

    await sendMessage(ctx, {
      channelId: "chan-1",
      content: "Formal venue?",
      kind: "poll",
    });

    expect(toast).toHaveBeenCalledWith(
      expect.objectContaining({
        title: "Message rejected",
        description: POLLS_OFF_COPY,
      }),
    );
    expect(outbox.markFailed).toHaveBeenCalledWith(
      expect.any(String),
      POLLS_OFF_COPY,
    );
    const cache = ctx.queryClient.getQueryData<ChannelCache>(
      chatMessagesKey("chan-1"),
    );
    expect(selectMessages(cache!).map((m) => m._error)).toEqual([
      POLLS_OFF_COPY,
    ]);
  });

  it.each([
    ["the throttler's sentence", RATE_LIMITED_COPY],
    ["an intermediary's text", "Too Many Requests"],
  ])(
    "fails a throttled send (429 carrying %s) as not sent, with the rate-limit sentence, for the row's Retry (#3061)",
    async (_label, bodyMessage) => {
      const toast = vi.fn() as ToastFn;
      const outbox = stubOutbox();
      const apiClient = {
        POST: vi.fn().mockResolvedValue({
          data: null,
          error: { statusCode: 429, message: bodyMessage },
          response: { status: 429 },
        }),
      };
      const ctx = buildCtx({
        apiClient: apiClient as unknown as ChatActionContext["apiClient"],
        outbox,
        toast,
      });

      await sendMessage(ctx, { channelId: "chan-1", content: "on my way" });

      expect(toast).toHaveBeenCalledWith(
        expect.objectContaining({
          title: "Message not sent",
          description: RATE_LIMITED_COPY,
        }),
      );
      // Terminal, not left queued: the outbox flushes only on reconnect, so a
      // pending row would never resend while the member stays online.
      expect(outbox.markFailed).toHaveBeenCalledWith(
        expect.any(String),
        RATE_LIMITED_COPY,
      );
      expect(outbox.bumpAttempt).not.toHaveBeenCalled();
      const cache = ctx.queryClient.getQueryData<ChannelCache>(
        chatMessagesKey("chan-1"),
      );
      expect(selectMessages(cache!).map((m) => [m._status, m._error])).toEqual([
        ["failed", RATE_LIMITED_COPY],
      ]);
    },
  );

  it("emits failed-network (not failed-4xx) on a transient/network error", async () => {
    const track = vi.fn();
    const apiClient = {
      POST: vi.fn().mockRejectedValue(new Error("fetch failed")),
    };
    const ctx = buildCtx({
      apiClient: apiClient as unknown as ChatActionContext["apiClient"],
      outbox: stubOutbox(),
      track,
    });

    await sendMessage(ctx, { channelId: "chan-1", content: "hi" });

    expect(track).toHaveBeenCalledWith(
      OUTBOX_ANALYTICS_EVENTS.failedTransient,
      expect.objectContaining({ channel_id: "chan-1" }),
    );
    expect(track).not.toHaveBeenCalledWith(
      OUTBOX_ANALYTICS_EVENTS.failedTerminal,
      expect.anything(),
    );
  });

  it("emits retried when a failed row is retried, ahead of the resend's own queued/confirmed pair", async () => {
    const track = vi.fn();
    const apiClient = {
      POST: vi.fn().mockResolvedValue({
        data: { message: { id: "msg-1", client_message_id: "c-1" } },
        error: null,
        response: { status: 201 },
      }),
    };
    const ctx = buildCtx({
      apiClient: apiClient as unknown as ChatActionContext["apiClient"],
      outbox: stubOutbox(),
      track,
    });
    const row: OutboxRow = {
      clientId: "c-1",
      channelId: "chan-1",
      body: "hi",
      attempts: 2,
      status: "failed",
      queuedAt: Date.now() - 5000,
      lastError: "Couldn't reach chat server",
    };

    await retryOutboxRow(ctx, row);

    expect(track.mock.calls[0]).toEqual([
      OUTBOX_ANALYTICS_EVENTS.retried,
      { channel_id: "chan-1", attempts: 2 },
    ]);
    expect(track).toHaveBeenCalledWith(
      OUTBOX_ANALYTICS_EVENTS.queued,
      expect.objectContaining({ channel_id: "chan-1" }),
    );
  });

  it("carries the row's real prior-attempt count through a retry's own queued/confirmed events, not the outbox store's always-reset 0", async () => {
    // `enqueue()`'s return value always reports `attempts: 0` — every enqueue
    // is a fresh row write, including a retry's re-enqueue of the same
    // clientId — so `sendMessage` must use the caller-supplied `priorAttempts`
    // (threaded by `sendArgsFromOutbox`) rather than the outbox store's
    // reset-on-write value, or every resend's queued/confirmed/failed events
    // would silently under-report as attempt 0 no matter how many times the
    // message had actually failed before.
    const track = vi.fn();
    const apiClient = {
      POST: vi.fn().mockResolvedValue({
        data: { message: { id: "msg-1", client_message_id: "c-1" } },
        error: null,
        response: { status: 201 },
      }),
    };
    const ctx = buildCtx({
      apiClient: apiClient as unknown as ChatActionContext["apiClient"],
      outbox: stubOutbox(),
      track,
    });
    const row: OutboxRow = {
      clientId: "c-1",
      channelId: "chan-1",
      body: "hi",
      attempts: 2,
      status: "failed",
      queuedAt: Date.now() - 5000,
      lastError: "Couldn't reach chat server",
    };

    await retryOutboxRow(ctx, row);

    expect(track).toHaveBeenCalledWith(
      OUTBOX_ANALYTICS_EVENTS.queued,
      expect.objectContaining({ attempts: 2 }),
    );
    expect(track).toHaveBeenCalledWith(
      OUTBOX_ANALYTICS_EVENTS.confirmed,
      expect.objectContaining({ attempts: 2 }),
    );
  });

  it("emits discarded when a failed row is dropped", async () => {
    const track = vi.fn();
    const ctx = buildCtx({ outbox: stubOutbox(), track });
    const row: OutboxRow = {
      clientId: "c-1",
      channelId: "chan-1",
      body: "hi",
      attempts: 3,
      status: "failed",
      queuedAt: Date.now() - 5000,
      lastError: "Message rejected",
    };

    await discardOutboxRow(ctx, row);

    expect(track).toHaveBeenCalledWith(OUTBOX_ANALYTICS_EVENTS.discarded, {
      channel_id: "chan-1",
      attempts: 3,
    });
  });

  it("never carries a forbidden or non-scalar property across any outbox transition", async () => {
    // Runs every event-emitting path above through the same content-free
    // gate the API enforces server-side (`assertContentFreeProperties`), so
    // a future property added at a call site is caught locally rather than
    // discovered as a 400 from `POST /v1/analytics/events`.
    const events: Array<{
      name: string;
      properties?: Record<string, unknown>;
    }> = [];
    const track = (name: string, properties?: Record<string, unknown>) => {
      events.push({ name, properties });
    };

    const successApi = {
      POST: vi.fn().mockResolvedValue({
        data: { message: { id: "msg-1", client_message_id: "c-1" } },
        error: null,
        response: { status: 201 },
      }),
    };
    await sendMessage(
      buildCtx({
        apiClient: successApi as unknown as ChatActionContext["apiClient"],
        outbox: stubOutbox(),
        track,
      }),
      { channelId: "chan-1", content: "hello there" },
    );

    const rejectedApi = {
      POST: vi.fn().mockResolvedValue({
        data: null,
        error: { message: "Channel is read-only" },
        response: { status: 403 },
      }),
    };
    await sendMessage(
      buildCtx({
        apiClient: rejectedApi as unknown as ChatActionContext["apiClient"],
        outbox: stubOutbox(),
        track,
      }),
      { channelId: "chan-1", content: "hello there" },
    );

    const failedRow: OutboxRow = {
      clientId: "c-2",
      channelId: "chan-1",
      body: "a message body that must never appear above",
      attempts: 1,
      status: "failed",
      queuedAt: Date.now() - 1000,
      lastError: "Couldn't reach chat server",
    };
    await discardOutboxRow(
      buildCtx({ outbox: stubOutbox(), track }),
      failedRow,
    );

    expect(events.length).toBeGreaterThan(0);
    for (const event of events) {
      expect(() =>
        assertContentFreeProperties({
          name: event.name,
          distinctId: "test",
          properties: (event.properties ?? {}) as never,
        }),
      ).not.toThrow();
    }
  });
});

describe("hydrateOutboxIntoCache — recorded notices (#1789)", () => {
  it("does not seed an empty cache when there is nothing to restore", async () => {
    const queryClient = new QueryClient();
    const setSpy = vi.spyOn(queryClient, "setQueryData");
    await hydrateOutboxIntoCache(
      buildCtx({ queryClient, outbox: stubOutbox(), kv: memoryStore() }),
      "chan-1",
    );
    expect(setSpy).not.toHaveBeenCalled();
  });

  it("restores a recorded row when the outbox is empty", async () => {
    const kv = memoryStore();
    persistNotice(recordedNotice(), kv);
    const queryClient = new QueryClient();
    await hydrateOutboxIntoCache(
      buildCtx({ queryClient, outbox: stubOutbox(), kv }),
      "chan-1",
    );
    const cache = queryClient.getQueryData<ChannelCache>(
      chatMessagesKey("chan-1"),
    );
    const row = cache?.byId["cm-1"];
    expect(row?._status).toBe("recorded");
    expect(row?._replay).toBeUndefined();
    expect(row?._error).toMatch(/don't run this command again/i);
  });

  it("restores a Polls-refused row with the member's copy, even one persisted with the guard's sentence (#2993)", async () => {
    const queryClient = new QueryClient();
    const outbox = stubOutbox({
      listForChannel: vi.fn().mockResolvedValue([
        {
          clientId: "c-poll",
          channelId: "chan-1",
          body: "Formal venue?",
          kind: "poll",
          attempts: 1,
          status: "failed",
          queuedAt: Date.now() - 5000,
          lastError: moduleDisabledMessage("polls"),
        } satisfies OutboxRow,
      ]),
    });
    await hydrateOutboxIntoCache(
      buildCtx({ queryClient, outbox, kv: memoryStore() }),
      "chan-1",
    );
    const cache = queryClient.getQueryData<ChannelCache>(
      chatMessagesKey("chan-1"),
    );
    expect(cache?.byId["c-poll"]?._error).toBe(POLLS_OFF_COPY);
  });

  it("redraws a queued GIF as its GIF after a reload, not an empty bubble (#4631)", async () => {
    const queryClient = new QueryClient();
    const outbox = stubOutbox({
      listForChannel: vi.fn().mockResolvedValue([
        {
          clientId: "c-gif",
          channelId: "chan-1",
          body: "",
          attempts: 0,
          status: "queued",
          queuedAt: Date.now(),
          gif: GIF_TO_SEND,
        } satisfies OutboxRow,
      ]),
    });
    await hydrateOutboxIntoCache(buildCtx({ queryClient, outbox }), "chan-1");
    const cache = queryClient.getQueryData<ChannelCache>(
      chatMessagesKey("chan-1"),
    );
    expect(cache?.byId["c-gif"]?.gif?.url).toBe(GIF_TO_SEND.url);
  });

  it("does not upsert a pending twin next to an already-confirmed server row (#1718)", async () => {
    const queryClient = new QueryClient();
    queryClient.setQueryData(
      chatMessagesKey("chan-1"),
      mergeServerRows(emptyCache(), [
        {
          id: "msg-1",
          channel_id: "chan-1",
          sender_id: "user-1",
          content: "hi",
          kind: "text",
          client_message_id: "c-1",
          created_at: new Date().toISOString(),
        },
      ]),
    );
    const outbox = stubOutbox({
      listForChannel: vi.fn().mockResolvedValue([
        {
          clientId: "c-1",
          channelId: "chan-1",
          body: "hi",
          attempts: 0,
          status: "queued",
          queuedAt: Date.now(),
        },
      ]),
    });
    await hydrateOutboxIntoCache(buildCtx({ queryClient, outbox }), "chan-1");
    const rows = selectMessages(
      queryClient.getQueryData(chatMessagesKey("chan-1")),
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]?.id).toBe("msg-1");
    expect(rows[0]?._status).toBe("confirmed");
  });
});

describe("hydrateOutboxIntoCache — unconfirmed notices (#1909)", () => {
  it("restores the viewer's unconfirmed row with its Retry", async () => {
    const kv = memoryStore();
    persistNotice(unconfirmedNotice(), kv);
    const queryClient = new QueryClient();

    await hydrateOutboxIntoCache(
      buildCtx({ queryClient, outbox: stubOutbox(), kv }),
      "chan-1",
    );

    const row = queryClient.getQueryData<ChannelCache>(
      chatMessagesKey("chan-1"),
    )?.byId["cm-1"];
    expect(row?._status).toBe("unconfirmed");
    expect(row?._replay).toEqual(pointsReplay());
  });

  it("does not restore another member's unconfirmed row", async () => {
    const kv = memoryStore();
    persistNotice(unconfirmedNotice({ senderId: "user-9" }), kv);
    const queryClient = new QueryClient();

    await hydrateOutboxIntoCache(
      buildCtx({ queryClient, outbox: stubOutbox(), kv }),
      "chan-1",
    );

    const cache = queryClient.getQueryData<ChannelCache>(
      chatMessagesKey("chan-1"),
    );
    expect(cache?.byId["cm-1"]).toBeUndefined();
  });
});

/** A channel cache as a REST rebuild leaves it: present, placeholder gone. */
function rebuiltChannel(ctx: ChatActionContext): void {
  ctx.queryClient.setQueryData(chatMessagesKey("chan-1"), emptyCache());
}

describe("markLocalRecorded (#1789)", () => {
  it("upserts and persists when the placeholder was clobbered", () => {
    const kv = memoryStore();
    const ctx = buildCtx({ kv });
    rebuiltChannel(ctx);
    markLocalRecorded(ctx, {
      channelId: "chan-1",
      clientMessageId: "cm-1",
      note: "Points recorded — the chat card didn't post. Don't run this command again.",
      content: "Granting 5 points…",
    });
    const cache = ctx.queryClient.getQueryData<ChannelCache>(
      chatMessagesKey("chan-1"),
    );
    const row = cache?.byId["cm-1"];
    expect(row?._status).toBe("recorded");
    expect(row?._replay).toBeUndefined();
    expect(row?.content).toBe("Granting 5 points…");
    expect(readNotices("chan-1", "user-1", kv)).toEqual([
      expect.objectContaining({
        status: "recorded",
        clientMessageId: "cm-1",
        content: "Granting 5 points…",
      }),
    ]);
  });

  // With no channel query at all (garbage-collected mid-request), seeding one
  // would hand the channel a one-row cache that `staleTime: Infinity` never
  // refetches. The notice on disk restores the row on the next load.
  it("persists without seeding a cache for a channel that has none", () => {
    const kv = memoryStore();
    const ctx = buildCtx({ kv });
    markLocalRecorded(ctx, {
      channelId: "chan-1",
      clientMessageId: "cm-1",
      note: "Points recorded — the chat card didn't post. Don't run this command again.",
      content: "Granting 5 points…",
    });
    expect(
      ctx.queryClient.getQueryData(chatMessagesKey("chan-1")),
    ).toBeUndefined();
    expect(readNotices("chan-1", "user-1", kv)).toHaveLength(1);
  });

  // A replay's card re-post can fail after the ORIGINAL card already landed
  // (a reconnect refetch while the replay was in flight). The card is the
  // record; a "card missing" row beside it would contradict it.
  it("draws nothing beside a card that is already confirmed", () => {
    const kv = memoryStore();
    persistNotice(unconfirmedNotice(), kv);
    const ctx = buildCtx({ kv });
    ctx.queryClient.setQueryData(
      chatMessagesKey("chan-1"),
      mergeServerRows(emptyCache(), [
        {
          id: "server-1",
          channel_id: "chan-1",
          sender_id: "user-1",
          content: "+5 points",
          kind: "points",
          client_message_id: "cm-1",
          created_at: "2026-09-09T00:00:01.000Z",
        },
      ]),
    );

    markLocalRecorded(ctx, {
      channelId: "chan-1",
      clientMessageId: "cm-1",
      note: "Points recorded — the chat card didn't post. Don't run this command again.",
      content: "Granting 5 points…",
    });

    const rows = selectMessages(
      ctx.queryClient.getQueryData(chatMessagesKey("chan-1")),
    );
    expect(rows.map((row) => row._status)).toEqual(["confirmed"]);
    expect(readNotices("chan-1", "user-1", kv)).toEqual([]);
  });

  // A slow replay can land after the channel's cache was garbage-collected.
  // The stored notice still knows which grant it was and where it sat.
  it("keeps the stored content and timestamp when there is no live row", () => {
    const kv = memoryStore();
    const createdAt = new Date(Date.now() - 60_000).toISOString();
    persistNotice(unconfirmedNotice({ createdAt }), kv);
    const ctx = buildCtx({ kv });

    markLocalRecorded(ctx, {
      channelId: "chan-1",
      clientMessageId: "cm-1",
      note: "Points recorded — the chat card didn't post. Don't run this command again.",
    });

    expect(readNotices("chan-1", "user-1", kv)).toEqual([
      expect.objectContaining({
        status: "recorded",
        content: "Granting 5 points…",
        createdAt,
      }),
    ]);
  });
});

describe("markLocalUnconfirmed (#1909)", () => {
  const NOTE =
    "Not confirmed — these points may or may not have been recorded.";

  function placeholder(ctx: ChatActionContext): void {
    insertLocalPlaceholder(ctx, {
      channelId: "chan-1",
      clientMessageId: "cm-1",
      content: "Granting 5 points…",
    });
  }

  it("persists the row with the replay a Retry sends", () => {
    const kv = memoryStore();
    const ctx = buildCtx({ kv });
    placeholder(ctx);

    expect(markLocalUnconfirmed(ctx, pointsReplay(), NOTE)).toEqual({
      placement: "optimistic",
      durable: true,
    });

    expect(readNotices("chan-1", "user-1", kv)).toEqual([
      expect.objectContaining({
        status: "unconfirmed",
        clientMessageId: "cm-1",
        senderId: "user-1",
        content: "Granting 5 points…",
        note: NOTE,
        replay: pointsReplay(),
      }),
    ]);
  });

  // A reconnect refetch that raced the request already dropped the
  // placeholder. Reporting "no row" there left the officer nothing to press.
  it("redraws a placeholder a REST rebuild already dropped", () => {
    const kv = memoryStore();
    const ctx = buildCtx({ kv });
    placeholder(ctx);
    rebuiltChannel(ctx);

    const outcome = markLocalUnconfirmed(
      ctx,
      pointsReplay(),
      NOTE,
      "Granting 5 points…",
    );

    expect(outcome).toEqual({ placement: "optimistic", durable: true });
    const row = ctx.queryClient.getQueryData<ChannelCache>(
      chatMessagesKey("chan-1"),
    )?.byId["cm-1"];
    expect(row?._status).toBe("unconfirmed");
    expect(row?._replay).toEqual(pointsReplay());
    expect(row?.content).toBe("Granting 5 points…");
  });

  it("reports absent, and persists, when the channel has no cache to draw in", () => {
    const kv = memoryStore();
    const ctx = buildCtx({ kv });

    expect(markLocalUnconfirmed(ctx, pointsReplay(), NOTE)).toEqual({
      placement: "absent",
      durable: true,
    });
    expect(
      ctx.queryClient.getQueryData(chatMessagesKey("chan-1")),
    ).toBeUndefined();
    expect(readNotices("chan-1", "user-1", kv)).toHaveLength(1);
  });

  it("persists nothing without a viewer to attribute it to", () => {
    const kv = memoryStore();
    const ctx = buildCtx({ kv, userId: null });
    rebuiltChannel(ctx);

    expect(markLocalUnconfirmed(ctx, pointsReplay(), NOTE)).toEqual({
      placement: "absent",
      durable: false,
    });
    expect(readNotices("chan-1", "user-1", kv)).toEqual([]);
  });

  // The echo re-keyed the row: the write committed and carded. A replay's
  // stored handle is settled and must not come back on the next load.
  it("drops a stored handle when the card already confirmed the row", () => {
    const kv = memoryStore();
    persistNotice(unconfirmedNotice(), kv);
    const ctx = buildCtx({ kv });
    ctx.queryClient.setQueryData(
      chatMessagesKey("chan-1"),
      mergeServerRows(emptyCache(), [
        {
          id: "server-1",
          channel_id: "chan-1",
          sender_id: "user-1",
          content: "+5 points",
          kind: "points",
          client_message_id: "cm-1",
          created_at: "2026-09-09T00:00:01.000Z",
        },
      ]),
    );

    expect(markLocalUnconfirmed(ctx, pointsReplay(), NOTE).placement).toBe(
      "confirmed",
    );
    expect(readNotices("chan-1", "user-1", kv)).toEqual([]);
  });

  // A Retry pressed more than a day after the dispatch keeps the dispatch's
  // timestamp, so the next rebuild prunes the entry rather than restoring it.
  // Reporting it durable would promise a Retry that is about to vanish.
  // The reconnect that follows the outage comes within minutes, so an entry
  // that close to its bound is as good as pruned by it.
  it.each([
    ["past the age bound", UNCONFIRMED_NOTICE_TTL_MS + 60_000, false],
    [
      "inside the durability margin",
      UNCONFIRMED_NOTICE_TTL_MS - DURABLE_NOTICE_MARGIN_MS / 2,
      false,
    ],
    [
      "clear of the margin",
      UNCONFIRMED_NOTICE_TTL_MS - DURABLE_NOTICE_MARGIN_MS * 2,
      true,
    ],
  ])("reports a row %s as durable: %s", (_label, ageMs, durable) => {
    const kv = memoryStore();
    const ctx = buildCtx({ kv });
    placeholder(ctx);
    const key = chatMessagesKey("chan-1");
    const cache = ctx.queryClient.getQueryData<ChannelCache>(key)!;
    ctx.queryClient.setQueryData<ChannelCache>(key, {
      ...cache,
      byId: {
        ...cache.byId,
        "cm-1": {
          ...cache.byId["cm-1"]!,
          created_at: new Date(Date.now() - ageMs).toISOString(),
        },
      },
    });

    expect(markLocalUnconfirmed(ctx, pointsReplay(), NOTE)).toEqual({
      placement: "optimistic",
      durable,
    });
  });

  // Blocked or full storage: the row is on screen but only as durable as this
  // session's cache, and the caller must not promise it survives a reload.
  it("reports a row it could not persist as not durable", () => {
    const kv = memoryStore();
    const ctx = buildCtx({ kv: { ...kv, set: () => {} } });
    placeholder(ctx);

    expect(markLocalUnconfirmed(ctx, pointsReplay(), NOTE)).toEqual({
      placement: "optimistic",
      durable: false,
    });
  });
});

describe("removeLocalPlaceholder (#1909)", () => {
  // A resolved or spent retry clears its row through here; its handle has to
  // go with it, or the next rebuild restores a Retry for a settled request.
  it("drops the row's stored notice with it", () => {
    const kv = memoryStore();
    persistNotice(unconfirmedNotice(), kv);
    const ctx = buildCtx({ kv });

    removeLocalPlaceholder(ctx, "chan-1", "cm-1");

    expect(readNotices("chan-1", "user-1", kv)).toEqual([]);
  });
});

/**
 * #1718 — `clearDraft` / `enqueue` used to sit outside `sendMessage`'s try,
 * so a Dexie reject left a pending optimistic row and a thrown promise.
 * `dequeue` after a successful POST sat inside that try, so the same fault
 * then `markFailed` / `bumpAttempt`'d a message the server already accepted.
 */
describe("sendMessage — outbox faults (#1718)", () => {
  function onlySendRow(ctx: ChatActionContext) {
    const cache = ctx.queryClient.getQueryData<ChannelCache>(
      chatMessagesKey("chan-1"),
    );
    const rows = selectMessages(cache);
    expect(rows).toHaveLength(1);
    return rows[0]!;
  }

  it("removes the optimistic row and rethrows when enqueue rejects", async () => {
    const apiClient = { POST: vi.fn() };
    const outbox = stubOutbox({
      enqueue: vi.fn().mockRejectedValue(new Error("QuotaExceededError")),
    });
    const ctx = buildCtx({
      apiClient: apiClient as unknown as ChatActionContext["apiClient"],
      outbox,
    });

    await expect(
      sendMessage(ctx, { channelId: "chan-1", content: "hi" }),
    ).rejects.toThrow(/QuotaExceededError/);

    expect(apiClient.POST).not.toHaveBeenCalled();
    expect(
      selectMessages(ctx.queryClient.getQueryData(chatMessagesKey("chan-1"))),
    ).toHaveLength(0);
  });

  it("still posts when clearDraft rejects", async () => {
    const apiClient = {
      POST: vi.fn().mockResolvedValue({
        data: {
          message: {
            id: "msg-1",
            channel_id: "chan-1",
            sender_id: "user-1",
            content: "hi",
            kind: "text",
            client_message_id: "c-draft",
            created_at: new Date().toISOString(),
          },
        },
        error: null,
        response: { status: 201 },
      }),
    };
    const outbox = stubOutbox({
      clearDraft: vi.fn().mockRejectedValue(new Error("DatabaseClosedError")),
    });
    const ctx = buildCtx({
      apiClient: apiClient as unknown as ChatActionContext["apiClient"],
      outbox,
    });

    await expect(
      sendMessage(ctx, {
        channelId: "chan-1",
        content: "hi",
        clientMessageId: "c-draft",
      }),
    ).resolves.toEqual({});

    expect(apiClient.POST).toHaveBeenCalledTimes(1);
    expect(onlySendRow(ctx)._status).toBe("confirmed");
  });

  it("resolves with a warning, not a failed row, when POST succeeded and dequeue rejects", async () => {
    const apiClient = {
      POST: vi
        .fn()
        .mockImplementation(
          async (
            _path: string,
            init: { body: { client_message_id: string; content: string } },
          ) => ({
            data: {
              message: {
                id: "msg-1",
                channel_id: "chan-1",
                sender_id: "user-1",
                content: init.body.content,
                kind: "text",
                client_message_id: init.body.client_message_id,
                created_at: new Date().toISOString(),
              },
            },
            error: null,
            response: { status: 201 },
          }),
        ),
    };
    const outbox = stubOutbox({
      dequeue: vi.fn().mockRejectedValue(new Error("DatabaseClosedError")),
    });
    const ctx = buildCtx({
      apiClient: apiClient as unknown as ChatActionContext["apiClient"],
      outbox,
    });

    await expect(
      sendMessage(ctx, { channelId: "chan-1", content: "hi" }),
    ).resolves.toEqual({ warning: POSTED_OUTBOX_WARNING });

    expect(onlySendRow(ctx)._status).toBe("confirmed");
    expect(outbox.markFailed).not.toHaveBeenCalled();
    expect(outbox.bumpAttempt).not.toHaveBeenCalled();
  });

  it("does not POST again when the cache already has the confirmed row", async () => {
    const apiClient = { POST: vi.fn() };
    const outbox = stubOutbox({
      dequeue: vi.fn().mockRejectedValue(new Error("DatabaseClosedError")),
    });
    const ctx = buildCtx({
      apiClient: apiClient as unknown as ChatActionContext["apiClient"],
      outbox,
    });
    ctx.queryClient.setQueryData(
      chatMessagesKey("chan-1"),
      mergeServerRows(emptyCache(), [
        {
          id: "msg-1",
          channel_id: "chan-1",
          sender_id: "user-1",
          content: "hi",
          kind: "text",
          client_message_id: "c-1",
          created_at: new Date().toISOString(),
        },
      ]),
    );

    await expect(
      sendMessage(ctx, {
        channelId: "chan-1",
        content: "hi",
        clientMessageId: "c-1",
      }),
    ).resolves.toEqual({ warning: POSTED_OUTBOX_WARNING });

    expect(apiClient.POST).not.toHaveBeenCalled();
    expect(outbox.enqueue).not.toHaveBeenCalled();
    expect(onlySendRow(ctx)._status).toBe("confirmed");
    expect(onlySendRow(ctx).id).toBe("msg-1");
  });

  it("does not let a throwing track sink turn a posted send into a rejection", async () => {
    const apiClient = {
      POST: vi.fn().mockResolvedValue({
        data: {
          message: {
            id: "msg-1",
            channel_id: "chan-1",
            sender_id: "user-1",
            content: "hi",
            kind: "text",
            client_message_id: "c-track",
            created_at: new Date().toISOString(),
          },
        },
        error: null,
        response: { status: 201 },
      }),
    };
    const ctx = buildCtx({
      apiClient: apiClient as unknown as ChatActionContext["apiClient"],
      outbox: stubOutbox(),
      track: () => {
        throw new Error("analytics down");
      },
    });

    await expect(
      sendMessage(ctx, {
        channelId: "chan-1",
        content: "hi",
        clientMessageId: "c-track",
      }),
    ).resolves.toEqual({});

    expect(onlySendRow(ctx)._status).toBe("confirmed");
  });

  it("still retries when track throws", async () => {
    const apiClient = {
      POST: vi.fn().mockResolvedValue({
        data: {
          message: {
            id: "msg-retry",
            channel_id: "chan-1",
            sender_id: "user-1",
            content: "hi",
            kind: "text",
            client_message_id: "c-retry",
            created_at: new Date().toISOString(),
          },
        },
        error: null,
        response: { status: 201 },
      }),
    };
    const ctx = buildCtx({
      apiClient: apiClient as unknown as ChatActionContext["apiClient"],
      outbox: stubOutbox(),
      track: () => {
        throw new Error("analytics down");
      },
    });

    await expect(
      retryOutboxRow(ctx, {
        clientId: "c-retry",
        channelId: "chan-1",
        body: "hi",
        attempts: 1,
        status: "failed",
        queuedAt: Date.now(),
      }),
    ).resolves.toBeUndefined();

    expect(apiClient.POST).toHaveBeenCalled();
  });
});

describe("deleteMessage on a row the window doesn't hold (#2775)", () => {
  it("never splices the tombstone in, which would break older-page paging", async () => {
    const queryClient = new QueryClient();
    queryClient.setQueryData(
      chatMessagesKey("chan-1"),
      mergeServerRows(emptyCache(), [
        {
          id: "msg-new",
          channel_id: "chan-1",
          sender_id: "user-2",
          content: "newest",
          created_at: "2026-02-01T00:00:00.000Z",
        },
      ]),
    );
    const apiClient = {
      DELETE: vi.fn().mockResolvedValue({
        data: {
          id: "msg-old",
          channel_id: "chan-1",
          sender_id: "user-1",
          content: "[message deleted]",
          is_deleted: true,
          created_at: "2026-01-01T00:00:00.000Z",
        },
        error: null,
        response: { status: 200 },
      }),
    };
    const ctx = buildCtx({
      apiClient: apiClient as unknown as ChatActionContext["apiClient"],
      queryClient,
    });

    await deleteMessage(ctx, { channelId: "chan-1", messageId: "msg-old" });

    const cache = queryClient.getQueryData(
      chatMessagesKey("chan-1"),
    ) as ChannelCache;
    expect(cache.order).toEqual(["msg-new"]);
    expect(cache.byId["msg-old"]).toBeUndefined();
  });
});

describe("memberFacingRefusal", () => {
  it("replaces the Polls refusal with the member's row", () => {
    expect(memberFacingRefusal(moduleDisabledMessage("polls"))).toBe(
      POLLS_OFF_COPY,
    );
  });

  it("passes every other message through untouched", () => {
    expect(memberFacingRefusal("Poll has expired")).toBe("Poll has expired");
    // Another module's refusal belongs to that module's own surface.
    expect(memberFacingRefusal(moduleDisabledMessage("events"))).toBe(
      moduleDisabledMessage("events"),
    );
  });
});

describe("classifyChatError", () => {
  // A `@repo/hooks` mutation rethrows openapi-fetch's parsed body unchanged, so
  // the status arrives on `statusCode` and nowhere else (#2199). Reading only
  // `status` made every such refusal look transient.
  it("reads the status off a rethrown error body", () => {
    expect(
      classifyChatError({
        statusCode: 403,
        error: "Forbidden",
        message: "You do not have access to this channel",
      }),
    ).toEqual({
      terminal: true,
      status: 403,
      message: "You don't have access to this channel.",
    });
  });

  it("never relays a validation body's field-named lines", () => {
    expect(
      classifyChatError({
        statusCode: 400,
        error: "Bad Request",
        message: ["filename must be a string", "content_type is not allowed"],
      }),
    ).toEqual({
      terminal: true,
      status: 400,
      message: "Try again in a moment.",
    });
  });

  it("keeps a 5xx body transient", () => {
    expect(
      classifyChatError({
        statusCode: 503,
        error: "Service Unavailable",
        message: "Service Unavailable",
      }),
    ).toMatchObject({ terminal: false, status: 503 });
  });

  it("keeps reading the send path's wrapped Error by its response status", () => {
    const wrapped = Object.assign(new Error("Channel not found"), {
      response: { status: 404 },
      context: { status: 404 },
    });
    expect(classifyChatError(wrapped)).toEqual({
      terminal: true,
      status: 404,
      message: "It may have been deleted. Refresh and try again.",
    });
  });

  it("treats an Error with no status as transient", () => {
    expect(classifyChatError(new TypeError("Failed to fetch"))).toEqual({
      terminal: false,
      status: undefined,
      message: "Couldn't reach Frapp. Check your connection and try again.",
    });
  });
});

describe("definitiveRefusalMessage", () => {
  it("gives a definitive refusal's own reason", () => {
    expect(
      definitiveRefusalMessage({
        statusCode: 403,
        message: "You do not have access to this channel",
      }),
    ).toBe("You don't have access to this channel.");
  });

  it.each([
    [
      "the throttler's sentence",
      "Too many requests in a short time. Wait a minute, then try again.",
    ],
    ["an intermediary's text", "Too Many Requests"],
  ])(
    "reads a 429 carrying %s as the rate-limit sentence",
    (_label, message) => {
      expect(definitiveRefusalMessage({ statusCode: 429, message })).toBe(
        RATE_LIMITED_COPY,
      );
    },
  );

  it.each([
    ["a 5xx", { statusCode: 500, message: "Internal server error" }],
    ["a proxy 408", { statusCode: 408, message: "Request Timeout" }],
    ["a body with no status", { message: "something" }],
    ["a refusal with no message", { statusCode: 400, message: "" }],
    [
      "a thrown Error, even with a status",
      Object.assign(new Error("Upload failed (413)"), { status: 413 }),
    ],
    ["a text body openapi-fetch couldn't parse", "<html>Bad Gateway</html>"],
    ["nothing", undefined],
  ])("is null for %s", (_label, err) => {
    expect(definitiveRefusalMessage(err)).toBeNull();
  });

  it("reads the reason off the openapi-fetch envelope too, as classifyChatError does", () => {
    expect(
      definitiveRefusalMessage({
        error: { statusCode: 400, message: "File extension is not allowed" },
        response: { status: 400 },
      }),
    ).toBe("That file type isn't supported.");
  });

  it("gives the member the Polls-off sentence, as the send path does", () => {
    expect(
      definitiveRefusalMessage({
        statusCode: 403,
        message: moduleDisabledMessage("polls"),
      }),
    ).toBe(POLLS_OFF_COPY);
  });
});

describe("sendMessage with attachments still uploading", () => {
  const claim = {
    storagePath: "chapters/c/chat/m/a.jpg",
    filename: "a.jpg",
    contentType: "image/jpeg",
    byteSize: 1000,
  };

  it("shows the row at once, then queues and posts the claims once they land", async () => {
    let release!: (value: (typeof claim)[]) => void;
    const ready = new Promise<(typeof claim)[]>((resolve) => {
      release = resolve;
    });
    const outbox = stubOutbox();
    const apiClient = {
      POST: vi.fn().mockResolvedValue({
        data: { message: { id: "msg-1", client_message_id: "c-1" } },
        error: null,
        response: { status: 201 },
      }),
    };
    const ctx = buildCtx({
      apiClient: apiClient as unknown as ChatActionContext["apiClient"],
      outbox,
    });

    const sent = sendMessage(ctx, {
      channelId: "chan-1",
      content: "formal pics",
      clientMessageId: "c-1",
      attachmentsReady: ready,
      attachmentCount: 1,
    });
    await new Promise((resolve) => setTimeout(resolve, 0));
    // The draft is cleared before the wait, so a draft typed meanwhile survives.
    expect(outbox.clearDraft).toHaveBeenCalledWith("chan-1");

    const pending = ctx.queryClient.getQueryData<ChannelCache>(
      chatMessagesKey("chan-1"),
    );
    expect(selectMessages(pending!)).toMatchObject([
      { client_message_id: "c-1", attachment_count: 1 },
    ]);
    expect(outbox.enqueue).not.toHaveBeenCalled();
    expect(apiClient.POST).not.toHaveBeenCalled();

    release([claim]);
    await sent;

    expect(outbox.enqueue).toHaveBeenCalledWith(
      expect.objectContaining({ clientId: "c-1", attachments: [claim] }),
    );
    expect(apiClient.POST).toHaveBeenCalledWith(
      "/v1/channels/{id}/messages",
      expect.objectContaining({
        body: expect.objectContaining({
          attachments: [
            {
              storage_path: claim.storagePath,
              filename: "a.jpg",
              content_type: "image/jpeg",
              byte_size: 1000,
            },
          ],
        }),
      }),
    );
  });

  it("carries a photo's size, ThumbHash and preview path on the wire", async () => {
    const apiClient = {
      POST: vi.fn().mockResolvedValue({
        data: { message: { id: "msg-1", client_message_id: "c-2" } },
        error: null,
        response: { status: 201 },
      }),
    };
    const ctx = buildCtx({
      apiClient: apiClient as unknown as ChatActionContext["apiClient"],
      outbox: stubOutbox(),
    });

    await sendMessage(ctx, {
      channelId: "chan-1",
      content: "",
      clientMessageId: "c-2",
      attachments: [
        {
          ...claim,
          width: 2560,
          height: 1920,
          thumbhash: "3OcRJYB4d3h/iIeHeEh3eIhw+j3A",
          previewStoragePath: "chapters/c/chat/m/preview/preview.jpg",
        },
      ],
    });

    expect(apiClient.POST).toHaveBeenCalledWith(
      "/v1/channels/{id}/messages",
      expect.objectContaining({
        body: expect.objectContaining({
          attachments: [
            expect.objectContaining({
              width: 2560,
              height: 1920,
              thumbhash: "3OcRJYB4d3h/iIeHeEh3eIhw+j3A",
              preview_storage_path: "chapters/c/chat/m/preview/preview.jpg",
            }),
          ],
        }),
      }),
    );
  });

  it("keeps the row, failed with the reason, when an upload fails, queueing nothing", async () => {
    const outbox = stubOutbox();
    const ctx = buildCtx({ outbox });

    await expect(
      sendMessage(ctx, {
        channelId: "chan-1",
        content: "formal pics",
        clientMessageId: "c-1",
        attachmentsReady: Promise.reject(new Error("Couldn't upload")),
        attachmentCount: 1,
      }),
    ).rejects.toBeInstanceOf(AttachmentsNotReadyError);

    const cache = ctx.queryClient.getQueryData<ChannelCache>(
      chatMessagesKey("chan-1"),
    );
    expect(selectMessages(cache!)).toMatchObject([
      {
        client_message_id: "c-1",
        _status: "failed",
        _error: "Couldn't upload",
      },
    ]);
    expect(outbox.enqueue).not.toHaveBeenCalled();
  });
});

/**
 * Only a compose send clears the channel's saved draft (#3701). A retry, a
 * reconnect flush and a card posted from a sheet beside the composer send
 * something other than what the member is typing now, so they leave it be.
 */
describe("sendMessage and the saved draft", () => {
  function okPost() {
    return {
      POST: vi.fn().mockResolvedValue({
        data: { message: { id: "msg-1", client_message_id: "c-1" } },
        error: null,
        response: { status: 201 },
      }),
    } as unknown as ChatActionContext["apiClient"];
  }

  const failedRow: OutboxRow = {
    clientId: "c-1",
    channelId: "chan-1",
    body: "hi",
    attempts: 1,
    status: "failed",
    queuedAt: Date.now() - 5000,
  };

  it("clears it for a compose send", async () => {
    const outbox = stubOutbox();
    const ctx = buildCtx({ apiClient: okPost(), outbox });
    await sendMessage(ctx, { channelId: "chan-1", content: "hi" });
    expect(outbox.clearDraft).toHaveBeenCalledWith("chan-1");
  });

  it("keeps it for a send that asks to (mobile's New poll)", async () => {
    const outbox = stubOutbox();
    const ctx = buildCtx({ apiClient: okPost(), outbox });
    await sendMessage(ctx, {
      channelId: "chan-1",
      content: "Q?",
      kind: "poll",
      payload: { question: "Q?", options: [], closes_at: "" },
      keepDraft: true,
    });
    expect(outbox.clearDraft).not.toHaveBeenCalled();
  });

  it("keeps it on a retry", async () => {
    const outbox = stubOutbox();
    const ctx = buildCtx({ apiClient: okPost(), outbox });
    await retryOutboxRow(ctx, failedRow);
    expect(outbox.clearDraft).not.toHaveBeenCalled();
  });

  it("keeps it on a reconnect flush", async () => {
    const outbox = stubOutbox({
      listQueued: vi
        .fn()
        .mockResolvedValue([{ ...failedRow, status: "queued" }]),
    });
    const ctx = buildCtx({
      apiClient: okPost(),
      outbox,
      net: { isOffline: () => false } as ChatActionContext["net"],
    });
    await flushOutbox(ctx);
    expect(outbox.clearDraft).not.toHaveBeenCalled();
  });
});

/**
 * A thread reply's writes (#4034): its row lives in the thread's own cache
 * (`chatThreadRepliesKey`), never the channel's, so each write names the
 * thread and patches that cache.
 */
describe("row writes on a thread reply", () => {
  const REPLY = {
    id: "reply-1",
    channel_id: "chan-1",
    sender_id: "user-1",
    content: "first draft",
    created_at: "2026-01-01T00:00:00.000Z",
    thread_root_id: "root-1",
  };
  const threadKey = chatThreadRepliesKey("chan-1", "root-1");

  function seeded() {
    const queryClient = new QueryClient();
    queryClient.setQueryData(threadKey, mergeServerRows(emptyCache(), [REPLY]));
    return queryClient;
  }

  it("reacts in the thread's cache and leaves the channel's alone", async () => {
    const queryClient = seeded();
    const apiClient = {
      POST: vi.fn().mockResolvedValue({
        data: {
          action: {
            id: "act-1",
            message_id: "reply-1",
            user_id: "user-1",
            action_type: "reaction:👍",
            payload: null,
            created_at: "2026-01-01T00:01:00.000Z",
          },
        },
        error: null,
        response: { status: 201 },
      }),
    };
    const ctx = buildCtx({
      queryClient,
      apiClient: apiClient as unknown as ChatActionContext["apiClient"],
    });

    await react(ctx, {
      channelId: "chan-1",
      messageId: "reply-1",
      emoji: "👍",
      threadRootId: "root-1",
    });

    const held = queryClient.getQueryData<ChannelCache>(threadKey)!;
    expect(held.byId["reply-1"]!.reactions["reaction:👍"]).toEqual(["user-1"]);
    expect(queryClient.getQueryData(chatMessagesKey("chan-1"))).toBeUndefined();
  });

  it("merges an edit and a delete into the thread's cache", async () => {
    const queryClient = seeded();
    const apiClient = {
      PATCH: vi.fn().mockResolvedValue({
        data: {
          ...REPLY,
          content: "fixed",
          edited_at: "2026-01-01T00:02:00.000Z",
        },
        error: null,
        response: { status: 200 },
      }),
      DELETE: vi.fn().mockResolvedValue({
        data: { ...REPLY, content: "[message deleted]", is_deleted: true },
        error: null,
        response: { status: 200 },
      }),
    };
    const ctx = buildCtx({
      queryClient,
      apiClient: apiClient as unknown as ChatActionContext["apiClient"],
    });
    const reply = () =>
      queryClient.getQueryData<ChannelCache>(threadKey)!.byId["reply-1"]!;

    await editMessage(ctx, {
      channelId: "chan-1",
      messageId: "reply-1",
      content: "fixed",
      threadRootId: "root-1",
    });
    expect(reply().content).toBe("fixed");

    await deleteMessage(ctx, {
      channelId: "chan-1",
      messageId: "reply-1",
      threadRootId: "root-1",
    });
    expect(reply().is_deleted).toBe(true);
    expect(queryClient.getQueryData(chatMessagesKey("chan-1"))).toBeUndefined();
  });

  it("records a vote on a poll reply in the thread's cache", async () => {
    const queryClient = seeded();
    const vote = {
      id: "vote-1",
      message_id: "reply-1",
      user_id: "user-1",
      action_type: "vote",
      payload: { option_id: ["fri"] },
      created_at: "2026-01-01T00:01:00.000Z",
    };
    const apiClient = {
      POST: vi.fn().mockResolvedValue({
        data: { action: vote, updated: false },
        error: null,
        response: { status: 201 },
      }),
    };
    const ctx = buildCtx({
      queryClient,
      apiClient: apiClient as unknown as ChatActionContext["apiClient"],
    });

    await actOnCard(ctx, {
      channelId: "chan-1",
      messageId: "reply-1",
      actionType: "vote",
      payload: { option_id: ["fri"] },
      threadRootId: "root-1",
    });

    const held = queryClient.getQueryData<ChannelCache>(threadKey)!;
    expect(held.byId["reply-1"]!.actions).toEqual([vote]);
    expect(queryClient.getQueryData(chatMessagesKey("chan-1"))).toBeUndefined();
  });
});
