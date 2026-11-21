/**
 * `useScheduleMessage`'s request (#4971): what both clients send when they
 * schedule, files and the quote or thread included.
 */
import { act, renderHook, waitFor } from "@testing-library/react";
import { QueryClient } from "@tanstack/react-query";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createHookWrapper } from "./test-utils";
import {
  useScheduleMessage,
  useScheduledMessages,
} from "./use-scheduled-messages";

describe("useScheduleMessage (#4971)", () => {
  let post: ReturnType<typeof vi.fn>;
  let wrapper: ReturnType<typeof createHookWrapper>;

  beforeEach(() => {
    post = vi.fn(async () => ({ data: { id: "s-1" }, error: undefined }));
    wrapper = createHookWrapper({
      client: { POST: post },
      queryClient: new QueryClient(),
      chapterId: "ch-1",
    });
  });

  const sendAt = new Date("2026-11-15T14:00:00.000Z");
  const file = {
    storage_path: "chapters/ch-1/chat/c/a/IMG_1.jpg",
    filename: "IMG_1.jpg",
    content_type: "image/jpeg",
  };

  it("sends the files and the quote with the text", async () => {
    const { result } = renderHook(() => useScheduleMessage(), { wrapper });
    await act(() =>
      result.current.mutateAsync({
        channelId: "c",
        content: "",
        sendAt,
        attachments: [file],
        replyToId: "m-1",
      }),
    );
    expect(post).toHaveBeenCalledWith("/v1/scheduled-messages", {
      body: {
        channel_id: "c",
        content: "",
        send_at: sendAt.toISOString(),
        attachments: [file],
        reply_to_id: "m-1",
      },
    });
  });

  it("sends the thread, and leaves out what a text message doesn't have", async () => {
    const { result } = renderHook(() => useScheduleMessage(), { wrapper });
    await act(() =>
      result.current.mutateAsync({
        channelId: "c",
        content: "In the thread",
        sendAt,
        attachments: [],
        replyToId: null,
        threadRootId: "r-1",
      }),
    );
    expect(post).toHaveBeenCalledWith("/v1/scheduled-messages", {
      body: {
        channel_id: "c",
        content: "In the thread",
        send_at: sendAt.toISOString(),
        thread_root_id: "r-1",
      },
    });
  });
});

describe("useScheduledMessages (#5005)", () => {
  const row = (id: string, thread: string | null) => ({
    id,
    thread_root_id: thread,
  });
  let get: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    get = vi.fn(async () => ({
      data: [row("top", null), row("in-a", "root-a"), row("in-b", "root-b")],
      error: undefined,
    }));
  });

  it("lists the whole channel, or one thread's replies from the same read", async () => {
    const client = new QueryClient();
    const wrapper = createHookWrapper({
      client: { GET: get },
      queryClient: client,
      chapterId: "ch-1",
    });
    const { result } = renderHook(
      () => ({
        channel: useScheduledMessages("c"),
        thread: useScheduledMessages("c", "root-a"),
      }),
      { wrapper },
    );
    await waitFor(() => expect(result.current.thread.data).toBeDefined());
    expect(result.current.channel.data?.map((r) => r.id)).toEqual([
      "top",
      "in-a",
      "in-b",
    ]);
    expect(result.current.thread.data?.map((r) => r.id)).toEqual(["in-a"]);
    expect(get).toHaveBeenCalledTimes(1);
  });
});
