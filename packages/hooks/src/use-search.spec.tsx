import { renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { beforeEach, describe, expect, it, vi } from "vitest";
import React from "react";
import { useSearch } from "./use-search";
import { FrappClientProvider } from "./use-frapp-client";

const SEARCH_ENDPOINT = "/v1/search";

/** A minimal `Response`-shaped stand-in — only `.headers.get` is used by the hook. */
function mockResponse(headers: Record<string, string> = {}) {
  return {
    headers: {
      get: (name: string) => headers[name.toLowerCase()] ?? null,
    },
  };
}

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
      GET: vi.fn().mockResolvedValue({
        data: payload,
        error: undefined,
        response: mockResponse(),
      }),
    };

    const { result } = renderHook(() => useSearch("alice"), {
      wrapper: createWrapper(queryClient, mockClient, "chapter-a"),
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(mockClient.GET).toHaveBeenCalledWith(SEARCH_ENDPOINT, {
      params: { query: { q: "alice" } },
    });
    expect(result.current.data).toEqual({
      payload,
      timedOut: false,
      timedOutSources: [],
    });
  });

  it("does not reuse cached results from a different chapter for the same query", async () => {
    const chapterAData = { members: [{ id: "from-a" }] };
    const chapterBData = { members: [{ id: "from-b" }] };

    // The key must match the CURRENT key shape or this test proves nothing:
    // a seed with fewer elements can never collide, so the assertions below
    // would hold even if `chapterId` were dropped from the key entirely. The
    // trailing `null` is the chapter-wide `channelId` slot.
    queryClient.setQueryData(["search", "chapter-a", "shared", null], {
      payload: chapterAData,
      timedOut: false,
      timedOutSources: [],
    });

    const mockClient = {
      GET: vi.fn().mockResolvedValue({
        data: chapterBData,
        error: undefined,
        response: mockResponse(),
      }),
    };

    const { result } = renderHook(() => useSearch("shared"), {
      wrapper: createWrapper(queryClient, mockClient, "chapter-b"),
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(result.current.data?.payload).toEqual(chapterBData);
    expect(result.current.data?.payload).not.toEqual(chapterAData);
    expect(mockClient.GET).toHaveBeenCalledTimes(1);
  });

  it("sends channelId as a request param for a single-channel search", async () => {
    const mockClient = {
      GET: vi.fn().mockResolvedValue({
        data: { messages: [] },
        error: undefined,
        response: mockResponse(),
      }),
    };

    const { result } = renderHook(() => useSearch("dues", "chan-1"), {
      wrapper: createWrapper(queryClient, mockClient, "chapter-a"),
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    // It has to reach the request. The per-source cap is applied by the
    // database across every accessible channel, so a client-side narrowing of
    // the response would return nothing whenever a channel's matches rank
    // below that cut — and could not tell that apart from no matches at all.
    expect(mockClient.GET).toHaveBeenCalledWith("/v1/search", {
      params: { query: { q: "dues", channelId: "chan-1" } },
    });
  });

  it("omits channelId entirely for a chapter-wide search", async () => {
    const mockClient = {
      GET: vi.fn().mockResolvedValue({
        data: { messages: [] },
        error: undefined,
        response: mockResponse(),
      }),
    };

    const { result } = renderHook(() => useSearch("dues"), {
      wrapper: createWrapper(queryClient, mockClient, "chapter-a"),
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    // Not `channelId: undefined` — the param must be absent, so the server
    // takes the chapter-wide branch rather than narrowing to nothing.
    expect(mockClient.GET).toHaveBeenCalledWith("/v1/search", {
      params: { query: { q: "dues" } },
    });
  });

  it("does not reuse one scope's cached results for the other", async () => {
    const channelData = { messages: [{ id: "from-channel" }] };
    const chapterData = { messages: [{ id: "from-chapter" }] };

    // Same chapter, same query string, different scope. If `channelId` were
    // dropped from the query key these would collide, and toggling the scope
    // tabs would render the other scope's hits — which would make the feature
    // look exactly like the client-side filter it must never be.
    queryClient.setQueryData(["search", "chapter-a", "dues", "chan-1"], {
      payload: channelData,
      timedOut: false,
      timedOutSources: [],
    });

    const mockClient = {
      GET: vi.fn().mockResolvedValue({
        data: chapterData,
        error: undefined,
        response: mockResponse(),
      }),
    };

    const { result } = renderHook(() => useSearch("dues"), {
      wrapper: createWrapper(queryClient, mockClient, "chapter-a"),
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(result.current.data?.payload).toEqual(chapterData);
    expect(result.current.data?.payload).not.toEqual(channelData);
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

  it("is disabled for queries shorter than 3 characters", () => {
    const mockClient = { GET: vi.fn() };

    const { result } = renderHook(() => useSearch("ab"), {
      wrapper: createWrapper(queryClient, mockClient, "chapter-a"),
    });

    expect(mockClient.GET).not.toHaveBeenCalled();
    expect(result.current.fetchStatus).toBe("idle");
  });

  // #604: spec/behavior/search.md — clients must distinguish "we found
  // nothing" from "we stopped looking here" via the timeout headers.
  describe("timeout headers", () => {
    it("surfaces a full timeout with no timed-out sources listed", async () => {
      const mockClient = {
        GET: vi.fn().mockResolvedValue({
          data: { members: [] },
          error: undefined,
          response: mockResponse({ "x-search-timeout": "1" }),
        }),
      };

      const { result } = renderHook(() => useSearch("alice"), {
        wrapper: createWrapper(queryClient, mockClient, "chapter-a"),
      });

      await waitFor(() => expect(result.current.isSuccess).toBe(true));

      expect(result.current.data).toEqual({
        payload: { members: [] },
        timedOut: true,
        timedOutSources: [],
      });
    });

    it("parses timed-out sources when results are otherwise present (per-source budget)", async () => {
      const payload = { members: [{ id: "m1" }], messages: [] };
      const mockClient = {
        GET: vi.fn().mockResolvedValue({
          data: payload,
          error: undefined,
          response: mockResponse({
            "x-search-timeout": "1",
            "x-search-timeout-sources": "messages",
          }),
        }),
      };

      const { result } = renderHook(() => useSearch("alice"), {
        wrapper: createWrapper(queryClient, mockClient, "chapter-a"),
      });

      await waitFor(() => expect(result.current.isSuccess).toBe(true));

      expect(result.current.data).toEqual({
        payload,
        timedOut: true,
        timedOutSources: ["messages"],
      });
    });

    it("parses multiple comma-separated timed-out sources", async () => {
      const mockClient = {
        GET: vi.fn().mockResolvedValue({
          data: {},
          error: undefined,
          response: mockResponse({
            "x-search-timeout": "1",
            "x-search-timeout-sources": "messages, events",
          }),
        }),
      };

      const { result } = renderHook(() => useSearch("alice"), {
        wrapper: createWrapper(queryClient, mockClient, "chapter-a"),
      });

      await waitFor(() => expect(result.current.isSuccess).toBe(true));

      expect(result.current.data?.timedOutSources).toEqual([
        "messages",
        "events",
      ]);
    });

    it("ignores an unrecognized source name rather than surfacing it", async () => {
      const mockClient = {
        GET: vi.fn().mockResolvedValue({
          data: {},
          error: undefined,
          response: mockResponse({
            "x-search-timeout": "1",
            "x-search-timeout-sources": "messages,something-new",
          }),
        }),
      };

      const { result } = renderHook(() => useSearch("alice"), {
        wrapper: createWrapper(queryClient, mockClient, "chapter-a"),
      });

      await waitFor(() => expect(result.current.isSuccess).toBe(true));

      expect(result.current.data?.timedOutSources).toEqual(["messages"]);
    });
  });
});
