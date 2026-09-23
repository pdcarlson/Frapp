/** @vitest-environment jsdom */
import React from "react";
import { act, renderHook } from "@testing-library/react";
import { Alert } from "react-native";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { emptyCache, mergeServerRow } from "@repo/chat-core/cache";
import {
  chatMessagesKey,
  type ChannelCache,
  type RawChatMessage,
} from "@repo/chat-core/types";

const mutations = vi.hoisted(() => ({
  block: vi.fn(),
  unblock: vi.fn(),
}));
const api = vi.hoisted(() => ({ GET: vi.fn() }));

vi.mock("@repo/hooks", async () => {
  const actual =
    await vi.importActual<typeof import("@repo/hooks")>("@repo/hooks");
  return {
    ...actual,
    useFrappClient: () => api,
    useBlockMember: () => ({ mutateAsync: mutations.block, isPending: false }),
    useUnblockMember: () => ({
      mutateAsync: mutations.unblock,
      isPending: false,
    }),
  };
});

import {
  BLOCK_FAILURE_BODY,
  BLOCK_NOT_A_MEMBER_BODY,
  blockConfirmBody,
  confirmBlockMember,
  confirmUnblockMember,
  isMemberNotFound,
  MASKED_REFRESH_RETRY_DELAYS_MS,
  refreshMaskedCopies,
  useBlockActions,
} from "./block-actions";
import { maskedRefresh } from "./masked-refresh";

const BLOCKED = "22222222-2222-4222-8222-222222222222";
const FRIEND = "33333333-3333-4333-8333-333333333333";

function wrapperFor(queryClient: QueryClient) {
  const Wrapper = ({ children }: { children: React.ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
  Wrapper.displayName = "Wrapper";
  return Wrapper;
}

async function flush() {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
}

/** A row as `GET /v1/channels/{id}/messages` serves it. */
function restRow(
  id: string,
  senderId: string,
  overrides: Partial<RawChatMessage> = {},
): RawChatMessage {
  return {
    id,
    channel_id: "chan-1",
    sender_id: senderId,
    author_name: null,
    content: `body ${id}`,
    kind: "text",
    created_at: `2026-09-15T18:00:0${id.slice(-1)}.000000+00:00`,
    sender_blocked: false,
    ...overrides,
  };
}

/** A Realtime echo: the raw row, no `sender_blocked` at all. */
function echoRow(id: string, senderId: string): RawChatMessage {
  const row = restRow(id, senderId);
  delete row.sender_blocked;
  return row;
}

function seed(
  queryClient: QueryClient,
  channelId: string,
  rows: RawChatMessage[],
) {
  queryClient.setQueryData<ChannelCache>(
    chatMessagesKey(channelId),
    rows.reduce((cache, row) => mergeServerRow(cache, row), emptyCache()),
  );
}

function cacheOf(queryClient: QueryClient, channelId: string) {
  return queryClient.getQueryData<ChannelCache>(chatMessagesKey(channelId))!;
}

function page(rows: RawChatMessage[]) {
  return { data: rows, response: new Response(null, { status: 200 }) };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((res) => {
    resolve = res;
  });
  return { promise, resolve };
}

beforeEach(() => {
  vi.mocked(Alert.alert).mockClear();
  mutations.block.mockReset();
  mutations.unblock.mockReset();
  api.GET.mockReset();
  maskedRefresh.reset();
});

afterEach(() => {
  vi.useRealTimers();
});

/** Every retry delay `refreshMaskedCopies` would wait, run out on fake timers. */
async function runOutRetries() {
  for (const delay of MASKED_REFRESH_RETRY_DELAYS_MS) {
    await act(async () => {
      await vi.advanceTimersByTimeAsync(delay);
    });
  }
  await flush();
}

describe("useBlockActions", () => {
  it("a block re-runs no thread query and fetches nothing — the list alone hides them", async () => {
    mutations.block.mockResolvedValue({ id: "b1" });
    const queryClient = new QueryClient();
    seed(queryClient, "chan-1", [restRow("m1", BLOCKED)]);
    const invalidate = vi.spyOn(queryClient, "invalidateQueries");
    const { result } = renderHook(() => useBlockActions(), {
      wrapper: wrapperFor(queryClient),
    });

    await act(() => result.current.block(BLOCKED));

    expect(mutations.block).toHaveBeenCalledWith(BLOCKED);
    expect(invalidate).not.toHaveBeenCalled();
    expect(api.GET).not.toHaveBeenCalled();
  });

  it("an unblock re-reads only threads holding that member's masked copies, without re-running their query", async () => {
    mutations.unblock.mockResolvedValue(undefined);
    const queryClient = new QueryClient();
    seed(queryClient, "chan-1", [
      restRow("m1", BLOCKED, { sender_blocked: true, content: "hidden" }),
    ]);
    seed(queryClient, "chan-2", [restRow("m2", FRIEND)]);
    const invalidate = vi.spyOn(queryClient, "invalidateQueries");
    api.GET.mockResolvedValue(
      page([restRow("m1", BLOCKED, { content: "the real words" })]),
    );
    const { result } = renderHook(() => useBlockActions(), {
      wrapper: wrapperFor(queryClient),
    });

    await act(() => result.current.unblock(BLOCKED));
    await flush();

    expect(mutations.unblock).toHaveBeenCalledWith(BLOCKED);
    expect(invalidate).not.toHaveBeenCalled();
    expect(api.GET).toHaveBeenCalledTimes(1);
    expect(api.GET).toHaveBeenCalledWith("/v1/channels/{id}/messages", {
      params: { path: { id: "chan-1" }, query: { limit: 50 } },
    });
    expect(cacheOf(queryClient, "chan-1").byId["m1"]).toMatchObject({
      content: "the real words",
      sender_blocked: false,
    });
  });

  it("keeps a Realtime write that lands while the re-read is in flight (finding 3)", async () => {
    mutations.unblock.mockResolvedValue(undefined);
    const queryClient = new QueryClient();
    seed(queryClient, "chan-1", [
      restRow("m1", BLOCKED, { sender_blocked: true, content: "hidden" }),
    ]);
    const response = deferred<ReturnType<typeof page>>();
    api.GET.mockReturnValue(response.promise);
    const { result } = renderHook(() => useBlockActions(), {
      wrapper: wrapperFor(queryClient),
    });

    await act(() => result.current.unblock(BLOCKED));
    expect(api.GET).toHaveBeenCalledTimes(1);

    // The live echo writes a new message into the cache mid-request, the same
    // way the realtime manager's `patchCache` does.
    act(() => {
      queryClient.setQueryData<ChannelCache>(
        chatMessagesKey("chan-1"),
        (cache) => mergeServerRow(cache!, echoRow("m9", FRIEND)),
      );
    });

    await act(async () => {
      response.resolve(
        page([restRow("m1", BLOCKED, { content: "the real words" })]),
      );
      await Promise.resolve();
    });
    await flush();

    const cache = cacheOf(queryClient, "chan-1");
    expect(cache.byId["m9"]).toBeDefined();
    expect(cache.order).toContain("m9");
    expect(cache.byId["m1"]!.content).toBe("the real words");
  });

  it("an unblock still succeeds when the re-read fails, and the failure is recorded rather than swallowed", async () => {
    vi.useFakeTimers();
    mutations.unblock.mockResolvedValue(undefined);
    const queryClient = new QueryClient();
    seed(queryClient, "chan-1", [
      restRow("m1", BLOCKED, { sender_blocked: true, content: "hidden" }),
    ]);
    api.GET.mockRejectedValue(new Error("offline"));
    const { result } = renderHook(() => useBlockActions(), {
      wrapper: wrapperFor(queryClient),
    });

    await expect(
      act(() => result.current.unblock(BLOCKED)),
    ).resolves.toBeUndefined();
    expect(maskedRefresh.snapshot().get(BLOCKED)).toBe("refreshing");

    await runOutRetries();
    // Tried, then retried a bounded number of times — never forever.
    expect(api.GET).toHaveBeenCalledTimes(
      1 + MASKED_REFRESH_RETRY_DELAYS_MS.length,
    );
    expect(cacheOf(queryClient, "chan-1").byId["m1"]!.content).toBe("hidden");
    // What lets the stale tombstone offer Reload instead of nothing.
    expect(maskedRefresh.snapshot().get(BLOCKED)).toBe("failed");
  });

  it("a Reload re-runs the re-read and clears the failure once it lands", async () => {
    const queryClient = new QueryClient();
    seed(queryClient, "chan-1", [
      restRow("m1", BLOCKED, { sender_blocked: true, content: "hidden" }),
    ]);
    maskedRefresh.set(BLOCKED, "failed");
    api.GET.mockResolvedValue(
      page([restRow("m1", BLOCKED, { content: "the real words" })]),
    );
    const { result } = renderHook(() => useBlockActions(), {
      wrapper: wrapperFor(queryClient),
    });

    let landed: boolean | undefined;
    await act(async () => {
      landed = await result.current.reloadMaskedCopies(BLOCKED);
    });

    expect(landed).toBe(true);
    expect(cacheOf(queryClient, "chan-1").byId["m1"]!.content).toBe(
      "the real words",
    );
    expect(maskedRefresh.snapshot().has(BLOCKED)).toBe(false);
  });

  it("touches no cache when the write fails", async () => {
    mutations.unblock.mockRejectedValue(new Error("offline"));
    const queryClient = new QueryClient();
    seed(queryClient, "chan-1", [
      restRow("m1", BLOCKED, { sender_blocked: true }),
    ]);
    const { result } = renderHook(() => useBlockActions(), {
      wrapper: wrapperFor(queryClient),
    });

    await expect(act(() => result.current.unblock(BLOCKED))).rejects.toThrow(
      "offline",
    );
    expect(api.GET).not.toHaveBeenCalled();
  });
});

describe("refreshMaskedCopies — retries (#2257 review)", () => {
  it("recovers from a transient failure on a retry", async () => {
    vi.useFakeTimers();
    const queryClient = new QueryClient();
    seed(queryClient, "chan-1", [
      restRow("m1", BLOCKED, { sender_blocked: true, content: "hidden" }),
    ]);
    api.GET.mockRejectedValueOnce(new Error("blip")).mockResolvedValue(
      page([restRow("m1", BLOCKED, { content: "the real words" })]),
    );

    let landed: boolean | undefined;
    void refreshMaskedCopies(queryClient, api as never, BLOCKED).then(
      (value) => {
        landed = value;
      },
    );
    await runOutRetries();

    expect(api.GET).toHaveBeenCalledTimes(2);
    expect(landed).toBe(true);
    expect(cacheOf(queryClient, "chan-1").byId["m1"]!.content).toBe(
      "the real words",
    );
    expect(maskedRefresh.snapshot().has(BLOCKED)).toBe(false);
  });

  it("treats a non-2xx as a failure too", async () => {
    const queryClient = new QueryClient();
    seed(queryClient, "chan-1", [
      restRow("m1", BLOCKED, { sender_blocked: true }),
    ]);
    api.GET.mockResolvedValue({
      data: undefined,
      response: new Response(null, { status: 503 }),
    });

    const landed = await refreshMaskedCopies(
      queryClient,
      api as never,
      BLOCKED,
      [],
    );
    expect(landed).toBe(false);
    expect(maskedRefresh.snapshot().get(BLOCKED)).toBe("failed");
  });

  it("stops retrying a thread that no longer holds a masked copy", async () => {
    vi.useFakeTimers();
    const queryClient = new QueryClient();
    seed(queryClient, "chan-1", [
      restRow("m1", BLOCKED, { sender_blocked: true }),
    ]);
    api.GET.mockRejectedValue(new Error("offline"));

    let landed: boolean | undefined;
    void refreshMaskedCopies(queryClient, api as never, BLOCKED).then(
      (value) => {
        landed = value;
      },
    );
    await flush();
    // The thread reloaded meanwhile and the copy came back clear.
    seed(queryClient, "chan-1", [restRow("m1", BLOCKED)]);
    await runOutRetries();

    expect(api.GET).toHaveBeenCalledTimes(1);
    expect(landed).toBe(true);
  });

  it("reads nothing and records nothing when no thread holds a masked copy", async () => {
    const queryClient = new QueryClient();
    seed(queryClient, "chan-1", [restRow("m1", FRIEND)]);
    maskedRefresh.set(BLOCKED, "failed");

    await expect(
      refreshMaskedCopies(queryClient, api as never, BLOCKED),
    ).resolves.toBe(true);
    expect(api.GET).not.toHaveBeenCalled();
    expect(maskedRefresh.snapshot().has(BLOCKED)).toBe(false);
  });
});

describe("isMemberNotFound", () => {
  it("is the API's non-member answer and nothing else", () => {
    expect(
      isMemberNotFound({ statusCode: 404, message: "Member not found" }),
    ).toBe(true);
    // A 404 from a route this build expects but the server does not serve.
    expect(isMemberNotFound({ statusCode: 404, message: "Cannot POST" })).toBe(
      false,
    );
    expect(isMemberNotFound({ statusCode: 404 })).toBe(false);
    expect(
      isMemberNotFound({ statusCode: 400, message: "Member not found" }),
    ).toBe(false);
  });
});

describe("confirmBlockMember / confirmUnblockMember", () => {
  function buttons() {
    const call = vi.mocked(Alert.alert).mock.calls[0]!;
    return call[2]!;
  }

  it("names the member, and runs nothing until confirmed", () => {
    const run = vi.fn().mockResolvedValue(undefined);
    confirmBlockMember({ name: "Blake", inDirectory: true, run });

    expect(vi.mocked(Alert.alert).mock.calls[0]![0]).toBe("Block Blake?");
    expect(run).not.toHaveBeenCalled();
    buttons()
      .find((button) => button.style === "cancel")
      ?.onPress?.();
    expect(run).not.toHaveBeenCalled();
  });

  it("says a block is this chapter's, and promises the directory only when it is true", () => {
    expect(blockConfirmBody(true)).toMatch(/this chapter's chat/);
    expect(blockConfirmBody(true)).toMatch(/stay in the directory/);
    expect(blockConfirmBody(false)).not.toMatch(/directory/);

    confirmBlockMember({ name: "Blake", inDirectory: false, run: vi.fn() });
    expect(vi.mocked(Alert.alert).mock.calls[0]![1]).toBe(
      blockConfirmBody(false),
    );
  });

  it("falls back to a neutral name when the roster cannot resolve one", () => {
    confirmUnblockMember({ name: null, run: vi.fn() });
    expect(vi.mocked(Alert.alert).mock.calls[0]![0]).toBe(
      "Unblock this member?",
    );
  });

  it("runs on confirm, then calls onDone", async () => {
    const run = vi.fn().mockResolvedValue(undefined);
    const onDone = vi.fn();
    confirmBlockMember({ name: "Blake", inDirectory: true, run, onDone });

    buttons()
      .find((button) => button.style === "destructive")
      ?.onPress?.();
    await flush();

    expect(run).toHaveBeenCalledTimes(1);
    expect(onDone).toHaveBeenCalledTimes(1);
  });

  it("reports a failure instead of pretending it worked", async () => {
    const run = vi.fn().mockRejectedValue(new Error("offline"));
    const onDone = vi.fn();
    confirmUnblockMember({ name: "Blake", run, onDone });

    buttons()
      .find((button) => button.text === "Unblock")
      ?.onPress?.();
    await flush();

    expect(onDone).not.toHaveBeenCalled();
    expect(Alert.alert).toHaveBeenLastCalledWith(
      "Couldn't unblock Blake",
      BLOCK_FAILURE_BODY,
    );
  });

  it("says a 404 `Member not found` means they left the chapter, and tells the caller (finding 11)", async () => {
    const run = vi
      .fn()
      .mockRejectedValue({ statusCode: 404, message: "Member not found" });
    const onNotAMember = vi.fn();
    confirmBlockMember({ name: "Blake", inDirectory: false, run, onNotAMember });

    buttons()
      .find((button) => button.style === "destructive")
      ?.onPress?.();
    await flush();

    expect(Alert.alert).toHaveBeenLastCalledWith(
      "Couldn't block Blake",
      BLOCK_NOT_A_MEMBER_BODY,
    );
    expect(onNotAMember).toHaveBeenCalledTimes(1);
  });

  it("gives any other 404 the ordinary failure copy — it is no evidence they left", async () => {
    const run = vi
      .fn()
      .mockRejectedValue({ statusCode: 404, message: "Cannot POST /v1/chat/blocks" });
    const onNotAMember = vi.fn();
    confirmBlockMember({ name: "Blake", inDirectory: true, run, onNotAMember });

    buttons()
      .find((button) => button.style === "destructive")
      ?.onPress?.();
    await flush();

    expect(Alert.alert).toHaveBeenLastCalledWith(
      "Couldn't block Blake",
      BLOCK_FAILURE_BODY,
    );
    expect(onNotAMember).not.toHaveBeenCalled();
  });
});
