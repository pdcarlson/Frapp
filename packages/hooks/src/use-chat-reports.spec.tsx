import { renderHook, waitFor } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import React from "react";
import {
  chatReportKeys,
  readsRemovedMessage,
  removalOutcomeUnknown,
  useChatReports,
  useInvalidateChatReports,
  useRemoveReportedMessage,
  useResolveChatReport,
  type ReportedMessageTimeline,
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

describe("useInvalidateChatReports", () => {
  it("marks every slice of this chapter's queue stale, and no other chapter's", async () => {
    const queryClient = createTestQueryClient();
    queryClient.setQueryData(
      chatReportKeys.list(CHAPTER, { status: "open" }),
      [],
    );
    queryClient.setQueryData(
      chatReportKeys.list(CHAPTER, { status: "actioned" }),
      [],
    );
    queryClient.setQueryData(
      chatReportKeys.list("chap-2", { status: "open" }),
      [],
    );
    const { result } = renderHook(() => useInvalidateChatReports(), {
      wrapper: createWrapper(queryClient, {}),
    });

    await result.current();

    const stale = (key: readonly unknown[]) =>
      queryClient.getQueryState(key)?.isInvalidated;
    expect(stale(chatReportKeys.list(CHAPTER, { status: "open" }))).toBe(true);
    expect(stale(chatReportKeys.list(CHAPTER, { status: "actioned" }))).toBe(
      true,
    );
    expect(stale(chatReportKeys.list("chap-2", { status: "open" }))).toBe(
      false,
    );
  });

  it("does nothing without an active chapter", async () => {
    const queryClient = createTestQueryClient();
    const invalidate = vi.spyOn(queryClient, "invalidateQueries");
    const { result } = renderHook(() => useInvalidateChatReports(), {
      wrapper: createWrapper(queryClient, {}, null),
    });

    await result.current();

    expect(invalidate).not.toHaveBeenCalled();
  });
});

describe("useRemoveReportedMessage", () => {
  let queryClient: QueryClient;
  let timeline: {
    markRemoved: ReturnType<typeof vi.fn>;
    refetchHolding: ReturnType<typeof vi.fn>;
  };

  const REPORT = { id: "r-1", message_id: "m-1" } as const;

  beforeEach(() => {
    queryClient = createTestQueryClient();
    timeline = { markRemoved: vi.fn(), refetchHolding: vi.fn() };
  });

  function renderRemove(mockClient: unknown, client = queryClient) {
    return renderHook(
      () => useRemoveReportedMessage(timeline as ReportedMessageTimeline),
      { wrapper: createWrapper(client, mockClient) },
    );
  }

  it("posts the report id alone — never a message id — to the report's command route", async () => {
    const mockPost = vi.fn().mockResolvedValue({
      data: { id: "r-1", status: "actioned" },
      error: null,
    });
    const { result } = renderRemove({ POST: mockPost });

    await result.current.mutateAsync(REPORT);

    expect(mockPost).toHaveBeenCalledTimes(1);
    expect(mockPost).toHaveBeenCalledWith(
      "/v1/chat/reports/{id}/remove-message",
      { params: { path: { id: "r-1" } } },
    );
  });

  /** Every non-timeline key a removal of m-1 in chan-1 should refetch. */
  const MESSAGE_READS = [
    ["channels", "chan-1", "pins"],
    ["channels", "chan-1", "messages", "m-1", "attachments"],
    bookmarkKeys.list(CHAPTER),
    ["search", CHAPTER, "harassment", null],
    ["search", CHAPTER, "harassment", "chan-1"],
  ] as const;
  /** Reads a removal of m-1 in chan-1 must leave alone. */
  const UNRELATED = [
    // Timelines belong to the timeline adapter: refetching one drops the
    // member's unsent outbox rows from view, so none is invalidated here.
    ["chat", "chan-1", "messages"],
    ["chat", "chan-2", "messages"],
    ["channels", "chan-2", "pins"],
    ["channels", "chan-1", "messages", "m-other", "attachments"],
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

  const openQueueRefreshed = () =>
    waitFor(() =>
      expect(
        invalidated(chatReportKeys.list(CHAPTER, { status: "open" })),
      ).toBe(true),
    );

  it("patches the removed message in its own channel's timeline, and refetches only that channel's other reads", async () => {
    seedCaches();
    const mockPost = vi.fn().mockResolvedValue({
      data: {
        id: "r-1",
        message_id: "m-1",
        status: "actioned",
        message_already_deleted: false,
        channel_id: "chan-1",
      },
      error: null,
    });
    const { result } = renderRemove({ POST: mockPost });

    await result.current.mutateAsync(REPORT);

    await openQueueRefreshed();
    expect(timeline.markRemoved).toHaveBeenCalledWith(
      queryClient,
      "chan-1",
      "m-1",
    );
    expect(timeline.refetchHolding).not.toHaveBeenCalled();
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

  it("patches the timeline when the message was already deleted too", async () => {
    // Nothing was removed by this call, but the caches may predate whoever did
    // remove it, and the report is now closed either way.
    seedCaches();
    const mockPost = vi.fn().mockResolvedValue({
      data: {
        id: "r-1",
        message_id: "m-1",
        status: "actioned",
        message_already_deleted: true,
        channel_id: "chan-1",
      },
      error: null,
    });
    const { result } = renderRemove({ POST: mockPost });

    await expect(result.current.mutateAsync(REPORT)).resolves.toMatchObject({
      message_already_deleted: true,
    });
    await openQueueRefreshed();
    expect(timeline.markRemoved).toHaveBeenCalledWith(
      queryClient,
      "chan-1",
      "m-1",
    );
    expect(invalidated(["channels", "chan-1", "pins"])).toBe(true);
  });

  it("refetches the timelines holding the message when a success names no channel (the row is gone)", async () => {
    seedCaches();
    const mockPost = vi.fn().mockResolvedValue({
      data: {
        id: "r-1",
        message_id: "m-1",
        status: "actioned",
        message_already_deleted: true,
        channel_id: null,
      },
      error: null,
    });
    const { result } = renderRemove({ POST: mockPost });

    await result.current.mutateAsync(REPORT);

    await openQueueRefreshed();
    expect(timeline.markRemoved).not.toHaveBeenCalled();
    expect(timeline.refetchHolding).toHaveBeenCalledWith(queryClient, "m-1");
  });

  it.each([
    [
      "a 500 with a message body",
      {
        data: undefined,
        error: { statusCode: 500, message: "Internal server error" },
      },
    ],
    [
      "a 503 from the gateway",
      { data: undefined, error: { statusCode: 503, message: "Unavailable" } },
    ],
  ])(
    "refreshes the reads that may still show the message after %s, since the removal may have landed",
    async (_label, response) => {
      seedCaches();
      const mockPost = vi.fn().mockResolvedValue(response);
      const { result } = renderRemove({ POST: mockPost });

      await expect(result.current.mutateAsync(REPORT)).rejects.toBe(
        response.error,
      );

      await openQueueRefreshed();
      // No response named the channel: only the cached timelines that hold
      // the message are refetched, and every channel's pin list.
      expect(timeline.refetchHolding).toHaveBeenCalledWith(queryClient, "m-1");
      expect(timeline.markRemoved).not.toHaveBeenCalled();
      expect(invalidated(["channels", "chan-1", "pins"])).toBe(true);
      expect(invalidated(["channels", "chan-2", "pins"])).toBe(true);
      expect(
        invalidated(["channels", "chan-1", "messages", "m-1", "attachments"]),
      ).toBe(true);
      expect(invalidated(bookmarkKeys.list(CHAPTER))).toBe(true);
      expect(invalidated(["chat", "chan-1", "messages"])).toBe(false);
    },
  );

  it("does the same after a transport failure, which may have landed too", async () => {
    seedCaches();
    const mockPost = vi
      .fn()
      .mockRejectedValue(new TypeError("Failed to fetch"));
    const { result } = renderRemove({ POST: mockPost });

    await expect(result.current.mutateAsync(REPORT)).rejects.toThrow(
      "Failed to fetch",
    );

    await openQueueRefreshed();
    expect(timeline.refetchHolding).toHaveBeenCalledWith(queryClient, "m-1");
  });

  it("refreshes the queue on a 409 but leaves every message read alone, since the route refuses before touching the message", async () => {
    // The report is claimed before the message is removed, so every 4xx is
    // decided with nothing removed — there is no post-removal 409.
    seedCaches();
    const refusal = {
      statusCode: 409,
      message: "This report is no longer open",
    };
    const mockPost = vi
      .fn()
      .mockResolvedValue({ data: undefined, error: refusal });
    const { result } = renderRemove({ POST: mockPost });

    await expect(result.current.mutateAsync(REPORT)).rejects.toBe(refusal);

    await openQueueRefreshed();
    expect(timeline.markRemoved).not.toHaveBeenCalled();
    expect(timeline.refetchHolding).not.toHaveBeenCalled();
    for (const key of MESSAGE_READS) {
      expect(invalidated(key), JSON.stringify(key)).toBe(false);
    }
  });

  it("does not retry, even where the client retries mutations by default", async () => {
    // Idempotent, so safe — but a retry after a lost response would answer
    // "already removed" for the removal this officer just made.
    const retrying = createRetryingQueryClient();
    const mockPost = vi.fn().mockRejectedValue(new Error("network"));
    const { result } = renderRemove({ POST: mockPost }, retrying);

    await expect(result.current.mutateAsync(REPORT)).rejects.toThrow("network");
    expect(mockPost).toHaveBeenCalledTimes(1);
  });
});

describe("readsRemovedMessage", () => {
  const target = { chapterId: CHAPTER, messageId: "m-1", channelId: "chan-1" };

  it("never matches a timeline — those are the adapter's — whatever the channel", () => {
    expect(readsRemovedMessage(["chat", "chan-1", "messages"], target)).toBe(
      false,
    );
    expect(
      readsRemovedMessage(["chat", "chan-1", "messages"], {
        ...target,
        channelId: null,
      }),
    ).toBe(false);
  });

  it("matches every channel's pins only when the channel is unknown", () => {
    const unknown = { ...target, channelId: null };
    expect(readsRemovedMessage(["channels", "chan-2", "pins"], target)).toBe(
      false,
    );
    expect(readsRemovedMessage(["channels", "chan-2", "pins"], unknown)).toBe(
      true,
    );
    expect(
      readsRemovedMessage(
        ["channels", "chan-2", "messages", "m-1", "attachments"],
        unknown,
      ),
    ).toBe(true);
  });

  it("matches nothing chapter-scoped from another chapter", () => {
    expect(readsRemovedMessage(bookmarkKeys.list("chap-2"), target)).toBe(
      false,
    );
    expect(readsRemovedMessage(["search", "chap-2", "q", null], target)).toBe(
      false,
    );
  });
});

describe("removalOutcomeUnknown", () => {
  it("is true for a 5xx, even one carrying a message, and for a failure with no status", () => {
    expect(
      removalOutcomeUnknown({
        statusCode: 500,
        message: "Internal server error",
      }),
    ).toBe(true);
    expect(removalOutcomeUnknown({ statusCode: 502 })).toBe(true);
    expect(removalOutcomeUnknown(new TypeError("Failed to fetch"))).toBe(true);
  });

  it("is false for a 4xx, which the route answers before touching the message", () => {
    expect(removalOutcomeUnknown({ statusCode: 409, message: "x" })).toBe(
      false,
    );
    expect(removalOutcomeUnknown({ statusCode: 404 })).toBe(false);
    expect(removalOutcomeUnknown({ statusCode: 403 })).toBe(false);
  });
});
