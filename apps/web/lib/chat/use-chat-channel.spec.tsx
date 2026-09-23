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
import { chatMessagesKey } from "@repo/chat-core/types";
import { QueryProvider } from "@/lib/providers/query-provider";
import { useChatChannel } from "./use-chat-channel";

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
