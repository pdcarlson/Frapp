/** @vitest-environment jsdom */
/*
  One claim, and it is the wiring nothing else covers.

  `viewer-id.spec.tsx` renders `CachedViewerIdProvider` by hand, and
  `use-first-chunk-cache.spec.tsx` asserts the string the hook returns. Both
  pass whether or not anything joins them up — and `chat-shell.spec.tsx` mocks
  `useChatViewerId` outright, so it passes too. That leaves the one line that
  makes #2249 work in production (`ChatProvider` publishing the cached id it got
  from `useFirstChunkCache`) asserted by nothing: a refactor that dropped the
  wrapper and went back to `<>{children}</>` would revert the whole warm paint
  to the #2243 skeleton with a fully green suite.

  So this renders the real `ChatProvider` and reads the real `useChatViewerId`
  from underneath it.
*/
import { useContext } from "react";
import { render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { describe, expect, it, vi } from "vitest";

const { blockFloor, cachedViewerId, liveViewerId } = vi.hoisted(() => ({
  blockFloor: { current: null as ReadonlySet<string> | null },
  cachedViewerId: { current: null as string | null },
  liveViewerId: { current: null as string | null },
}));

vi.mock("./use-first-chunk-cache", () => ({
  useFirstChunkCache: () => ({
    viewerId: cachedViewerId.current,
    blockFloor: blockFloor.current,
  }),
}));
vi.mock("@repo/hooks", () => ({
  useFrappClient: () => ({ GET: vi.fn() }),
  useViewerUserId: () => liveViewerId.current,
  useCurrentUser: () => ({ isPending: liveViewerId.current === null }),
}));
vi.mock("@/lib/auth/use-frapp-user", () => ({
  useFrappUser: () => ({
    userId: liveViewerId.current,
    isLoading: liveViewerId.current === null,
  }),
}));
vi.mock("./chat-scope", () => ({ useChatOutboundScope: () => null }));
vi.mock("./offline-queue", () => ({ createDexieOutboxStore: () => ({}) }));
vi.mock("@/hooks/use-toast", () => ({ useToast: () => ({ toast: vi.fn() }) }));
vi.mock("@/lib/realtime/supabase-realtime", () => ({
  getRealtimeClient: () => ({}),
}));
vi.mock("@repo/chat-core/realtime-manager", () => ({
  chatRealtime: { configure: vi.fn(), destroy: vi.fn() },
}));
vi.mock("@repo/chat-core/chat-client", () => ({
  flushOutbox: vi.fn(async () => undefined),
}));
vi.mock("@repo/chat-core/adapters", () => ({
  browserKeyValueStore: {},
  browserNetworkState: { subscribe: () => () => {} },
}));

const { ChatProvider } = await import("./chat-provider");
const { useChatViewerId } = await import("./viewer-id");
const { CachedBlockFloorContext } = await import("./use-thread-block-list");

function Probe() {
  const floor = useContext(CachedBlockFloorContext);
  return (
    <>
      <span data-testid="viewer">{useChatViewerId() ?? "unknown"}</span>
      <span data-testid="floor">{floor ? [...floor].join(",") : "none"}</span>
    </>
  );
}

function renderProvider() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={client}>
      <ChatProvider>
        <Probe />
      </ChatProvider>
    </QueryClientProvider>,
  );
}

const viewer = () => screen.getByTestId("viewer").textContent;

describe("ChatProvider publishes the cached viewer id (#2249)", () => {
  it("hands a descendant the id the first-chunk read returned", () => {
    // The whole feature in one assertion: identity reaches the surface that
    // paints with it, with `GET /v1/users/me` still unanswered.
    cachedViewerId.current = "user-from-dexie";
    liveViewerId.current = null;

    renderProvider();

    expect(viewer()).toBe("user-from-dexie");
  });

  it("still prefers the live id when both exist", () => {
    cachedViewerId.current = "stale-cached";
    liveViewerId.current = "user-live";

    renderProvider();

    expect(viewer()).toBe("user-live");
  });

  it("publishes nothing when the read found nothing, so the gate stays shut", () => {
    // #2255's contract through the real wiring: unknown is unknown, and the
    // timeline's withhold branch is what a `null` here reaches.
    cachedViewerId.current = null;
    liveViewerId.current = null;

    renderProvider();

    expect(viewer()).toBe("unknown");
  });
});

describe("ChatProvider publishes the persisted block-list floor (#2688)", () => {
  it("hands the thread's block list the floor the first-chunk read returned", () => {
    // `use-thread-block-list.spec.tsx` provides the context by hand, so only
    // this pins that the provider actually publishes it.
    blockFloor.current = new Set(["user-blake"]);

    renderProvider();

    expect(screen.getByTestId("floor").textContent).toBe("user-blake");
  });

  it("publishes none when nothing was cached", () => {
    blockFloor.current = null;

    renderProvider();

    expect(screen.getByTestId("floor").textContent).toBe("none");
  });
});
