/** @vitest-environment jsdom */
import type { QueryClient } from "@tanstack/react-query";
import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  discordConnectionKeys,
  useBeginDiscordConnect,
  useDiscordAvailability,
} from "./use-discord-connection";
import { createHookWrapper, createTestQueryClient } from "./test-utils";

const CHAPTER = "chapter-1";

describe("Discord availability", () => {
  let queryClient: QueryClient;

  beforeEach(() => {
    queryClient = createTestQueryClient();
  });

  const wrapperFor = (mockClient: unknown) => {
    return createHookWrapper({
      client: mockClient,
      queryClient,
      chapterId: CHAPTER,
      displayName: "DiscordConnectionHookWrapper",
    });
  };

  it("goes stale after a minute, not ten: the API withdraws and restores the flow at runtime", async () => {
    const GET = vi.fn().mockResolvedValue({
      data: { available: false },
      error: null,
    });
    const { result } = renderHook(() => useDiscordAvailability(), {
      wrapper: wrapperFor({ GET }),
    });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    const query = queryClient
      .getQueryCache()
      .find({ queryKey: discordConnectionKeys.availability(CHAPTER) });
    const staleTime = (
      query?.observers[0]?.options as { staleTime?: number } | undefined
    )?.staleTime;
    expect(staleTime).toBe(60_000);
  });

  it("re-asks for availability when starting a connect is refused", async () => {
    // The API re-reads Discord before every connect, so its refusal can be
    // newer than the answer that enabled the button.
    const POST = vi.fn().mockResolvedValue({
      data: undefined,
      error: { statusCode: 503, message: "switched off" },
    });
    const invalidate = vi.spyOn(queryClient, "invalidateQueries");
    const { result } = renderHook(() => useBeginDiscordConnect(), {
      wrapper: wrapperFor({ POST }),
    });

    await act(async () => {
      await result.current
        .mutateAsync({ return_path: "/discord-import" })
        .catch(() => undefined);
    });

    expect(invalidate).toHaveBeenCalledWith({
      queryKey: discordConnectionKeys.availability(CHAPTER),
    });
  });

  it("leaves availability alone when the connect starts", async () => {
    const POST = vi.fn().mockResolvedValue({
      data: { authorize_url: "https://discord.com/oauth2/authorize?x=1" },
      error: null,
    });
    const invalidate = vi.spyOn(queryClient, "invalidateQueries");
    const { result } = renderHook(() => useBeginDiscordConnect(), {
      wrapper: wrapperFor({ POST }),
    });

    await act(async () => {
      await result.current.mutateAsync({});
    });

    expect(invalidate).not.toHaveBeenCalled();
  });
});
