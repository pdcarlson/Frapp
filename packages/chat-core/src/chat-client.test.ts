import { describe, it, expect, vi, beforeEach } from "vitest";
import { QueryClient } from "@tanstack/react-query";
import {
  discardOutboxRow,
  react,
  retryOutboxRow,
  sendMessage,
  unreact,
  type ChatActionContext,
  type ChatErrorFn,
  type ToastFn,
} from "./chat-client";
import type { OutboxRow, OutboxStore } from "./adapters";
import { OUTBOX_ANALYTICS_EVENTS } from "./outbox-analytics";
import { assertContentFreeProperties } from "@repo/validation";

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
        description: "Channel is read-only",
      }),
    );
    expect(onError).toHaveBeenCalledWith({
      title: "Couldn't react",
      description: "Channel is read-only",
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

    await unreact(ctx, { channelId: "chan-1", messageId: "msg-1", emoji: "👍" });

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

    await unreact(ctx, { channelId: "chan-1", messageId: "msg-1", emoji: "👍" });

    expect(toast).toHaveBeenCalledWith(
      expect.objectContaining({
        title: "Couldn't remove reaction",
        description: "Row not found",
      }),
    );
    expect(onError).toHaveBeenCalledWith({
      title: "Couldn't remove reaction",
      description: "Row not found",
    });
  });

  it("still fires onError when no toast is supplied (the mobile shape)", async () => {
    const ctx = buildCtx({
      supabase: buildSupabase({
        message: "Row not found",
      }) as unknown as ChatActionContext["supabase"],
      onError,
    });

    await unreact(ctx, { channelId: "chan-1", messageId: "msg-1", emoji: "👍" });

    expect(onError).toHaveBeenCalledTimes(1);
  });
});

describe("outbox analytics", () => {
  function buildOutbox(overrides: Partial<OutboxStore> = {}): OutboxStore {
    return {
      enqueue: vi.fn().mockImplementation(
        async (row): Promise<OutboxRow> => ({
          attempts: 0,
          status: "queued",
          queuedAt: Date.now(),
          ...row,
        }),
      ),
      dequeue: vi.fn().mockResolvedValue(undefined),
      requeue: vi.fn().mockResolvedValue(undefined),
      markFailed: vi.fn().mockResolvedValue(undefined),
      bumpAttempt: vi.fn().mockResolvedValue(undefined),
      listQueued: vi.fn().mockResolvedValue([]),
      listForChannel: vi.fn().mockResolvedValue([]),
      clearDraft: vi.fn().mockResolvedValue(undefined),
      ...overrides,
    };
  }

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
      outbox: buildOutbox(),
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
      outbox: buildOutbox(),
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

  it("emits failed-network (not failed-4xx) on a transient/network error", async () => {
    const track = vi.fn();
    const apiClient = {
      POST: vi.fn().mockRejectedValue(new Error("fetch failed")),
    };
    const ctx = buildCtx({
      apiClient: apiClient as unknown as ChatActionContext["apiClient"],
      outbox: buildOutbox(),
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
      outbox: buildOutbox(),
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
      outbox: buildOutbox(),
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
    const ctx = buildCtx({ outbox: buildOutbox(), track });
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
    const events: Array<{ name: string; properties?: Record<string, unknown> }> =
      [];
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
        outbox: buildOutbox(),
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
        outbox: buildOutbox(),
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
      buildCtx({ outbox: buildOutbox(), track }),
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
