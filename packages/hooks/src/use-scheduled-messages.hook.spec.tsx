/**
 * `useScheduleMessage`'s request (#4971): what both clients send when they
 * schedule, files and the quote or thread included.
 */
import type { ReactNode } from "react";
import { act, renderHook } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useActiveChapterId, useFrappClient } from "./use-frapp-client";
import { useScheduleMessage } from "./use-scheduled-messages";

vi.mock("./use-frapp-client", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./use-frapp-client")>()),
  useFrappClient: vi.fn(),
  useActiveChapterId: vi.fn(),
}));

describe("useScheduleMessage (#4971)", () => {
  let post: ReturnType<typeof vi.fn>;
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={new QueryClient()}>
      {children}
    </QueryClientProvider>
  );

  beforeEach(() => {
    post = vi.fn(async () => ({ data: { id: "s-1" }, error: undefined }));
    vi.mocked(useFrappClient).mockReturnValue({
      POST: post,
    } as unknown as ReturnType<typeof useFrappClient>);
    vi.mocked(useActiveChapterId).mockReturnValue("ch-1");
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
