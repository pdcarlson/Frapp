import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import React from "react";
import {
  chatBlockKeys,
  useBlockedUserIds,
  useBlockMember,
  useReportMessage,
  useUnblockMember,
} from "./use-chat-safety";
import { bookmarkKeys } from "./use-chat";
import { FrappClientProvider } from "./use-frapp-client";

const CHAPTER = "chapter-1";
const ALICE = "11111111-1111-4111-8111-111111111111";
const BOB = "22222222-2222-4222-8222-222222222222";

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
  Wrapper.displayName = "Wrapper";
  return Wrapper;
}

describe("useBlockedUserIds", () => {
  let queryClient: QueryClient;

  beforeEach(() => {
    queryClient = createTestQueryClient();
  });

  it("is ready with the server's ids once the read lands", async () => {
    const GET = vi
      .fn()
      .mockResolvedValue({ data: { blocked_user_ids: [ALICE] }, error: null });

    const { result } = renderHook(() => useBlockedUserIds(), {
      wrapper: createWrapper(queryClient, { GET }),
    });

    expect(result.current.status).toBe("loading");
    await waitFor(() => expect(result.current.status).toBe("ready"));

    expect(GET).toHaveBeenCalledWith("/v1/chat/blocks");
    expect([...result.current.ids]).toEqual([ALICE]);
  });

  it("an empty list is ready, and is not the same thing as a failed read", async () => {
    const GET = vi
      .fn()
      .mockResolvedValue({ data: { blocked_user_ids: [] }, error: null });

    const { result } = renderHook(() => useBlockedUserIds(), {
      wrapper: createWrapper(queryClient, { GET }),
    });

    await waitFor(() => expect(result.current.status).toBe("ready"));
    expect(result.current.ids.size).toBe(0);
  });

  it("a failed first read is unavailable, never an empty ready list", async () => {
    const GET = vi
      .fn()
      .mockResolvedValue({ data: undefined, error: { message: "boom" } });

    const { result } = renderHook(() => useBlockedUserIds(), {
      wrapper: createWrapper(queryClient, { GET }),
    });

    await waitFor(() => expect(result.current.status).toBe("unavailable"));
    expect(result.current.ids.size).toBe(0);
  });

  it("a body it cannot read is unavailable rather than 'nobody is blocked'", async () => {
    const GET = vi
      .fn()
      .mockResolvedValue({ data: { blocked_user_ids: "nope" }, error: null });

    const { result } = renderHook(() => useBlockedUserIds(), {
      wrapper: createWrapper(queryClient, { GET }),
    });

    await waitFor(() => expect(result.current.status).toBe("unavailable"));
  });

  it("an error wins over cached data, which survives only as a floor (#2315 defect 3)", async () => {
    const GET = vi
      .fn()
      .mockResolvedValueOnce({
        data: { blocked_user_ids: [ALICE] },
        error: null,
      })
      .mockResolvedValueOnce({ data: undefined, error: { message: "boom" } });

    const { result } = renderHook(() => useBlockedUserIds(), {
      wrapper: createWrapper(queryClient, { GET }),
    });
    await waitFor(() => expect(result.current.status).toBe("ready"));

    act(() => result.current.retry());

    await waitFor(() => expect(result.current.status).toBe("unavailable"));
    // TanStack kept `data`; the hook must not read it as a confirmed list, but
    // everyone on it is still known-blocked.
    expect(result.current.ids.has(ALICE)).toBe(true);
    expect(result.current.isRetrying).toBe(false);
  });

  it("does not read, and does not claim ready, without a chapter", () => {
    const GET = vi.fn();

    const { result } = renderHook(() => useBlockedUserIds(), {
      wrapper: createWrapper(queryClient, { GET }, null),
    });

    expect(GET).not.toHaveBeenCalled();
    expect(result.current.status).toBe("loading");
  });
});

describe("useBlockMember / useUnblockMember", () => {
  let queryClient: QueryClient;

  beforeEach(() => {
    queryClient = createTestQueryClient();
  });

  it("posts the target id and folds it into a readable cached list", async () => {
    queryClient.setQueryData(chatBlockKeys.list(CHAPTER), [BOB]);
    const POST = vi.fn().mockResolvedValue({ data: { id: "b1" }, error: null });
    const invalidate = vi.spyOn(queryClient, "invalidateQueries");

    const { result } = renderHook(() => useBlockMember(), {
      wrapper: createWrapper(queryClient, { POST }),
    });

    await act(() => result.current.mutateAsync(ALICE));

    expect(POST).toHaveBeenCalledWith("/v1/chat/blocks", {
      body: { user_id: ALICE },
    });
    expect(queryClient.getQueryData(chatBlockKeys.list(CHAPTER))).toEqual([
      BOB,
      ALICE,
    ]);
    expect(invalidate).toHaveBeenCalledWith({
      queryKey: chatBlockKeys.lists(CHAPTER),
    });
    expect(invalidate).toHaveBeenCalledWith({
      queryKey: bookmarkKeys.lists(CHAPTER),
    });
  });

  it("does not seed a list that was never read", async () => {
    // A seeded `[ALICE]` would report `ready` with one id and nobody else.
    const POST = vi.fn().mockResolvedValue({ data: { id: "b1" }, error: null });

    const { result } = renderHook(() => useBlockMember(), {
      wrapper: createWrapper(queryClient, { POST }),
    });
    await act(() => result.current.mutateAsync(ALICE));

    expect(
      queryClient.getQueryState(chatBlockKeys.list(CHAPTER))?.status,
    ).not.toBe("success");
  });

  it("does not flip an unavailable list to ready by writing over it", async () => {
    const GET = vi
      .fn()
      .mockResolvedValue({ data: undefined, error: { message: "boom" } });
    const POST = vi.fn().mockResolvedValue({ data: { id: "b1" }, error: null });

    const { result } = renderHook(
      () => ({ list: useBlockedUserIds(), block: useBlockMember() }),
      { wrapper: createWrapper(queryClient, { GET, POST }) },
    );
    await waitFor(() => expect(result.current.list.status).toBe("unavailable"));

    await act(() => result.current.block.mutateAsync(ALICE));

    await waitFor(() => expect(result.current.list.isRetrying).toBe(false));
    expect(result.current.list.status).toBe("unavailable");
  });

  it("deletes by path and drops the id from the cached list", async () => {
    queryClient.setQueryData(chatBlockKeys.list(CHAPTER), [ALICE, BOB]);
    const DELETE = vi.fn().mockResolvedValue({ data: undefined, error: null });

    const { result } = renderHook(() => useUnblockMember(), {
      wrapper: createWrapper(queryClient, { DELETE }),
    });
    await act(() => result.current.mutateAsync(ALICE));

    expect(DELETE).toHaveBeenCalledWith("/v1/chat/blocks/{userId}", {
      params: { path: { userId: ALICE } },
    });
    expect(queryClient.getQueryData(chatBlockKeys.list(CHAPTER))).toEqual([
      BOB,
    ]);
  });

  it("leaves the cached list alone when the write fails", async () => {
    queryClient.setQueryData(chatBlockKeys.list(CHAPTER), [BOB]);
    const POST = vi
      .fn()
      .mockResolvedValue({ data: undefined, error: { message: "nope" } });

    const { result } = renderHook(() => useBlockMember(), {
      wrapper: createWrapper(queryClient, { POST }),
    });
    await expect(
      act(() => result.current.mutateAsync(ALICE)),
    ).rejects.toBeDefined();

    expect(queryClient.getQueryData(chatBlockKeys.list(CHAPTER))).toEqual([
      BOB,
    ]);
  });
});

describe("useReportMessage", () => {
  it("posts message id, reason and trimmed details", async () => {
    const POST = vi
      .fn()
      .mockResolvedValue({ data: { id: "r1", status: "open" }, error: null });

    const { result } = renderHook(() => useReportMessage(), {
      wrapper: createWrapper(createTestQueryClient(), { POST }),
    });
    await act(() =>
      result.current.mutateAsync({
        messageId: "m1",
        reason: "harassment",
        details: "  keeps DMing me  ",
      }),
    );

    expect(POST).toHaveBeenCalledWith("/v1/chat/reports", {
      body: {
        message_id: "m1",
        reason: "harassment",
        details: "keeps DMing me",
      },
    });
  });

  it("sends blank details as absent rather than an empty string", async () => {
    const POST = vi
      .fn()
      .mockResolvedValue({ data: { id: "r1", status: "open" }, error: null });

    const { result } = renderHook(() => useReportMessage(), {
      wrapper: createWrapper(createTestQueryClient(), { POST }),
    });
    await act(() =>
      result.current.mutateAsync({
        messageId: "m1",
        reason: "spam",
        details: "   ",
      }),
    );

    expect(POST).toHaveBeenCalledWith("/v1/chat/reports", {
      body: { message_id: "m1", reason: "spam" },
    });
  });

  it("surfaces a rejected report as an error rather than a silent success", async () => {
    const POST = vi
      .fn()
      .mockResolvedValue({ data: undefined, error: { message: "forbidden" } });

    const { result } = renderHook(() => useReportMessage(), {
      wrapper: createWrapper(createTestQueryClient(), { POST }),
    });

    await expect(
      act(() =>
        result.current.mutateAsync({ messageId: "m1", reason: "other" }),
      ),
    ).rejects.toEqual({ message: "forbidden" });
  });
});
