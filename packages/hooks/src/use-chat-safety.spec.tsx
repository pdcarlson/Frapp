import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  onlineManager,
  QueryClient,
  QueryClientProvider,
} from "@tanstack/react-query";
import React from "react";
import {
  chatBlockKeys,
  confirmedBlockChangesKey,
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

/** What openapi-fetch resolves for a 2xx. */
function ok(data: unknown, headers: Record<string, string> = {}) {
  return { data, response: new Response(null, { status: 200, headers }) };
}

/** A non-2xx with a JSON body, which openapi-fetch parses into `error`. */
function failed(status: number, error: unknown) {
  return { error, response: new Response(null, { status }) };
}

/**
 * A non-2xx with an empty body. openapi-fetch 0.17 reports it as
 * `error: undefined` (or `""` for an empty text body) — falsy, so a client
 * that trusts the error field reads a failure as a success.
 */
function silentFailure(status: number, error: undefined | "" = undefined) {
  return { error, response: new Response(null, { status }) };
}

function blockList(ids: string[]) {
  return ok({ blocked_user_ids: ids });
}

/** A request the test resolves by hand. */
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((res) => {
    resolve = res;
  });
  return { promise, resolve };
}

const never = () => new Promise<never>(() => {});

describe("useBlockedUserIds", () => {
  let queryClient: QueryClient;

  beforeEach(() => {
    queryClient = createTestQueryClient();
  });

  it("is ready with the server's ids once the read lands", async () => {
    const GET = vi.fn().mockResolvedValue(blockList([ALICE]));

    const { result } = renderHook(() => useBlockedUserIds(), {
      wrapper: createWrapper(queryClient, { GET }),
    });

    expect(result.current.status).toBe("loading");
    await waitFor(() => expect(result.current.status).toBe("ready"));

    expect(GET).toHaveBeenCalledWith("/v1/chat/blocks");
    expect([...result.current.ids]).toEqual([ALICE]);
    expect(result.current.unblocked.size).toBe(0);
  });

  it("an empty list is ready, and is not the same thing as a failed read", async () => {
    const GET = vi.fn().mockResolvedValue(blockList([]));

    const { result } = renderHook(() => useBlockedUserIds(), {
      wrapper: createWrapper(queryClient, { GET }),
    });

    await waitFor(() => expect(result.current.status).toBe("ready"));
    expect(result.current.ids.size).toBe(0);
  });

  it("a failed first read is unavailable, never an empty ready list", async () => {
    const GET = vi
      .fn()
      .mockResolvedValue(failed(500, { statusCode: 500, message: "boom" }));

    const { result } = renderHook(() => useBlockedUserIds(), {
      wrapper: createWrapper(queryClient, { GET }),
    });

    await waitFor(() => expect(result.current.status).toBe("unavailable"));
    expect(result.current.ids.size).toBe(0);
  });

  it("a non-2xx with an empty body is unavailable too", async () => {
    const GET = vi.fn().mockResolvedValue(silentFailure(503));

    const { result } = renderHook(() => useBlockedUserIds(), {
      wrapper: createWrapper(queryClient, { GET }),
    });

    await waitFor(() => expect(result.current.status).toBe("unavailable"));
  });

  it("a body it cannot read is unavailable rather than 'nobody is blocked'", async () => {
    const GET = vi.fn().mockResolvedValue(ok({ blocked_user_ids: "nope" }));

    const { result } = renderHook(() => useBlockedUserIds(), {
      wrapper: createWrapper(queryClient, { GET }),
    });

    await waitFor(() => expect(result.current.status).toBe("unavailable"));
  });

  it("an error wins over cached data, which survives only as a floor (#2315 defect 3)", async () => {
    const GET = vi
      .fn()
      .mockResolvedValueOnce(blockList([ALICE]))
      .mockResolvedValueOnce(failed(500, { message: "boom" }));

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

  describe("a paused first read", () => {
    afterEach(() => {
      act(() => onlineManager.setOnline(true));
    });

    it("is unavailable, not loading: nothing is coming until the network is", async () => {
      act(() => onlineManager.setOnline(false));
      const GET = vi.fn().mockResolvedValue(blockList([]));

      const { result } = renderHook(() => useBlockedUserIds(), {
        wrapper: createWrapper(queryClient, { GET }),
      });

      // The default network mode parks the read without calling it at all.
      expect(GET).not.toHaveBeenCalled();
      expect(result.current.status).toBe("unavailable");

      act(() => onlineManager.setOnline(true));
      await waitFor(() => expect(result.current.status).toBe("ready"));
    });
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

  function renderListAndActions(client: unknown) {
    return renderHook(
      () => ({
        list: useBlockedUserIds(),
        block: useBlockMember(),
        unblock: useUnblockMember(),
      }),
      { wrapper: createWrapper(queryClient, client) },
    );
  }

  it("posts the target id, applies it at once, and re-reads the list and bookmarks", async () => {
    const GET = vi
      .fn()
      .mockResolvedValueOnce(blockList([BOB]))
      .mockResolvedValueOnce(blockList([BOB, ALICE]));
    const POST = vi.fn().mockResolvedValue(ok({ id: "b1" }));
    const invalidate = vi.spyOn(queryClient, "invalidateQueries");

    const { result } = renderListAndActions({ GET, POST });
    await waitFor(() => expect(result.current.list.status).toBe("ready"));

    await act(() => result.current.block.mutateAsync(ALICE));

    expect(POST).toHaveBeenCalledWith("/v1/chat/blocks", {
      body: { user_id: ALICE },
    });
    await waitFor(() => expect(result.current.list.ids.has(ALICE)).toBe(true));
    expect(invalidate).toHaveBeenCalledWith({
      queryKey: chatBlockKeys.lists(CHAPTER),
    });
    expect(invalidate).toHaveBeenCalledWith({
      queryKey: bookmarkKeys.lists(CHAPTER),
    });
    await waitFor(() => expect(GET).toHaveBeenCalledTimes(2));
    await waitFor(() =>
      expect([...result.current.list.ids].sort()).toEqual([ALICE, BOB].sort()),
    );
  });

  it("a block confirmed before the list was ever read takes effect without claiming ready", async () => {
    // The first read never lands. Seeding the list's own query with `[ALICE]`
    // would flip it to `ready` with one id and nobody else blocked.
    const GET = vi.fn().mockImplementation(never);
    const POST = vi.fn().mockResolvedValue(ok({ id: "b1" }));

    const { result } = renderListAndActions({ GET, POST });
    expect(result.current.list.status).toBe("loading");

    await act(() => result.current.block.mutateAsync(ALICE));

    await waitFor(() => expect(result.current.list.ids.has(ALICE)).toBe(true));
    expect(result.current.list.status).toBe("loading");
    expect(queryClient.getQueryState(chatBlockKeys.list(CHAPTER))?.status).toBe(
      "pending",
    );
  });

  it("a block confirmed while the list is unavailable takes effect without claiming ready", async () => {
    const GET = vi
      .fn()
      .mockResolvedValueOnce(failed(500, { message: "boom" }))
      // The re-read after the block hangs, so the state it leaves is the one
      // the block itself produced. A write into the list's own query would
      // show here as `success` — `ready` over a list nobody has read.
      .mockImplementation(never);
    const POST = vi.fn().mockResolvedValue(ok({ id: "b1" }));

    const { result } = renderListAndActions({ GET, POST });
    await waitFor(() => expect(result.current.list.status).toBe("unavailable"));

    await act(() => result.current.block.mutateAsync(ALICE));

    await waitFor(() => expect(result.current.list.ids.has(ALICE)).toBe(true));
    // TanStack moves a failed first read back to `pending` while it retries.
    expect(result.current.list.status).toBe("loading");
    expect(queryClient.getQueryState(chatBlockKeys.list(CHAPTER))?.status).toBe(
      "pending",
    );
  });

  it("an unblock confirmed while the list is unavailable removes the id from the floor", async () => {
    const GET = vi
      .fn()
      .mockResolvedValueOnce(blockList([ALICE, BOB]))
      .mockResolvedValue(failed(500, { message: "boom" }));
    const DELETE = vi.fn().mockResolvedValue(ok(undefined));

    const { result } = renderListAndActions({ GET, DELETE });
    await waitFor(() => expect(result.current.list.status).toBe("ready"));
    act(() => result.current.list.retry());
    await waitFor(() => expect(result.current.list.status).toBe("unavailable"));
    expect(result.current.list.ids.has(ALICE)).toBe(true);

    await act(() => result.current.unblock.mutateAsync(ALICE));

    expect(DELETE).toHaveBeenCalledWith("/v1/chat/blocks/{userId}", {
      params: { path: { userId: ALICE } },
    });
    await waitFor(() => expect(result.current.list.ids.has(ALICE)).toBe(false));
    expect(result.current.list.ids.has(BOB)).toBe(true);
    expect(result.current.list.unblocked.has(ALICE)).toBe(true);
    await waitFor(() => expect(result.current.list.isRetrying).toBe(false));
    expect(result.current.list.status).toBe("unavailable");
  });

  it("a read in flight during the block cannot bring back the pre-block list (finding 5b)", async () => {
    const first = deferred<ReturnType<typeof blockList>>();
    const second = deferred<ReturnType<typeof blockList>>();
    const GET = vi
      .fn()
      .mockReturnValueOnce(first.promise)
      .mockReturnValueOnce(second.promise);
    const POST = vi.fn().mockResolvedValue(ok({ id: "b1" }));

    const { result } = renderListAndActions({ GET, POST });
    expect(GET).toHaveBeenCalledTimes(1);

    await act(() => result.current.block.mutateAsync(ALICE));
    // The stale read was cancelled and a fresh one started, rather than the
    // invalidation deduping onto the read that began before the block.
    expect(GET).toHaveBeenCalledTimes(2);

    await act(async () => first.resolve(blockList([])));
    await waitFor(() => expect(result.current.list.ids.has(ALICE)).toBe(true));

    await act(async () => second.resolve(blockList([ALICE])));
    await waitFor(() => expect(result.current.list.status).toBe("ready"));
    expect([...result.current.list.ids]).toEqual([ALICE]);
  });

  it("a read that started after the change is the server's answer, even against the overlay", async () => {
    // Blocked here, then unblocked on another device: the next read says so,
    // and the overlay must not keep hiding them.
    const GET = vi
      .fn()
      .mockResolvedValueOnce(blockList([]))
      .mockResolvedValueOnce(blockList([ALICE]))
      .mockResolvedValueOnce(blockList([]));
    const POST = vi.fn().mockResolvedValue(ok({ id: "b1" }));

    const { result } = renderListAndActions({ GET, POST });
    await waitFor(() => expect(result.current.list.status).toBe("ready"));
    await act(() => result.current.block.mutateAsync(ALICE));
    await waitFor(() => expect(GET).toHaveBeenCalledTimes(2));

    act(() => result.current.list.retry());
    await waitFor(() => expect(GET).toHaveBeenCalledTimes(3));
    await waitFor(() => expect(result.current.list.ids.has(ALICE)).toBe(false));
    // Not an unblock this client made, so it is no evidence a block ended here.
    expect(result.current.list.unblocked.has(ALICE)).toBe(false);
  });

  it("an unblock stays known until a later read says they are blocked again", async () => {
    const GET = vi
      .fn()
      .mockResolvedValueOnce(blockList([ALICE]))
      .mockResolvedValueOnce(blockList([]))
      .mockResolvedValueOnce(blockList([ALICE]));
    const DELETE = vi.fn().mockResolvedValue(ok(undefined));

    const { result } = renderListAndActions({ GET, DELETE });
    await waitFor(() => expect(result.current.list.status).toBe("ready"));
    await act(() => result.current.unblock.mutateAsync(ALICE));
    await waitFor(() => expect(GET).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(result.current.list.isRetrying).toBe(false));
    expect(result.current.list.unblocked.has(ALICE)).toBe(true);

    act(() => result.current.list.retry());
    await waitFor(() => expect(result.current.list.ids.has(ALICE)).toBe(true));
    expect(result.current.list.unblocked.has(ALICE)).toBe(false);
  });

  it("records the change even when no list is mounted to read it", async () => {
    const POST = vi.fn().mockResolvedValue(ok({ id: "b1" }));

    const { result } = renderHook(() => useBlockMember(), {
      wrapper: createWrapper(queryClient, { POST }),
    });
    await act(() => result.current.mutateAsync(ALICE));

    expect(
      queryClient.getQueryData(confirmedBlockChangesKey(CHAPTER)),
    ).toMatchObject({ [ALICE]: { blocked: true } });
    expect(
      queryClient.getQueryState(chatBlockKeys.list(CHAPTER))?.status,
    ).not.toBe("success");
  });

  it("changes nothing when the write fails", async () => {
    const GET = vi.fn().mockResolvedValue(blockList([BOB]));
    const POST = vi.fn().mockResolvedValue(failed(403, { message: "nope" }));

    const { result } = renderListAndActions({ GET, POST });
    await waitFor(() => expect(result.current.list.status).toBe("ready"));

    await expect(
      act(() => result.current.block.mutateAsync(ALICE)),
    ).rejects.toEqual({ message: "nope" });

    expect([...result.current.list.ids]).toEqual([BOB]);
    expect(queryClient.getQueryData(confirmedBlockChangesKey(CHAPTER))).toEqual(
      {},
    );
  });

  it.each([
    ["an undefined error", silentFailure(500)],
    ["an empty-string error", silentFailure(404, "")],
  ])(
    "treats a non-2xx with %s as a failure, not a block (finding 5c)",
    async (_label, response) => {
      const POST = vi.fn().mockResolvedValue(response);
      const DELETE = vi.fn().mockResolvedValue(response);

      const { result } = renderListAndActions({
        GET: vi.fn().mockImplementation(never),
        POST,
        DELETE,
      });

      await expect(
        act(() => result.current.block.mutateAsync(ALICE)),
      ).rejects.toMatchObject({ statusCode: response.response.status });
      await expect(
        act(() => result.current.unblock.mutateAsync(ALICE)),
      ).rejects.toMatchObject({ statusCode: response.response.status });
      expect(result.current.list.ids.has(ALICE)).toBe(false);
      expect(
        queryClient.getQueryData(confirmedBlockChangesKey(CHAPTER)),
      ).toEqual({});
    },
  );
});

describe("useReportMessage", () => {
  const NOW = "Tue, 22 Sep 2026 21:00:00 GMT";

  function report(overrides: Record<string, unknown> = {}) {
    return {
      id: `r-${Math.random().toString(36).slice(2)}`,
      chapter_id: CHAPTER,
      message_id: "m1",
      reported_content: "hello",
      reported_sender_id: BOB,
      reported_author_name: null,
      reason: "harassment",
      details: "keeps DMing me",
      status: "open",
      created_at: "2026-09-22T20:59:59.123456+00:00",
      resolved_at: null,
      resolved_by: null,
      ...overrides,
    };
  }

  function renderReport(POST: ReturnType<typeof vi.fn>) {
    return renderHook(() => useReportMessage(), {
      wrapper: createWrapper(createTestQueryClient(), { POST }),
    });
  }

  it("posts message id, reason and trimmed details, and calls it a new report", async () => {
    const POST = vi.fn().mockResolvedValue(ok(report(), { date: NOW }));

    const { result } = renderReport(POST);
    const outcome = await act(() =>
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
    expect(outcome.alreadyReported).toBe(false);
  });

  it("sends blank details as absent rather than an empty string", async () => {
    const POST = vi
      .fn()
      .mockResolvedValue(
        ok(report({ reason: "spam", details: null }), { date: NOW }),
      );

    const { result } = renderReport(POST);
    const outcome = await act(() =>
      result.current.mutateAsync({
        messageId: "m1",
        reason: "spam",
        details: "   ",
      }),
    );

    expect(POST).toHaveBeenCalledWith("/v1/chat/reports", {
      body: { message_id: "m1", reason: "spam" },
    });
    expect(outcome.alreadyReported).toBe(false);
  });

  it("surfaces a rejected report as an error rather than a silent success", async () => {
    const POST = vi
      .fn()
      .mockResolvedValue(failed(403, { message: "forbidden" }));

    const { result } = renderReport(POST);
    await expect(
      act(() =>
        result.current.mutateAsync({ messageId: "m1", reason: "other" }),
      ),
    ).rejects.toEqual({ message: "forbidden" });
  });

  it("treats a non-2xx with an empty body as a failure (finding 5c)", async () => {
    const POST = vi.fn().mockResolvedValue(silentFailure(502));

    const { result } = renderReport(POST);
    await expect(
      act(() =>
        result.current.mutateAsync({ messageId: "m1", reason: "other" }),
      ),
    ).rejects.toMatchObject({ statusCode: 502 });
  });

  describe("an open report the API handed back unchanged", () => {
    it("is recognised when its reason is not the one just sent", async () => {
      const POST = vi
        .fn()
        .mockResolvedValue(ok(report({ reason: "spam" }), { date: NOW }));

      const { result } = renderReport(POST);
      const outcome = await act(() =>
        result.current.mutateAsync({
          messageId: "m1",
          reason: "harassment",
          details: "keeps DMing me",
        }),
      );
      expect(outcome.alreadyReported).toBe(true);
    });

    it("is recognised when it predates the response by more than a request takes", async () => {
      const POST = vi.fn().mockResolvedValue(
        ok(report({ created_at: "2026-09-22T20:40:00.000000+00:00" }), {
          date: NOW,
        }),
      );

      const { result } = renderReport(POST);
      const outcome = await act(() =>
        result.current.mutateAsync({
          messageId: "m1",
          reason: "harassment",
          details: "keeps DMing me",
        }),
      );
      expect(outcome.alreadyReported).toBe(true);
    });

    it("is recognised when this client has had the same report back before", async () => {
      const same = report();
      const POST = vi.fn().mockResolvedValue(ok(same, { date: NOW }));

      const { result } = renderReport(POST);
      const input = {
        messageId: "m1",
        reason: "harassment" as const,
        details: "keeps DMing me",
      };
      const first = await act(() => result.current.mutateAsync(input));
      const second = await act(() => result.current.mutateAsync(input));

      expect(first.alreadyReported).toBe(false);
      expect(second.alreadyReported).toBe(true);
    });

    it("does not guess from the device clock when the response carries no date", async () => {
      const POST = vi
        .fn()
        .mockResolvedValue(
          ok(report({ created_at: "2020-01-01T00:00:00.000000+00:00" })),
        );

      const { result } = renderReport(POST);
      const outcome = await act(() =>
        result.current.mutateAsync({
          messageId: "m1",
          reason: "harassment",
          details: "keeps DMing me",
        }),
      );
      expect(outcome.alreadyReported).toBe(false);
    });
  });
});
