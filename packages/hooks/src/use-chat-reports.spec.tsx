import { renderHook, waitFor } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import React from "react";
import {
  chatReportKeys,
  useChatReports,
  useRemoveReportedMessage,
  useResolveChatReport,
} from "./use-chat-reports";
import { FrappClientProvider } from "./use-frapp-client";

const CHAPTER = "chap-1";

function createTestQueryClient() {
  return new QueryClient({
    defaultOptions: {
      queries: { retry: false },
      mutations: { retry: false },
    },
  });
}

function createWrapper(
  queryClient: QueryClient,
  mockClient: unknown,
  chapterId: string | null = CHAPTER,
) {
  const Wrapper = ({ children }: { children: React.ReactNode }) => (
    <FrappClientProvider
      chapterId={chapterId}
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

describe("useChatReports", () => {
  let queryClient: QueryClient;

  beforeEach(() => {
    queryClient = createTestQueryClient();
  });

  it("reads one status slice, defaulting to the open queue", async () => {
    const mockGet = vi.fn().mockResolvedValue({ data: [], error: null });
    const { result } = renderHook(() => useChatReports(), {
      wrapper: createWrapper(queryClient, { GET: mockGet }),
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(mockGet).toHaveBeenCalledWith("/v1/chat/reports", {
      params: { query: { status: "open" } },
    });
  });

  it("passes the requested status and caches each slice under its own chapter-scoped key", async () => {
    const rows = [{ id: "r-1", status: "dismissed" }];
    const mockGet = vi.fn().mockResolvedValue({ data: rows, error: null });
    const { result } = renderHook(() => useChatReports("dismissed"), {
      wrapper: createWrapper(queryClient, { GET: mockGet }),
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(mockGet).toHaveBeenCalledWith("/v1/chat/reports", {
      params: { query: { status: "dismissed" } },
    });
    expect(
      queryClient.getQueryData(
        chatReportKeys.list(CHAPTER, { status: "dismissed" }),
      ),
    ).toEqual(rows);
  });

  it("does not fetch without an active chapter", () => {
    const mockGet = vi.fn();
    const { result } = renderHook(() => useChatReports(), {
      wrapper: createWrapper(queryClient, { GET: mockGet }, null),
    });

    expect(result.current.fetchStatus).toBe("idle");
    expect(mockGet).not.toHaveBeenCalled();
  });

  it("surfaces the API error body rather than an empty list", async () => {
    const body = { statusCode: 403, message: "Forbidden" };
    const mockGet = vi.fn().mockResolvedValue({ data: undefined, error: body });
    const { result } = renderHook(() => useChatReports(), {
      wrapper: createWrapper(queryClient, { GET: mockGet }),
    });

    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(result.current.error).toBe(body);
  });
});

describe("useResolveChatReport", () => {
  let queryClient: QueryClient;

  beforeEach(() => {
    queryClient = createTestQueryClient();
  });

  it("PATCHes the status and refreshes every slice of this chapter's queue", async () => {
    const mockPatch = vi.fn().mockResolvedValue({
      data: { id: "r-1", status: "dismissed" },
      error: null,
    });
    const invalidate = vi.spyOn(queryClient, "invalidateQueries");
    const { result } = renderHook(() => useResolveChatReport(), {
      wrapper: createWrapper(queryClient, { PATCH: mockPatch }),
    });

    await result.current.mutateAsync({ id: "r-1", status: "dismissed" });

    expect(mockPatch).toHaveBeenCalledWith("/v1/chat/reports/{id}", {
      params: { path: { id: "r-1" } },
      body: { status: "dismissed" },
    });
    expect(invalidate).toHaveBeenCalledWith({
      queryKey: chatReportKeys.lists(CHAPTER),
    });
  });

  it("still refreshes the queue when the server refuses, because the cached row is stale", async () => {
    const mockPatch = vi.fn().mockResolvedValue({
      data: undefined,
      error: { statusCode: 404, message: "Report not found" },
    });
    const invalidate = vi.spyOn(queryClient, "invalidateQueries");
    const { result } = renderHook(() => useResolveChatReport(), {
      wrapper: createWrapper(queryClient, { PATCH: mockPatch }),
    });

    await expect(
      result.current.mutateAsync({ id: "r-1", status: "reviewed" }),
    ).rejects.toEqual({ statusCode: 404, message: "Report not found" });
    expect(invalidate).toHaveBeenCalledWith({
      queryKey: chatReportKeys.lists(CHAPTER),
    });
  });
});

describe("useRemoveReportedMessage", () => {
  let queryClient: QueryClient;

  beforeEach(() => {
    queryClient = createTestQueryClient();
  });

  it("posts the report id alone — never a message id — to the report's command route", async () => {
    const mockPost = vi.fn().mockResolvedValue({
      data: { id: "r-1", status: "actioned" },
      error: null,
    });
    const { result } = renderHook(() => useRemoveReportedMessage(), {
      wrapper: createWrapper(queryClient, { POST: mockPost }),
    });

    await result.current.mutateAsync("r-1");

    expect(mockPost).toHaveBeenCalledTimes(1);
    expect(mockPost).toHaveBeenCalledWith(
      "/v1/chat/reports/{id}/remove-message",
      { params: { path: { id: "r-1" } } },
    );
  });

  it("refreshes the queue and every cached pin list, and nothing else", async () => {
    queryClient.setQueryData(["channels", "chan-1", "pins"], []);
    queryClient.setQueryData(["channels", "chan-2", "pins"], []);
    queryClient.setQueryData(["channels"], []);
    queryClient.setQueryData(["channels", "categories"], []);
    queryClient.setQueryData(
      chatReportKeys.list(CHAPTER, { status: "open" }),
      [],
    );
    queryClient.setQueryData(
      chatReportKeys.list("chap-2", { status: "open" }),
      [],
    );

    const mockPost = vi.fn().mockResolvedValue({
      data: { id: "r-1", status: "actioned" },
      error: null,
    });
    const { result } = renderHook(() => useRemoveReportedMessage(), {
      wrapper: createWrapper(queryClient, { POST: mockPost }),
    });

    await result.current.mutateAsync("r-1");

    const invalidated = (key: readonly unknown[]) =>
      queryClient.getQueryState(key)?.isInvalidated;
    await waitFor(() =>
      expect(
        invalidated(chatReportKeys.list(CHAPTER, { status: "open" })),
      ).toBe(true),
    );
    expect(invalidated(["channels", "chan-1", "pins"])).toBe(true);
    expect(invalidated(["channels", "chan-2", "pins"])).toBe(true);
    expect(invalidated(["channels"])).toBe(false);
    expect(invalidated(["channels", "categories"])).toBe(false);
    // Another chapter's queue is not this officer's to refresh.
    expect(invalidated(chatReportKeys.list("chap-2", { status: "open" }))).toBe(
      false,
    );
  });

  it("refreshes the queue on a 409 but leaves pins alone, since nothing was removed", async () => {
    queryClient.setQueryData(["channels", "chan-1", "pins"], []);
    queryClient.setQueryData(
      chatReportKeys.list(CHAPTER, { status: "open" }),
      [],
    );
    const refusal = {
      statusCode: 409,
      message: "The reported message is already deleted",
    };
    const mockPost = vi
      .fn()
      .mockResolvedValue({ data: undefined, error: refusal });
    const { result } = renderHook(() => useRemoveReportedMessage(), {
      wrapper: createWrapper(queryClient, { POST: mockPost }),
    });

    await expect(result.current.mutateAsync("r-1")).rejects.toBe(refusal);

    await waitFor(() =>
      expect(
        queryClient.getQueryState(
          chatReportKeys.list(CHAPTER, { status: "open" }),
        )?.isInvalidated,
      ).toBe(true),
    );
    expect(
      queryClient.getQueryState(["channels", "chan-1", "pins"])?.isInvalidated,
    ).toBe(false);
  });
});
