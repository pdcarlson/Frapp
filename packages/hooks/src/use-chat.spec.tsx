import { renderHook, waitFor } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  useChannelUnreadCounts,
  useMarkChannelRead,
  useAuthorAvatars,
} from "./use-chat";
import { FrappClientProvider } from "./use-frapp-client";
import React from "react";

function createTestQueryClient() {
  return new QueryClient({
    defaultOptions: {
      queries: {
        retry: false,
      },
    },
  });
}

function createWrapper(queryClient: QueryClient, mockClient: unknown) {
  const Wrapper = ({ children }: { children: React.ReactNode }) => (
    <FrappClientProvider
      client={
        mockClient as unknown as ReturnType<
          typeof import("@repo/api-sdk").createFrappClient
        >
      }
    >
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    </FrappClientProvider>
  );
  Wrapper.displayName = "Wrapper";
  return Wrapper;
}

describe("useChannelUnreadCounts", () => {
  let queryClient: QueryClient;

  beforeEach(() => {
    queryClient = createTestQueryClient();
  });

  it("returns one row per channel, including zero-count channels", async () => {
    const rows = [
      { channel_id: "chan-1", unread_count: 3, mention_count: 1 },
      { channel_id: "chan-2", unread_count: 0, mention_count: 0 },
    ];
    const mockGet = vi.fn().mockResolvedValue({ data: rows, error: null });
    const mockClient = { GET: mockGet };

    const { result } = renderHook(() => useChannelUnreadCounts(), {
      wrapper: createWrapper(queryClient, mockClient),
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(mockGet).toHaveBeenCalledWith("/v1/channels/unread");
    expect(result.current.data).toEqual(rows);
  });

  it("returns an empty array rather than undefined when the API sends none", async () => {
    const mockGet = vi.fn().mockResolvedValue({ data: null, error: null });
    const mockClient = { GET: mockGet };

    const { result } = renderHook(() => useChannelUnreadCounts(), {
      wrapper: createWrapper(queryClient, mockClient),
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(result.current.data).toEqual([]);
  });
});

describe("useMarkChannelRead", () => {
  let queryClient: QueryClient;

  beforeEach(() => {
    queryClient = createTestQueryClient();
  });

  it("posts to the channel's read endpoint and invalidates channel queries", async () => {
    const mockPost = vi.fn().mockResolvedValue({ data: { success: true }, error: null });
    const mockClient = { POST: mockPost };
    const invalidateSpy = vi.spyOn(queryClient, "invalidateQueries");

    const { result } = renderHook(() => useMarkChannelRead(), {
      wrapper: createWrapper(queryClient, mockClient),
    });

    result.current.mutate("chan-1");

    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(mockPost).toHaveBeenCalledWith("/v1/channels/{id}/read", {
      params: { path: { id: "chan-1" } },
    });
    // Badges come from the ["channels", "unread"] key; invalidating the
    // broader ["channels"] key is what makes a mark-read clear them via
    // React Query's prefix matching, without a second, narrower invalidation
    // that could drift out of sync with the unread query's own key.
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ["channels"] });
  });

  it("surfaces an error without invalidating anything", async () => {
    const mockError = new Error("mark-read failed");
    const mockPost = vi.fn().mockResolvedValue({ data: null, error: mockError });
    const mockClient = { POST: mockPost };
    const invalidateSpy = vi.spyOn(queryClient, "invalidateQueries");

    const { result } = renderHook(() => useMarkChannelRead(), {
      wrapper: createWrapper(queryClient, mockClient),
    });

    result.current.mutate("chan-1");

    await waitFor(() => expect(result.current.isError).toBe(true));

    expect(result.current.error).toEqual(mockError);
    expect(invalidateSpy).not.toHaveBeenCalled();
  });
});

describe("useAuthorAvatars", () => {
  let queryClient: QueryClient;

  beforeEach(() => {
    queryClient = createTestQueryClient();
  });

  it("sends one representative message id per distinct avatar path, not one per message", async () => {
    const mockPost = vi.fn().mockResolvedValue({
      data: { "path/a": "https://signed/a" },
      error: null,
    });
    const mockClient = { POST: mockPost };
    const messages = [
      { id: "msg-1", author_avatar_path: "path/a" },
      { id: "msg-2", author_avatar_path: "path/a" },
      { id: "msg-3", author_avatar_path: null },
    ];

    const { result } = renderHook(() => useAuthorAvatars("chan-1", messages), {
      wrapper: createWrapper(queryClient, mockClient),
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(mockPost).toHaveBeenCalledTimes(1);
    expect(mockPost).toHaveBeenCalledWith(
      "/v1/channels/{id}/messages/avatars",
      {
        params: { path: { id: "chan-1" } },
        body: { message_ids: ["msg-1"] },
      },
    );
    expect(result.current.data).toEqual({ "path/a": "https://signed/a" });
  });

  it("is disabled — never calls POST — when no message carries an avatar path", async () => {
    const mockPost = vi.fn();
    const mockClient = { POST: mockPost };
    const messages = [{ id: "msg-1", author_avatar_path: null }];

    const { result } = renderHook(() => useAuthorAvatars("chan-1", messages), {
      wrapper: createWrapper(queryClient, mockClient),
    });

    expect(result.current.fetchStatus).toBe("idle");
    expect(mockPost).not.toHaveBeenCalled();
  });

  it("chunks past the server's per-request cap and merges the results", async () => {
    // 60 distinct authors — one more than the server's 50-id cap
    // (MAX_AUTHOR_AVATAR_PATHS_PER_REQUEST in chat.dto.ts) — should split
    // into two requests rather than 400 the whole batch.
    const messages = Array.from({ length: 60 }, (_, i) => ({
      id: `msg-${i}`,
      author_avatar_path: `path/${i}`,
    }));
    const mockPost = vi.fn().mockImplementation(async (_url, { body }) => ({
      data: Object.fromEntries(
        (body.message_ids as string[]).map((id: string) => [
          `path/${id.slice(4)}`,
          `https://signed/${id}`,
        ]),
      ),
      error: null,
    }));
    const mockClient = { POST: mockPost };

    const { result } = renderHook(() => useAuthorAvatars("chan-1", messages), {
      wrapper: createWrapper(queryClient, mockClient),
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(mockPost).toHaveBeenCalledTimes(2);
    expect(Object.keys(result.current.data ?? {})).toHaveLength(60);
  });
});
