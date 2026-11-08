/**
 * `useChatActivityHandler` itself, as both clients mount it: the callback it
 * returns reaches a live handler, stamps through the app's API client only for
 * the claimed channel in the foreground, and goes quiet once unmounted (#3698).
 * The rules it applies are `chat-activity.spec.ts`'s.
 */
import type { ReactNode } from "react";
import { act, renderHook } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import {
  CHAT_ACTIVITY_COALESCE_MS,
  claimViewedChannel,
  useChatActivityHandler,
} from "./chat-activity";
import { CHANNEL_UNREAD_COUNTS_KEY } from "./use-chat";
import { useFrappClient } from "./use-frapp-client";

vi.mock("./use-frapp-client", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./use-frapp-client")>()),
  useFrappClient: vi.fn(),
}));

const VIEWER = "viewer-1";
const OTHER = "member-2";

describe("useChatActivityHandler (#3698)", () => {
  let queryClient: QueryClient;
  let post: ReturnType<typeof vi.fn>;
  let foreground: boolean;
  let release: (() => void) | null;

  beforeEach(() => {
    vi.useFakeTimers();
    queryClient = new QueryClient();
    post = vi.fn(async () => ({ data: {}, error: undefined }));
    vi.mocked(useFrappClient).mockReturnValue({
      POST: post,
    } as unknown as ReturnType<typeof useFrappClient>);
    foreground = true;
    release = null;
  });

  afterEach(() => {
    release?.();
    vi.useRealTimers();
    queryClient.clear();
  });

  function render() {
    const wrapper = ({ children }: { children: ReactNode }) => (
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    );
    return renderHook(() => useChatActivityHandler(VIEWER, () => foreground), {
      wrapper,
    });
  }

  test("a message in the claimed thread, in the foreground, stamps it read on the app's client", async () => {
    release = claimViewedChannel("c1");
    const { result } = render();

    act(() =>
      result.current({ type: "message", channelId: "c1", senderId: OTHER }),
    );
    await act(() => vi.advanceTimersByTimeAsync(CHAT_ACTIVITY_COALESCE_MS));

    expect(post).toHaveBeenCalledWith("/v1/channels/{id}/read", {
      params: { path: { id: "c1" } },
    });
  });

  test("in the background, the claimed thread is not stamped; the counts are re-read", async () => {
    release = claimViewedChannel("c1");
    foreground = false;
    const invalidate = vi.spyOn(queryClient, "invalidateQueries");
    const { result } = render();

    act(() =>
      result.current({ type: "message", channelId: "c1", senderId: OTHER }),
    );
    await act(() => vi.advanceTimersByTimeAsync(CHAT_ACTIVITY_COALESCE_MS));

    expect(post).not.toHaveBeenCalled();
    expect(invalidate).toHaveBeenCalledWith({
      queryKey: CHANNEL_UNREAD_COUNTS_KEY,
      exact: true,
    });
  });

  test("keeps one identity across renders, and does nothing once unmounted", async () => {
    release = claimViewedChannel("c1");
    const { result, rerender, unmount } = render();
    const first = result.current;
    rerender();
    expect(result.current).toBe(first);

    unmount();
    first({ type: "message", channelId: "c1", senderId: OTHER });
    await vi.advanceTimersByTimeAsync(CHAT_ACTIVITY_COALESCE_MS * 4);
    expect(post).not.toHaveBeenCalled();
  });
});
