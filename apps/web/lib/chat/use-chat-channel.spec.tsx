import { createContext, type ReactNode } from "react";
import { act, renderHook, waitFor } from "@testing-library/react";
import {
  onlineManager,
  useQueryClient,
  type QueryClient,
} from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { SlashCommand } from "@repo/chat-integrations";
import type { OutboxStore } from "@repo/chat-core/adapters";
import {
  emptyCache,
  mergeServerRows,
  upsertOptimistic,
} from "@repo/chat-core/cache";

import {
  chatMessagesKey,
  optimisticMessage,
  type ChannelCache,
} from "@repo/chat-core/types";
import { QueryProvider } from "@/lib/providers/query-provider";
import { OLDER_PAGE_LIMIT, useChatChannel } from "./use-chat-channel";

/**
 * #1909 — an `unconfirmed` `/points` row, and the Retry that replays its
 * original idempotency key, must survive the channel being rebuilt from REST.
 *
 * The rebuild that matters is the reconnect: `QueryProvider` sets
 * `refetchOnReconnect: "always"`, the chat query only overrides `staleTime`,
 * and `"always"` refetches regardless of staleness. The event that took the
 * row used to be the recovery from the very outage that created it, seconds
 * later — and with the row gone, the officer's only move was re-typing the
 * command: a fresh key, no dedupe, a second append-only ledger row.
 *
 * Everything but the transport is real here: the hook, its query and
 * `queryFn`, the provider's defaults, chat-core's dispatch and cache, and the
 * `localStorage`-backed notice store. The server never wrote the row, so the
 * REST backfill always answers with no messages — exactly the rebuild that
 * used to drop it.
 */

const CHANNEL_ID = "11111111-1111-4111-8111-111111111111";
const VIEWER = "user-1";

/*
  Every identity the hook folds into its action context is stable, as it is in
  the app (a context value, a memoized callback). An identity that changed each
  render would re-run the mount-time hydrate on every render, and that hydrate
  restoring the row would hide a channel query that had stopped doing so.
*/
const mocks = vi.hoisted(() => {
  const GET = vi.fn();
  const POST = vi.fn();
  return { GET, POST, apiClient: { GET, POST }, toast: vi.fn() };
});

vi.mock("@repo/hooks", () => ({
  useFrappClient: () => mocks.apiClient,
}));

// A backfill that returns rows also reads their reactions; there are none.
vi.mock("@/lib/realtime/supabase-realtime", () => ({
  getRealtimeClient: () => ({
    from: () => ({
      select: () => ({ in: async () => ({ data: [], error: null }) }),
    }),
  }),
}));

vi.mock("@/lib/chat/viewer-id", () => ({
  useChatViewerId: () => VIEWER,
}));

vi.mock("@/hooks/use-toast", () => ({
  useToast: () => ({ toast: mocks.toast }),
}));

vi.mock("@/lib/providers/analytics-provider", () => ({
  AnalyticsContext: createContext(null),
}));

// The realtime transport is not under test; the card echo never arrives, which
// is the case where only the persisted row can carry the Retry.
vi.mock("@repo/chat-core/realtime-manager", () => ({
  chatRealtime: {
    subscribe: vi.fn(),
    unsubscribe: vi.fn(),
    subscribeStatus: vi.fn(() => () => {}),
    getTypingUsers: vi.fn(() => []),
    emitTyping: vi.fn(),
  },
}));

vi.mock("./offline-queue", () => ({
  createDexieOutboxStore: (): OutboxStore & { get: () => Promise<null> } => ({
    enqueue: vi.fn(),
    dequeue: vi.fn(async () => {}),
    requeue: vi.fn(async () => {}),
    markFailed: vi.fn(async () => {}),
    bumpAttempt: vi.fn(async () => {}),
    listQueued: vi.fn(async () => []),
    listForChannel: vi.fn(async () => []),
    clearDraft: vi.fn(async () => {}),
    get: async () => null,
  }),
}));

vi.mock("./chat-scope", () => {
  const scope = { userId: "auth-1", chapterId: "chapter-1" };
  return { useChatOutboundScope: () => scope };
});

vi.mock("./use-channel-draft", () => ({
  useChannelDraft: () => ({
    draft: "",
    setDraft: vi.fn(),
    cancelPendingSave: vi.fn(),
    clearAfterSend: vi.fn(async () => {}),
  }),
}));

vi.mock("./use-first-chunk-cache", () => ({
  usePersistedChannelTail: vi.fn(),
}));

const POINTS_COMMAND: SlashCommand = {
  name: "points",
  description: "Grant or deduct points",
  requiredModule: "points",
  implemented: true,
};

const LOST_RESPONSE = {
  data: undefined,
  error: { message: "Bad Gateway" },
  response: { status: 502 },
};

function wrapper({ children }: { children: ReactNode }) {
  return <QueryProvider>{children}</QueryProvider>;
}

/*
  `QueryProvider` hands every mount in a browser the same singleton client, so
  unmounting and remounting is NOT a reload: the channel's cache is still in
  memory. Tests drop that memory explicitly (`clear()` is a reload,
  `removeQueries` is a `gcTime` eviction), and the suite clears it between
  tests.
*/
let client: QueryClient | undefined;

async function mountChannel() {
  const view = renderHook(
    () => {
      client = useQueryClient();
      return useChatChannel(CHANNEL_ID);
    },
    { wrapper },
  );
  await waitFor(() => expect(view.result.current.isLoading).toBe(false));
  return view;
}

type Channel = ReturnType<typeof useChatChannel>;

async function grantLostResponse(channel: () => Channel) {
  mocks.POST.mockResolvedValueOnce(LOST_RESPONSE);
  let outcome: Awaited<ReturnType<Channel["dispatchSlash"]>> | undefined;
  await act(async () => {
    outcome = await channel().dispatchSlash(
      POINTS_COMMAND,
      "grant @bobby 50 for rush",
      null,
      () => ({ user_id: "user-2", display_name: "Bobby Member" }),
    );
  });
  return outcome!;
}

function unconfirmedRows(channel: Channel) {
  return channel.messages.filter((m) => m._status === "unconfirmed");
}

/**
 * The parked row, once the hook has re-rendered with it. TanStack notifies
 * observers on a `setTimeout(0)` scheduler, so the render lands after `act`
 * resolves; reading `result.current` straight away sees the previous one.
 */
async function parkedRow(channel: () => Channel) {
  await waitFor(() => expect(unconfirmedRows(channel())).toHaveLength(1));
  const [row] = unconfirmedRows(channel());
  expect(row?._replay).toBeDefined();
  return row!;
}

/**
 * A message someone else posted during outage `n`. Each reconnect's backfill
 * serves a fresh one, so seeing it on screen proves *that* rebuild landed —
 * without it, a check that the parked row is still there would pass before the
 * refetch had even resolved.
 */
function postedDuringOutage(n: number) {
  return {
    id: `msg-outage-${n}`,
    channel_id: CHANNEL_ID,
    sender_id: "user-3",
    kind: "text",
    content: "anyone else lose wifi?",
    client_message_id: `cm-outage-${n}`,
    created_at: `2099-01-0${n}T00:00:00.000Z`,
  };
}

let outages = 0;

/**
 * Drop the link and bring it back, the way the browser's events would, and
 * return the timeline once the reconnect's REST rebuild is on screen.
 */
async function reconnect(channel: () => Channel) {
  outages += 1;
  const posted = postedDuringOutage(outages);
  mocks.GET.mockResolvedValue({ data: [posted], error: undefined });
  act(() => onlineManager.setOnline(false));
  act(() => onlineManager.setOnline(true));
  await waitFor(() =>
    expect(channel().messages.map((m) => m.id)).toContain(posted.id),
  );
  return channel().messages;
}

describe("useChatChannel — an unconfirmed /points row survives a rebuild (#1909)", () => {
  beforeEach(() => {
    outages = 0;
    window.localStorage.clear();
    onlineManager.setOnline(true);
    mocks.GET.mockReset();
    mocks.POST.mockReset();
    // The server never wrote a chat message for the placeholder, so every
    // backfill — first load, reconnect, reload — comes back without it.
    mocks.GET.mockResolvedValue({ data: [], error: undefined });
  });

  afterEach(() => {
    // `onlineManager` is module-global; leaking `false` would change retry
    // behaviour in every later test file.
    onlineManager.setOnline(true);
    window.localStorage.clear();
    client?.clear();
  });

  it("keeps the row and its Retry through the reconnect refetch", async () => {
    const { result } = await mountChannel();
    const outcome = await grantLostResponse(() => result.current);
    expect(outcome.unconfirmed).toBe(true);
    const parked = await parkedRow(() => result.current);

    const rebuilt = await reconnect(() => result.current);
    const survivor = rebuilt.find(
      (m) => m.client_message_id === parked.client_message_id,
    );
    expect(survivor?._status).toBe("unconfirmed");
    expect(survivor?._replay).toEqual(parked._replay);
  });

  it("replays the original key from the row the reconnect restored", async () => {
    const { result } = await mountChannel();
    await grantLostResponse(() => result.current);
    const [restored] = (await reconnect(() => result.current)).filter(
      (m) => m._status === "unconfirmed",
    );

    mocks.POST.mockResolvedValueOnce({
      data: { card_posted: true },
      error: null,
      response: { status: 200 },
    });
    let retried: Awaited<ReturnType<Channel["retryUnconfirmed"]>> | undefined;
    await act(async () => {
      retried = await result.current.retryUnconfirmed(restored!._replay!);
    });

    const [first, second] = mocks.POST.mock.calls;
    expect(second![1].body).toEqual(first![1].body);
    expect(retried?.resolved).toBeTruthy();

    // Resolved: the handle is evicted, so the next rebuild restores nothing.
    const after = await reconnect(() => result.current);
    expect(after.filter((m) => m._status !== "confirmed")).toEqual([]);
  });

  it.each([
    ["a reload", (c: QueryClient) => c.clear()],
    [
      "a gcTime eviction",
      (c: QueryClient) =>
        c.removeQueries({ queryKey: chatMessagesKey(CHANNEL_ID) }),
    ],
  ])("restores the row after %s", async (_label, forget) => {
    const first = await mountChannel();
    await grantLostResponse(() => first.result.current);
    const parked = await parkedRow(() => first.result.current);
    first.unmount();
    forget(client!);

    const { result } = await mountChannel();

    await waitFor(() =>
      expect(unconfirmedRows(result.current)).toEqual([
        expect.objectContaining({
          client_message_id: parked.client_message_id,
          _replay: parked._replay,
        }),
      ]),
    );
    // A fresh backfill really ran: the in-memory copy was gone.
    expect(mocks.GET).toHaveBeenCalledTimes(2);
  });
});

/** Row `n` of a channel's history, `n` minutes after a base instant. */
function historyRow(n: number) {
  return {
    id: `msg-${n}`,
    channel_id: CHANNEL_ID,
    sender_id: "user-3",
    kind: "text",
    content: `message ${n}`,
    client_message_id: `cm-${n}`,
    created_at: new Date(Date.UTC(2026, 8, 1) + n * 60_000).toISOString(),
  };
}

/** Rows `from`..`to`, newest first, as the API serves a page. */
function historyPage(from: number, to: number) {
  const rows = [];
  for (let n = to; n >= from; n -= 1) rows.push(historyRow(n));
  return { data: rows, error: undefined };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((settle) => {
    resolve = settle;
  });
  return { promise, resolve };
}

function queuedRow(clientId: string, status: "pending" | "failed") {
  return {
    ...optimisticMessage({
      clientMessageId: clientId,
      channelId: CHANNEL_ID,
      senderId: VIEWER,
      content: `unsent ${clientId}`,
    }),
    _status: status,
  };
}

describe("useChatChannel — a refetch keeps the member's unsent rows (#2486)", () => {
  beforeEach(() => {
    window.localStorage.clear();
    onlineManager.setOnline(true);
    mocks.GET.mockReset();
  });

  afterEach(() => {
    client?.clear();
  });

  it("keeps rows the outbox hydrate wrote while the first fetch was in flight", async () => {
    const firstPage = deferred<ReturnType<typeof historyPage>>();
    mocks.GET.mockReturnValueOnce(firstPage.promise);
    const { result } = renderHook(
      () => {
        client = useQueryClient();
        return useChatChannel(CHANNEL_ID);
      },
      { wrapper },
    );

    // What `hydrateOutboxIntoCache` does on a cold load: it writes the queued
    // and failed rows into the cache before the GET answers.
    act(() => {
      client!.setQueryData<ChannelCache>(chatMessagesKey(CHANNEL_ID), () => {
        let cache = upsertOptimistic(emptyCache(), queuedRow("q-1", "pending"));
        cache = upsertOptimistic(cache, queuedRow("f-1", "failed"));
        return cache;
      });
    });
    firstPage.resolve(historyPage(1, 3));

    await waitFor(() =>
      expect(result.current.messages.map((m) => m.id)).toEqual([
        "msg-1",
        "msg-2",
        "msg-3",
        "q-1",
        "f-1",
      ]),
    );
    expect(result.current.messages.find((m) => m.id === "f-1")?._status).toBe(
      "failed",
    );
  });

  it("keeps them through the refetch the first-chunk seed triggers", async () => {
    mocks.GET.mockResolvedValue(historyPage(1, 3));
    const { result } = await mountChannel();

    // `seedFirstChunk` merges onto the cache, then invalidates with
    // `refetchType: "all"`.
    act(() => {
      client!.setQueryData<ChannelCache>(chatMessagesKey(CHANNEL_ID), (current) =>
        upsertOptimistic(
          upsertOptimistic(current!, queuedRow("q-1", "pending")),
          queuedRow("f-1", "failed"),
        ),
      );
    });
    mocks.GET.mockResolvedValue(historyPage(1, 4));
    await act(async () => {
      await client!.invalidateQueries({
        queryKey: chatMessagesKey(CHANNEL_ID),
        refetchType: "all",
      });
    });

    await waitFor(() =>
      expect(result.current.messages.map((m) => m.id)).toEqual([
        "msg-1",
        "msg-2",
        "msg-3",
        "msg-4",
        "q-1",
        "f-1",
      ]),
    );
    expect(result.current.messages.find((m) => m.id === "f-1")?._status).toBe(
      "failed",
    );
  });
});

describe("useChatChannel — a refetch returns to the newest page (#1571 review)", () => {
  beforeEach(() => {
    window.localStorage.clear();
    onlineManager.setOnline(true);
    mocks.GET.mockReset();
  });

  afterEach(() => {
    client?.clear();
  });

  it("keeps no older row it did not re-read, so a removal it missed is not shown", async () => {
    mocks.GET.mockResolvedValueOnce(historyPage(101, 150));
    const { result } = await mountChannel();
    mocks.GET.mockResolvedValueOnce(historyPage(2, 101));
    await act(async () => {
      await result.current.loadOlder();
    });
    await waitFor(() => expect(result.current.messages).toHaveLength(149));

    // Row 40 was removed while this client missed it (an outage, or a
    // removal whose response was lost). One read of the newest page, and the
    // cached copy is gone with the rest of the older pages.
    mocks.GET.mockResolvedValueOnce(historyPage(101, 150));
    await act(async () => {
      await client!.refetchQueries({ queryKey: chatMessagesKey(CHANNEL_ID) });
    });

    await waitFor(() => expect(result.current.messages).toHaveLength(50));
    expect(result.current.messages.map((m) => m.id)).not.toContain("msg-40");
    expect(result.current.hasOlder).toBe(true);
    expect(mocks.GET).toHaveBeenCalledTimes(3);
  });

  it("drops a disk-tail row the live page does not carry, in one read", async () => {
    // The first-chunk seed: 30 rows off disk, with 25 posted since, so the
    // live page covers rows 6-30 of the tail. Rows 1-5 are not re-read and go.
    mocks.GET.mockReturnValue(new Promise(() => {}));
    const view = renderHook(
      () => {
        client = useQueryClient();
        return useChatChannel(CHANNEL_ID);
      },
      { wrapper },
    );
    act(() => {
      client!.setQueryData<ChannelCache>(
        chatMessagesKey(CHANNEL_ID),
        mergeServerRows(emptyCache(), historyPage(1, 30).data),
      );
    });
    mocks.GET.mockReset();
    mocks.GET.mockResolvedValueOnce(historyPage(6, 55));
    await act(async () => {
      await client!.refetchQueries({ queryKey: chatMessagesKey(CHANNEL_ID) });
    });

    await waitFor(() => expect(view.result.current.messages).toHaveLength(50));
    expect(view.result.current.messages.map((m) => m.id)).not.toContain(
      "msg-3",
    );
    expect(mocks.GET).toHaveBeenCalledTimes(1);
  });
});

describe("useChatChannel — older history, the edges (#1571 review)", () => {
  beforeEach(() => {
    window.localStorage.clear();
    onlineManager.setOnline(true);
    mocks.GET.mockReset();
  });

  afterEach(() => {
    client?.clear();
  });

  it("falls back to the strict cursor when a full page adds nothing", async () => {
    mocks.GET.mockResolvedValueOnce(historyPage(101, 150));
    const { result } = await mountChannel();

    // More than a page of rows shares the edge's millisecond: the overlapping
    // cursor returns only rows already held.
    const same = historyPage(101, 150).data;
    mocks.GET.mockResolvedValueOnce({
      data: [...same, ...same, ...same].slice(0, OLDER_PAGE_LIMIT),
      error: undefined,
    });
    mocks.GET.mockResolvedValueOnce(historyPage(51, 100));
    let outcome: string | undefined;
    await act(async () => {
      outcome = await result.current.loadOlder();
    });

    expect(outcome).toBe("loaded");
    expect(mocks.GET.mock.calls[2]![1].params.query.before).toBe(
      historyRow(101).created_at,
    );
  });

  it("shares one read between concurrent calls", async () => {
    mocks.GET.mockResolvedValueOnce(historyPage(101, 150));
    const { result } = await mountChannel();

    const older = deferred<ReturnType<typeof historyPage>>();
    mocks.GET.mockReturnValueOnce(older.promise);
    let first: Promise<string> | undefined;
    let second: Promise<string> | undefined;
    act(() => {
      first = result.current.loadOlder();
      second = result.current.loadOlder();
    });
    older.resolve(historyPage(2, 101));
    await act(async () => {
      await Promise.all([first, second]);
    });

    expect(first).toBe(second);
    expect(mocks.GET).toHaveBeenCalledTimes(2);
  });

  it("keeps each channel's status its own when a read settles after a switch", async () => {
    const OTHER = "22222222-2222-4222-8222-222222222222";
    mocks.GET.mockResolvedValueOnce(historyPage(101, 150));
    const view = renderHook(
      ({ id }: { id: string }) => {
        client = useQueryClient();
        return useChatChannel(id);
      },
      { wrapper, initialProps: { id: CHANNEL_ID } },
    );
    await waitFor(() => expect(view.result.current.isLoading).toBe(false));

    const failing = deferred<never>();
    mocks.GET.mockReturnValueOnce(failing.promise);
    let pending: Promise<string> | undefined;
    act(() => {
      pending = view.result.current.loadOlder();
    });

    // Switch channels, and start an older read there too.
    mocks.GET.mockResolvedValueOnce(historyPage(101, 150));
    view.rerender({ id: OTHER });
    await waitFor(() => expect(view.result.current.isLoading).toBe(false));
    const inFlight = deferred<ReturnType<typeof historyPage>>();
    mocks.GET.mockReturnValueOnce(inFlight.promise);
    act(() => {
      void view.result.current.loadOlder();
    });
    await waitFor(() => expect(view.result.current.isLoadingOlder).toBe(true));

    // The first channel's read fails now: it must not touch this one.
    failing.resolve(Promise.reject(new Error("offline")) as never);
    await act(async () => {
      await pending;
    });
    expect(view.result.current.isLoadingOlder).toBe(true);
    expect(view.result.current.olderError).toBe(false);
  });

  it("makes a full page the newest page rather than merge it across a hole", async () => {
    mocks.GET.mockResolvedValueOnce(historyPage(101, 150));
    const { result } = await mountChannel();

    // A full page after the pivot is the newest 100, not the next 100: there
    // may be a hole between it and the cache, so the cached rows it does not
    // touch go, and paging back runs through the hole from here.
    mocks.GET.mockResolvedValueOnce(historyPage(301, 400));
    await act(async () => {
      await result.current.loadNewer();
    });

    await waitFor(() =>
      expect(result.current.messages.map((m) => m.id)[0]).toBe("msg-301"),
    );
    expect(result.current.messages).toHaveLength(100);
    // No second read: the rows in hand already are that page.
    expect(mocks.GET).toHaveBeenCalledTimes(2);
  });

  it("settles a heavy-command notice for a card it delivers", async () => {
    mocks.GET.mockResolvedValueOnce(historyPage(101, 150));
    const { result } = await mountChannel();
    // Filed the way `persistNotice` files it (heavy-command-notices.ts,
    // `storageKey`): a recorded /points grant whose card had not posted.
    const key = `chat:heavy:v1:${VIEWER}:${CHANNEL_ID}`;
    window.localStorage.setItem(
      key,
      JSON.stringify([
        {
          status: "recorded",
          clientMessageId: "cm-151",
          channelId: CHANNEL_ID,
          senderId: VIEWER,
          content: "/points grant @bobby 50",
          note: "Recorded. The card did not post.",
          createdAt: new Date().toISOString(),
        },
      ]),
    );

    // The forward read is what delivers the card.
    mocks.GET.mockResolvedValueOnce(historyPage(151, 151));
    await act(async () => {
      await result.current.loadNewer();
    });

    const left = window.localStorage.getItem(key);
    expect(left === null ? [] : JSON.parse(left)).toEqual([]);
  });

  it("settles a notice for a card a full page delivers, too", async () => {
    mocks.GET.mockResolvedValueOnce(historyPage(101, 150));
    const { result } = await mountChannel();
    const key = `chat:heavy:v1:${VIEWER}:${CHANNEL_ID}`;
    window.localStorage.setItem(
      key,
      JSON.stringify([
        {
          status: "recorded",
          clientMessageId: "cm-350",
          channelId: CHANNEL_ID,
          senderId: VIEWER,
          content: "/points grant @bobby 50",
          note: "Recorded. The card did not post.",
          createdAt: new Date().toISOString(),
        },
      ]),
    );

    mocks.GET.mockResolvedValueOnce(historyPage(301, 400));
    await act(async () => {
      await result.current.loadNewer();
    });

    const left = window.localStorage.getItem(key);
    expect(left === null ? [] : JSON.parse(left)).toEqual([]);
  });

  it("resolves null when the forward read fails", async () => {
    mocks.GET.mockResolvedValueOnce(historyPage(101, 150));
    const { result } = await mountChannel();

    mocks.GET.mockResolvedValueOnce({
      data: undefined,
      error: { message: "Bad Gateway" },
    });
    let read: number | null | undefined;
    await act(async () => {
      read = await result.current.loadNewer();
    });

    expect(read).toBeNull();
  });

  it("reads what arrived after the newest row and merges it", async () => {
    mocks.GET.mockResolvedValueOnce(historyPage(101, 150));
    const { result } = await mountChannel();

    mocks.GET.mockResolvedValueOnce(historyPage(151, 152));
    let added: number | null | undefined;
    await act(async () => {
      added = await result.current.loadNewer();
    });

    expect(added).toBe(2);
    expect(mocks.GET.mock.calls[1]![1].params.query).toEqual({
      limit: OLDER_PAGE_LIMIT,
      since: "msg-150",
    });
    await waitFor(() => expect(result.current.messages).toHaveLength(52));
  });
});

describe("useChatChannel — older history (#1571)", () => {
  beforeEach(() => {
    window.localStorage.clear();
    onlineManager.setOnline(true);
    mocks.GET.mockReset();
  });

  afterEach(() => {
    client?.clear();
  });

  it("reads the next page one millisecond past the oldest row and merges it", async () => {
    mocks.GET.mockResolvedValueOnce(historyPage(101, 150));
    const { result } = await mountChannel();
    expect(result.current.hasOlder).toBe(true);

    // A full page, overlapping the edge row by the millisecond the cursor adds.
    mocks.GET.mockResolvedValueOnce(historyPage(2, 101));
    let outcome: string | undefined;
    await act(async () => {
      outcome = await result.current.loadOlder();
    });

    expect(outcome).toBe("loaded");
    const query = mocks.GET.mock.calls[1]![1].params.query;
    expect(query).toEqual({
      limit: OLDER_PAGE_LIMIT,
      before: new Date(Date.parse(historyRow(101).created_at) + 1).toISOString(),
    });
    await waitFor(() => expect(result.current.messages).toHaveLength(149));
    // A full page says nothing about what is left, so there may be more.
    expect(result.current.hasOlder).toBe(true);
  });

  it("says there is nothing older once a page comes back short", async () => {
    mocks.GET.mockResolvedValueOnce(historyPage(101, 150));
    const { result } = await mountChannel();

    mocks.GET.mockResolvedValueOnce(historyPage(90, 101));
    await act(async () => {
      await result.current.loadOlder();
    });

    await waitFor(() => expect(result.current.hasOlder).toBe(false));
    expect(result.current.messages).toHaveLength(61);
  });

  it("knows a channel shorter than one page has nothing older", async () => {
    mocks.GET.mockResolvedValueOnce(historyPage(1, 3));
    const { result } = await mountChannel();

    await waitFor(() => expect(result.current.hasOlder).toBe(false));
  });

  it("discards a page whose edge a refetch moved while it was in flight", async () => {
    mocks.GET.mockResolvedValueOnce(historyPage(101, 150));
    const { result } = await mountChannel();

    const older = deferred<ReturnType<typeof historyPage>>();
    mocks.GET.mockReturnValueOnce(older.promise);
    let pending: Promise<string> | undefined;
    act(() => {
      pending = result.current.loadOlder();
    });
    // A refetch lands meanwhile and returns the thread to its newest page,
    // which no longer reaches the edge the older read started from.
    mocks.GET.mockResolvedValueOnce(historyPage(201, 250));
    await act(async () => {
      await client!.refetchQueries({ queryKey: chatMessagesKey(CHANNEL_ID) });
    });
    older.resolve(historyPage(1, 100));

    let outcome: string | undefined;
    await act(async () => {
      outcome = await pending;
    });
    expect(outcome).toBe("stale");
    expect(result.current.messages.map((m) => m.id)).not.toContain("msg-1");
  });

  it("reports a failed read, and clears it on the next attempt", async () => {
    mocks.GET.mockResolvedValueOnce(historyPage(101, 150));
    const { result } = await mountChannel();

    mocks.GET.mockResolvedValueOnce({
      data: undefined,
      error: { message: "Bad Gateway" },
    });
    await act(async () => {
      await result.current.loadOlder();
    });
    await waitFor(() => expect(result.current.olderError).toBe(true));

    mocks.GET.mockResolvedValueOnce(historyPage(2, 101));
    await act(async () => {
      await result.current.loadOlder();
    });
    await waitFor(() => expect(result.current.olderError).toBe(false));
  });
});
