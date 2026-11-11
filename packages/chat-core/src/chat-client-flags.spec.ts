import { describe, expect, it, vi } from "vitest";
import { QueryClient } from "@tanstack/react-query";
import { setMessageFlag, type ChatActionContext } from "./chat-client";
import type { OutboxStore } from "./adapters";
import { emptyCache, mergeServerRows } from "./cache";
import { chatMessagesKey, type ChannelCache } from "./types";

// `setMessageFlag` (#3921): the request a Flag pick sends, and the server row
// it merges. Beside `chat-client.spec.ts` rather than in it, so the two
// change apart.

const row = {
  id: "msg-1",
  channel_id: "chan-1",
  sender_id: "user-2",
  content: "tailgate at 11",
  created_at: "2026-11-11T12:00:00.000Z",
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
  const apiClient = { PUT: respond(), DELETE: respond() };
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

describe("setMessageFlag (#3921)", () => {
  it("PUTs the flag and merges the server's flagged row", async () => {
    const { ctx, apiClient, cached } = setup({
      status: 200,
      data: {
        ...row,
        flag: "important",
        flagged_by: "user-1",
        flagged_at: "2026-11-11T14:00:00.000Z",
      },
    });

    await setMessageFlag(ctx, {
      channelId: "chan-1",
      messageId: "msg-1",
      flag: "important",
    });

    expect(apiClient.PUT).toHaveBeenCalledWith(
      "/v1/channels/messages/{messageId}/flag",
      { params: { path: { messageId: "msg-1" } }, body: { flag: "important" } },
    );
    expect(cached()).toMatchObject({
      flag: "important",
      flagged_by: "user-1",
    });
  });

  it("DELETEs for null and merges the unflagged row", async () => {
    const { ctx, apiClient, cached } = setup({
      status: 200,
      data: { ...row, flag: null, flagged_by: null, flagged_at: null },
    });

    await setMessageFlag(ctx, {
      channelId: "chan-1",
      messageId: "msg-1",
      flag: null,
    });

    expect(apiClient.DELETE).toHaveBeenCalledWith(
      "/v1/channels/messages/{messageId}/flag",
      { params: { path: { messageId: "msg-1" } } },
    );
    expect(apiClient.PUT).not.toHaveBeenCalled();
    expect(cached()?.flag).toBeNull();
  });

  it("toasts and rejects on a lost race, leaving the row as it was", async () => {
    const { ctx, toast, cached } = setup({
      status: 409,
      data: undefined,
      error: { message: "This message’s flag changed just now." },
    });

    await expect(
      setMessageFlag(ctx, {
        channelId: "chan-1",
        messageId: "msg-1",
        flag: "funny",
      }),
    ).rejects.toThrow();
    expect(toast).toHaveBeenCalledWith(
      expect.objectContaining({ title: "Couldn't flag message" }),
    );
    expect(cached()?.flag).toBeNull();
  });
});
