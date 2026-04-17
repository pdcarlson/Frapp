import { renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { beforeEach, describe, expect, it, vi } from "vitest";
import React from "react";
import { useSearch } from "./use-search";
import { FrappClientProvider } from "./use-frapp-client";

const SEARCH_ENDPOINT = "/v1/search";

const createWrapper = (
  queryClient: QueryClient,
  mockClient: unknown,
  chapterId: string | null = "chapter-a",
) => {
  const Wrapper = ({ children }: { children: React.ReactNode }) => (
    <FrappClientProvider
      client={
        mockClient as unknown as ReturnType<
          typeof import("@repo/api-sdk").createFrappClient
        >
      }
      chapterId={chapterId}
    >
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    </FrappClientProvider>
  );
  Wrapper.displayName = "UseSearchTestWrapper";
  return Wrapper;
};

describe("useSearch", () => {
  let queryClient: QueryClient;

  beforeEach(() => {
    queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
  });

  it("returns search payload when the API request succeeds", async () => {
    const payload = { members: [{ id: "m1" }] };
    const mockClient = {
      GET: vi.fn().mockResolvedValue({ data: payload, error: undefined }),
    };

    const { result } = renderHook(() => useSearch("alice"), {
      wrapper: createWrapper(queryClient, mockClient, "chapter-a"),
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(mockClient.GET).toHaveBeenCalledWith(SEARCH_ENDPOINT, {
      params: { query: { q: "alice" } },
    });
    expect(result.current.data).toEqual(payload);
  });

  it("does not reuse cached results from a different chapter for the same query", async () => {
    const chapterAData = { members: [{ id: "from-a" }] };
    const chapterBData = { members: [{ id: "from-b" }] };

    queryClient.setQueryData(["search", "chapter-a", "shared"], chapterAData);

    const mockClient = {
      GET: vi.fn().mockResolvedValue({
        data: chapterBData,
        error: undefined,
      }),
    };

    const { result } = renderHook(() => useSearch("shared"), {
      wrapper: createWrapper(queryClient, mockClient, "chapter-b"),
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(result.current.data).toEqual(chapterBData);
    expect(result.current.data).not.toEqual(chapterAData);
    expect(mockClient.GET).toHaveBeenCalledTimes(1);
  });

  it("is disabled when the active chapter is not set", () => {
    const mockClient = { GET: vi.fn() };

    const { result } = renderHook(() => useSearch("term"), {
      wrapper: createWrapper(queryClient, mockClient, null),
    });

    expect(mockClient.GET).not.toHaveBeenCalled();
    expect(result.current.fetchStatus).toBe("idle");
  });

  it("is disabled when the query is empty", () => {
    const mockClient = { GET: vi.fn() };

    const { result } = renderHook(() => useSearch(""), {
      wrapper: createWrapper(queryClient, mockClient, "chapter-a"),
    });

    expect(mockClient.GET).not.toHaveBeenCalled();
    expect(result.current.fetchStatus).toBe("idle");
  });
});
