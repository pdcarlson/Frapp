import { QueryClient } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  MASKED_REFRESH_MAX_PAGES,
  MASKED_REFRESH_PAGE_LIMIT,
  MASKED_REFRESH_RETRY_DELAYS_MS,
  blockClearance,
  maskedRefresh,
  reconcileContradiction,
  refreshMaskedCopies,
} from "./blocks";
import { emptyCache, mergeServerRow } from "./cache";
import {
  chatMessagesKey,
  type ChannelCache,
  type RawChatMessage,
} from "./types";

// The post-unblock re-read and the two session stores (#2257, #2313). Moved
// from the mobile app with the classifier; each client's own spec drives them
// through its hooks as well.

const api = { GET: vi.fn() };

const BLOCKED = "22222222-2222-4222-8222-222222222222";
const FRIEND = "33333333-3333-4333-8333-333333333333";
const VIEWER = "11111111-1111-4111-8111-111111111111";

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

async function flush() {
  await Promise.resolve();
  await Promise.resolve();
}

/** Every retry delay `refreshMaskedCopies` would wait, run out on fake timers. */
async function runOutRetries() {
  for (const delay of MASKED_REFRESH_RETRY_DELAYS_MS) {
    await vi.advanceTimersByTimeAsync(delay);
  }
  await flush();
}

beforeEach(() => {
  api.GET.mockReset();
  maskedRefresh.reset();
  blockClearance.reset();
});

afterEach(() => {
  vi.useRealTimers();
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

/** Row `n` of a long thread, `n` seconds after a base instant: higher is newer. */
function historyRow(
  n: number,
  senderId: string,
  overrides: Partial<RawChatMessage> = {},
): RawChatMessage {
  return restRow(`h${n}`, senderId, {
    created_at: new Date(Date.UTC(2026, 8, 15, 18, 0, 0) + n * 1000).toISOString(),
    ...overrides,
  });
}

/** Rows `from`..`to`, newest first, as the API serves a page. */
function historyPage(from: number, to: number, senderId: string) {
  const rows: RawChatMessage[] = [];
  for (let n = to; n >= from; n -= 1) rows.push(historyRow(n, senderId));
  return page(rows);
}

describe("refreshMaskedCopies — older history (#1571)", () => {
  it("reads back page by page to the oldest masked copy the thread holds", async () => {
    const queryClient = new QueryClient();
    const limit = MASKED_REFRESH_PAGE_LIMIT;
    // The member scrolled back past the newest page: a masked copy sits at
    // row 5, and the newest page covers only the last `limit` rows.
    seed(queryClient, "chan-1", [
      historyRow(5, BLOCKED, { sender_blocked: true }),
      historyRow(limit + 50, BLOCKED, { sender_blocked: true }),
    ]);
    api.GET.mockResolvedValueOnce(historyPage(51, limit + 50, BLOCKED));
    api.GET.mockResolvedValueOnce(historyPage(1, 51, BLOCKED));

    await expect(
      refreshMaskedCopies(queryClient, api as never, BLOCKED, []),
    ).resolves.toBe(true);

    expect(api.GET).toHaveBeenCalledTimes(2);
    const second = api.GET.mock.calls[1]![1].params.query;
    // One millisecond past the first page's oldest row, so a row sharing its
    // instant is not skipped.
    expect(second.before).toBe(
      new Date(Date.parse(historyRow(51, BLOCKED).created_at) + 1).toISOString(),
    );
    const cache = cacheOf(queryClient, "chan-1");
    expect(cache.byId.h5?.sender_blocked).toBe(false);
    expect(cache.byId[`h${limit + 50}`]?.sender_blocked).toBe(false);
  });

  it("stops after the page that reaches the oldest masked copy", async () => {
    const queryClient = new QueryClient();
    const limit = MASKED_REFRESH_PAGE_LIMIT;
    seed(queryClient, "chan-1", [
      historyRow(limit + 10, BLOCKED, { sender_blocked: true }),
    ]);
    // A full page, so only the copy's position can end the read.
    api.GET.mockResolvedValueOnce(historyPage(11, limit + 10, BLOCKED));

    await expect(
      refreshMaskedCopies(queryClient, api as never, BLOCKED, []),
    ).resolves.toBe(true);
    expect(api.GET).toHaveBeenCalledTimes(1);
  });
});

describe("refreshMaskedCopies — the read's edges (#1571 review)", () => {
  /** A full page of rows at one second apart, newest first, ending at `end`. */
  function fullPageEndingAt(end: number) {
    const rows: RawChatMessage[] = [];
    for (let n = end + MASKED_REFRESH_PAGE_LIMIT - 1; n >= end; n -= 1) {
      rows.push(historyRow(n, FRIEND));
    }
    return page(rows);
  }

  it("reads on past a page whose oldest row shares the copy's millisecond", async () => {
    const queryClient = new QueryClient();
    // The copy and the page's oldest row share a millisecond; the copy is
    // older by microseconds, so the page's limit cut it off.
    const edge = historyRow(1, FRIEND, {
      created_at: "2026-09-15T18:00:00.123900+00:00",
    });
    const copy = historyRow(0, BLOCKED, {
      sender_blocked: true,
      created_at: "2026-09-15T18:00:00.123400+00:00",
    });
    seed(queryClient, "chan-1", [copy]);
    const first = fullPageEndingAt(2).data.slice(0, -1);
    api.GET.mockResolvedValueOnce(page([...first, edge]));
    api.GET.mockResolvedValueOnce(
      page([edge, historyRow(0, BLOCKED, { created_at: copy.created_at })]),
    );

    await refreshMaskedCopies(queryClient, api as never, BLOCKED, []);

    expect(api.GET).toHaveBeenCalledTimes(2);
    expect(cacheOf(queryClient, "chan-1").byId.h0?.sender_blocked).toBe(false);
  });

  it("resumes a retry from the last page it read, not from the newest", async () => {
    vi.useFakeTimers();
    const queryClient = new QueryClient();
    seed(queryClient, "chan-1", [
      historyRow(5, BLOCKED, { sender_blocked: true }),
    ]);
    api.GET.mockResolvedValueOnce(fullPageEndingAt(200));
    api.GET.mockRejectedValueOnce(new Error("offline"));
    api.GET.mockResolvedValueOnce(historyPage(1, 200, BLOCKED));

    const done = refreshMaskedCopies(queryClient, api as never, BLOCKED);
    await runOutRetries();
    await expect(done).resolves.toBe(true);

    const cursors = api.GET.mock.calls.map(
      (call) => call[1].params.query.before,
    );
    // The retry repeats the failed page's cursor, not the first page's.
    expect(cursors[0]).toBeUndefined();
    expect(cursors[2]).toBe(cursors[1]);
    expect(cursors[2]).toBeDefined();
  });

  it("trims what it could not reach at the bound instead of failing", async () => {
    const queryClient = new QueryClient();
    const beyond = historyRow(0, BLOCKED, { sender_blocked: true });
    seed(queryClient, "chan-1", [beyond]);
    // Every page is full and never reaches the copy.
    let end = 1_000_000;
    api.GET.mockImplementation(async () => {
      end -= MASKED_REFRESH_PAGE_LIMIT;
      return fullPageEndingAt(end);
    });

    await expect(
      refreshMaskedCopies(queryClient, api as never, BLOCKED, [1_000]),
    ).resolves.toBe(true);

    expect(api.GET).toHaveBeenCalledTimes(MASKED_REFRESH_MAX_PAGES);
    expect(cacheOf(queryClient, "chan-1").byId.h0).toBeUndefined();
    expect(maskedRefresh.snapshot().has(BLOCKED)).toBe(false);
  });
});

describe("reconcileContradiction (finding 6)", () => {
  it("re-reads once per distinct set of contradicting rows", () => {
    const first = reconcileContradiction("m1", true, "");
    expect(first).toEqual({ reconciledFor: "m1", reread: true });
    expect(reconcileContradiction("m1", true, first.reconciledFor)).toEqual({
      reconciledFor: "m1",
      reread: false,
    });
    expect(reconcileContradiction("m1,m2", true, "m1")).toEqual({
      reconciledFor: "m1,m2",
      reread: true,
    });
  });

  it("forgets the set only once a ready list stops being contradicted", () => {
    // A list that is not ready proves nothing, so the set survives it and a
    // recovery does not re-read for rows already reconciled.
    expect(reconcileContradiction("", false, "m1")).toEqual({
      reconciledFor: "m1",
      reread: false,
    });
    expect(reconcileContradiction("", true, "m1")).toEqual({
      reconciledFor: "",
      reread: false,
    });
    // …so the same rows contradicting it again later are a new question.
    expect(reconcileContradiction("m1", true, "")).toEqual({
      reconciledFor: "m1",
      reread: true,
    });
  });
});

describe("blockClearance", () => {
  it("remembers ids per viewer, and a new viewer starts empty", () => {
    blockClearance.record(VIEWER, ["m1", "m2"]);
    expect([...blockClearance.snapshot(VIEWER)]).toEqual(["m1", "m2"]);
    expect(blockClearance.snapshot(FRIEND).size).toBe(0);
    expect(blockClearance.snapshot(null).size).toBe(0);

    blockClearance.record(FRIEND, ["m3"]);
    expect([...blockClearance.snapshot(FRIEND)]).toEqual(["m3"]);
    expect(blockClearance.snapshot(VIEWER).size).toBe(0);
  });

  it("notifies only when something new was recorded", () => {
    const listener = vi.fn();
    const unsubscribe = blockClearance.subscribe(listener);
    blockClearance.record(VIEWER, ["m1"]);
    const snapshot = blockClearance.snapshot(VIEWER);
    blockClearance.record(VIEWER, ["m1"]);
    expect(listener).toHaveBeenCalledTimes(1);
    // Same identity when nothing changed, so a store reader does not re-render.
    expect(blockClearance.snapshot(VIEWER)).toBe(snapshot);
    unsubscribe();
    blockClearance.record(VIEWER, ["m2"]);
    expect(listener).toHaveBeenCalledTimes(1);
  });
});

describe("maskedRefresh", () => {
  it("records and clears a member's state, notifying only on a change", () => {
    const listener = vi.fn();
    const unsubscribe = maskedRefresh.subscribe(listener);
    maskedRefresh.set(BLOCKED, "refreshing");
    maskedRefresh.set(BLOCKED, "refreshing");
    expect(listener).toHaveBeenCalledTimes(1);
    maskedRefresh.set(BLOCKED, null);
    expect(maskedRefresh.snapshot().size).toBe(0);
    expect(listener).toHaveBeenCalledTimes(2);
    unsubscribe();
  });
});
