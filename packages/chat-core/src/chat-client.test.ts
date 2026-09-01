import { describe, it, expect, vi, beforeEach } from "vitest";
import { QueryClient } from "@tanstack/react-query";
import {
  react,
  unreact,
  type ChatActionContext,
  type ChatErrorFn,
  type ToastFn,
} from "./chat-client";
import type { OutboxStore } from "./adapters";

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
