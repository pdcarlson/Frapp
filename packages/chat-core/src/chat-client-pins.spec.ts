import { describe, expect, it, vi } from "vitest";
import { QueryClient } from "@tanstack/react-query";
import { setMessagePinned, type ChatActionContext } from "./chat-client";
import type { OutboxStore } from "./adapters";
import { emptyCache, mergeServerRows } from "./cache";
import { chatMessagesKey, type ChannelCache } from "./types";

// `setMessagePinned` (#3723): the request Pin message sends, and the server
// row it merges, so the pinner's row reads Pinned without the Realtime echo.

const row = {
  id: "msg-1",
  channel_id: "chan-1",
  sender_id: "user-2",
  content: "rush schedule",
  created_at: "2026-11-11T12:00:00.000Z",
  is_pinned: false,
  pinned_at: null,
};

function setup(answer: { data: unknown; status: number; error?: unknown }) {
  const queryClient = new QueryClient();
  queryClient.setQueryData(
    chatMessagesKey("chan-1"),
    mergeServerRows(emptyCache(), [row]),
  );
  const respond = () =>
    vi.fn().mockResolvedValue({
      data: answer.data,
      error: answer.error ?? null,
      response: { status: answer.status },
    });
  const apiClient = { POST: respond(), DELETE: respond() };
  const toast = vi.fn();
  const ctx: ChatActionContext = {
    queryClient,
    apiClient: apiClient as unknown as ChatActionContext["apiClient"],
    supabase: {} as ChatActionContext["supabase"],
    userId: "user-1",
    outbox: {} as OutboxStore,
    toast,
  };
  const cached = () =>
    (queryClient.getQueryData(chatMessagesKey("chan-1")) as ChannelCache).byId[
      "msg-1"
    ];
  return { ctx, apiClient, toast, cached };
}

describe("setMessagePinned (#3723)", () => {
  it("POSTs the pin and merges the server's pinned row", async () => {
    const { ctx, apiClient, cached } = setup({
      status: 201,
      data: { ...row, is_pinned: true, pinned_at: "2026-11-13T09:00:00.000Z" },
    });

    await setMessagePinned(ctx, {
      channelId: "chan-1",
      messageId: "msg-1",
      pinned: true,
    });

    expect(apiClient.POST).toHaveBeenCalledWith(
      "/v1/channels/messages/{messageId}/pin",
      { params: { path: { messageId: "msg-1" } } },
    );
    expect(cached()).toMatchObject({ is_pinned: true });
  });

  it("DELETEs to unpin and merges the unpinned row", async () => {
    const { ctx, apiClient } = setup({
      status: 200,
      data: { ...row, is_pinned: false },
    });

    await setMessagePinned(ctx, {
      channelId: "chan-1",
      messageId: "msg-1",
      pinned: false,
    });

    expect(apiClient.DELETE).toHaveBeenCalledWith(
      "/v1/channels/messages/{messageId}/pin",
      { params: { path: { messageId: "msg-1" } } },
    );
    expect(apiClient.POST).not.toHaveBeenCalled();
  });

  it("toasts and rejects when the channel is at its 50 pins, leaving the row", async () => {
    const { ctx, toast, cached } = setup({
      status: 400,
      data: undefined,
      error: { message: "This channel already has 50 pinned messages." },
    });

    await expect(
      setMessagePinned(ctx, {
        channelId: "chan-1",
        messageId: "msg-1",
        pinned: true,
      }),
    ).rejects.toThrow();
    expect(toast).toHaveBeenCalledWith(
      expect.objectContaining({ title: "Couldn't pin message" }),
    );
    expect(cached()?.is_pinned).toBe(false);
  });
});
