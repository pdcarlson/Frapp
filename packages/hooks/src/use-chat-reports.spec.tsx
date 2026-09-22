import { renderHook, waitFor } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import React from "react";
import {
  chatReportKeys,
  readsMessageContent,
  useChatReports,
  useRemoveReportedMessage,
  useResolveChatReport,
} from "./use-chat-reports";
import { bookmarkKeys } from "./use-chat";
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

/**
 * The web dashboard's defaults (`apps/web/lib/providers/query-provider.tsx`
 * retries every mutation twice), with no delay so a retry would show up
 * inside the test.
 */
function createRetryingQueryClient() {
  return new QueryClient({
    defaultOptions: {
      queries: { retry: false },
      mutations: { retry: 2, retryDelay: 0 },
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

  it("does not retry, even where the client retries mutations by default", async () => {
    // A compare-and-set on `status = 'open'`: a retry after a lost response
    // is a guaranteed 409 for a resolution that actually landed.
    const retrying = createRetryingQueryClient();
    const mockPatch = vi.fn().mockRejectedValue(new Error("network"));
    const { result } = renderHook(() => useResolveChatReport(), {
      wrapper: createWrapper(retrying, { PATCH: mockPatch }),
    });

    await expect(
      result.current.mutateAsync({ id: "r-1", status: "reviewed" }),
    ).rejects.toThrow("network");
    expect(mockPatch).toHaveBeenCalledTimes(1);
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

  /** Every key this suite seeds, and whether a removal should refetch it. */
  const MESSAGE_READS = [
    // `@repo/chat-core`'s timeline (`chatMessagesKey`), for any channel.
    ["chat", "chan-1", "messages"],
    ["chat", "chan-2", "messages"],
    ["channels", "chan-1", "pins"],
    ["channels", "chan-2", "pins"],
    ["channels", "chan-1", "messages", "m-1", "attachments"],
    bookmarkKeys.list(CHAPTER),
    ["search", CHAPTER, "harassment", null],
    ["search", CHAPTER, "harassment", "chan-1"],
  ] as const;
  const UNRELATED = [
    ["channels"],
    ["channels", "categories"],
    ["channels", "unread"],
    ["channels", "chan-1"],
    // Another chapter's rows are not this removal's to refresh.
    bookmarkKeys.list("chap-2"),
    ["search", "chap-2", "harassment", null],
    ["members", CHAPTER, "search", "harper"],
  ] as const;

  function seedCaches() {
    for (const key of [...MESSAGE_READS, ...UNRELATED]) {
      queryClient.setQueryData(key, []);
    }
    queryClient.setQueryData(
      chatReportKeys.list(CHAPTER, { status: "open" }),
      [],
    );
    queryClient.setQueryData(
      chatReportKeys.list("chap-2", { status: "open" }),
      [],
    );
  }

  const invalidated = (key: readonly unknown[]) =>
    queryClient.getQueryState(key)?.isInvalidated;

  it("refreshes the queue and every cached read that can still show the removed text", async () => {
    // The response is the report, never the message, and the report does not
    // name its channel — so there is no row to merge and no single key to
    // target. A timeline cached from an earlier visit is `staleTime: Infinity`
    // and only a subscribed channel hears the realtime echo, so without this
    // the removed text comes back when the officer returns to it.
    seedCaches();
    const mockPost = vi.fn().mockResolvedValue({
      data: { id: "r-1", status: "actioned", message_already_deleted: false },
      error: null,
    });
    const { result } = renderHook(() => useRemoveReportedMessage(), {
      wrapper: createWrapper(queryClient, { POST: mockPost }),
    });

    await result.current.mutateAsync("r-1");

    await waitFor(() =>
      expect(
        invalidated(chatReportKeys.list(CHAPTER, { status: "open" })),
      ).toBe(true),
    );
    for (const key of MESSAGE_READS) {
      expect(invalidated(key), JSON.stringify(key)).toBe(true);
    }
    for (const key of UNRELATED) {
      expect(invalidated(key), JSON.stringify(key)).toBe(false);
    }
    // Another chapter's queue is not this officer's to refresh.
    expect(invalidated(chatReportKeys.list("chap-2", { status: "open" }))).toBe(
      false,
    );
  });

  it("refreshes the message reads when the message was already deleted too", async () => {
    // Nothing was removed by this call, but the caches may predate whoever did
    // remove it, and the report is now closed either way.
    seedCaches();
    const mockPost = vi.fn().mockResolvedValue({
      data: { id: "r-1", status: "actioned", message_already_deleted: true },
      error: null,
    });
    const { result } = renderHook(() => useRemoveReportedMessage(), {
      wrapper: createWrapper(queryClient, { POST: mockPost }),
    });

    await expect(result.current.mutateAsync("r-1")).resolves.toMatchObject({
      message_already_deleted: true,
    });
    await waitFor(() =>
      expect(invalidated(["chat", "chan-1", "messages"])).toBe(true),
    );
  });

  it("refreshes the queue on a 409 but leaves every message read alone, since nothing was removed", async () => {
    seedCaches();
    const refusal = {
      statusCode: 409,
      message: "This report is no longer open",
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
        invalidated(chatReportKeys.list(CHAPTER, { status: "open" })),
      ).toBe(true),
    );
    for (const key of MESSAGE_READS) {
      expect(invalidated(key), JSON.stringify(key)).toBe(false);
    }
  });

  it("does not retry, even where the client retries mutations by default", async () => {
    // A retry after a lost response finds the report `actioned` and is
    // answered 409 — a removal that happened, reported as one that failed.
    const retrying = createRetryingQueryClient();
    const mockPost = vi.fn().mockRejectedValue(new Error("network"));
    const { result } = renderHook(() => useRemoveReportedMessage(), {
      wrapper: createWrapper(retrying, { POST: mockPost }),
    });

    await expect(result.current.mutateAsync("r-1")).rejects.toThrow("network");
    expect(mockPost).toHaveBeenCalledTimes(1);
  });
});

describe("readsMessageContent", () => {
  it("matches a timeline for any channel, and nothing chapter-scoped from another chapter", () => {
    expect(
      readsMessageContent(["chat", "any-channel", "messages"], CHAPTER),
    ).toBe(true);
    expect(readsMessageContent(["chat", "none"], CHAPTER)).toBe(false);
    expect(readsMessageContent(bookmarkKeys.list("chap-2"), CHAPTER)).toBe(
      false,
    );
    expect(readsMessageContent(["search", "chap-2", "q", null], CHAPTER)).toBe(
      false,
    );
  });
});
