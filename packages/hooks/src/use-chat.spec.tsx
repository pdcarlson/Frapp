import { renderHook, waitFor } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useChannelUnreadCounts, useMarkChannelRead } from "./use-chat";
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
