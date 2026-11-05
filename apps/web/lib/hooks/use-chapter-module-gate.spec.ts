import { renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The member-facing module gate (#1982).
 *
 * The shell used to read module state off `useOrgConfig()`, whose endpoint is
 * guarded by `chapter-config:view`. For an ordinary member that read errors on
 * every load, and the nav's gate failed open for good. These pin the source
 * and the states a caller has to tell apart.
 */

const useCurrentChapter = vi.fn();
vi.mock("@repo/hooks", () => ({
  useCurrentChapter: (args: unknown) => useCurrentChapter(args),
  // Present so a regression back to the officer-only read fails loudly here
  // rather than quietly returning the stub's `undefined`.
  useOrgConfig: () => {
    throw new Error("the member-facing gate must not read chapter config");
  },
}));

const chapterStore = { activeChapterId: "chapter-1" as string | null };
vi.mock("@/lib/stores/chapter-store", () => ({
  useChapterStore: (selector: (s: { activeChapterId: string | null }) => unknown) =>
    selector(chapterStore),
}));

const network = { isOffline: false };
vi.mock("@/lib/providers/network-provider", () => ({
  useNetwork: () => network,
}));

/**
 * A `useCurrentChapter` result. `fetchStatus` defaults to a running read, the
 * only uncached state that is genuinely loading.
 */
function chapterRead(
  overrides: {
    data?: unknown;
    isError?: boolean;
    fetchStatus?: "fetching" | "paused" | "idle";
    refetch?: (...args: unknown[]) => unknown;
  } = {},
) {
  const read = {
    data: undefined as unknown,
    isError: false,
    fetchStatus: "fetching" as const,
    refetch: vi.fn(),
    ...overrides,
  };
  // TanStack's `isPending` is "no data yet", whatever the fetch is doing.
  return { ...read, isPending: read.data === undefined };
}

const { useChapterModuleGate, useChapterModuleGateState } = await import(
  "./use-chapter-module-gate"
);

beforeEach(() => {
  useCurrentChapter.mockReset();
  chapterStore.activeChapterId = "chapter-1";
  network.isOffline = false;
});

describe("useChapterModuleGate", () => {
  it("reads the active chapter's member-readable payload", () => {
    useCurrentChapter.mockReturnValue(chapterRead());
    renderHook(() => useChapterModuleGate());
    expect(useCurrentChapter).toHaveBeenCalledWith({
      chapterId: "chapter-1",
      enabled: true,
    });
  });

  it("does not gate while the read is in flight, so nothing flashes out", () => {
    useCurrentChapter.mockReturnValue(chapterRead());
    const { result } = renderHook(() => useChapterModuleGate());
    expect(result.current).toBeUndefined();
  });

  it("hides exactly the modules the chapter switched off", () => {
    useCurrentChapter.mockReturnValue(
      chapterRead({
        data: { enabled_modules: { polls: false, events: true } },
        fetchStatus: "idle",
      }),
    );
    const { result } = renderHook(() => useChapterModuleGate());
    expect(result.current?.("polls")).toBe(false);
    expect(result.current?.("events")).toBe(true);
    // Absence is not disablement: a chapter created before a module existed
    // never turned it off.
    expect(result.current?.("backwork")).toBe(true);
  });

  it("closes once the read has failed, rather than advertising routes the API refuses", () => {
    useCurrentChapter.mockReturnValue(
      chapterRead({ isError: true, fetchStatus: "idle" }),
    );
    const { result } = renderHook(() => useChapterModuleGate());
    expect(result.current?.("events")).toBe(false);
  });

  // README §5 rule 4 reserves hiding for modules the chapter switched off. A
  // read that has not answered is not one of those, so the nav keeps its rows.
  it("does not gate while the read is paused offline with nothing cached", () => {
    useCurrentChapter.mockReturnValue(chapterRead({ fetchStatus: "paused" }));
    const { result } = renderHook(() => useChapterModuleGate());
    expect(result.current).toBeUndefined();
  });

  it("does not gate when no chapter is active, as on the server render", () => {
    // The chapter store's server snapshot has no active chapter, so SSR and
    // hydration see a disabled read. Closing here hid every module row on
    // each cold load until the store rehydrated.
    chapterStore.activeChapterId = null;
    useCurrentChapter.mockReturnValue(chapterRead({ fetchStatus: "idle" }));
    const { result } = renderHook(() => useChapterModuleGate());
    expect(result.current).toBeUndefined();
  });

  it("closes once the read has failed offline, as it does online", () => {
    network.isOffline = true;
    useCurrentChapter.mockReturnValue(
      chapterRead({ isError: true, fetchStatus: "idle" }),
    );
    const { result } = renderHook(() => useChapterModuleGate());
    expect(result.current?.("events")).toBe(false);
  });

  it("keeps answering from cached data when only a refetch failed", () => {
    useCurrentChapter.mockReturnValue(
      chapterRead({
        data: { enabled_modules: { polls: false } },
        isError: true,
        fetchStatus: "idle",
      }),
    );
    const { result } = renderHook(() => useChapterModuleGate());
    expect(result.current?.("events")).toBe(true);
    expect(result.current?.("polls")).toBe(false);
  });
});

/**
 * The same read with its state, for chat's slash commands (#2957, #2993). The
 * palette and the composer have to tell "still loading", "offline" and
 * "failed" apart from "switched off", because each says something different
 * to the member.
 */
describe("useChapterModuleGateState", () => {
  it("is loading, and closed, while the read is in flight", () => {
    useCurrentChapter.mockReturnValue(chapterRead());
    const { result } = renderHook(() => useChapterModuleGateState());
    expect(result.current.status).toBe("loading");
    // Fail closed (#310): nothing module-backed runs before the gate answers.
    expect(result.current.isModuleEnabled("polls")).toBe(false);
  });

  it("is an error, and closed, once the read failed with nothing cached", () => {
    useCurrentChapter.mockReturnValue(
      chapterRead({ isError: true, fetchStatus: "idle" }),
    );
    const { result } = renderHook(() => useChapterModuleGateState());
    expect(result.current.status).toBe("error");
    expect(result.current.isModuleEnabled("polls")).toBe(false);
  });

  // #3160: paused and disabled reads used to report "loading" too, which the
  // palette drew as a wait that never ended, with no Retry.
  it("is offline, and closed, while the read is paused with nothing cached", () => {
    useCurrentChapter.mockReturnValue(chapterRead({ fetchStatus: "paused" }));
    const { result } = renderHook(() => useChapterModuleGateState());
    expect(result.current.status).toBe("offline");
    expect(result.current.isModuleEnabled("polls")).toBe(false);
  });

  it("is offline while the dashboard is OFFLINE and the read retries or failed", () => {
    // Offline, TanStack does not always pause: a page that loaded offline runs
    // the read and fails it instead (#2267). README §4 gives it the paused
    // branch.
    network.isOffline = true;
    useCurrentChapter.mockReturnValue(chapterRead({ fetchStatus: "fetching" }));
    const { result, rerender } = renderHook(() => useChapterModuleGateState());
    expect(result.current.status).toBe("offline");

    useCurrentChapter.mockReturnValue(
      chapterRead({ isError: true, fetchStatus: "idle" }),
    );
    rerender();
    expect(result.current.status).toBe("offline");
    expect(result.current.isModuleEnabled("polls")).toBe(false);
  });

  it("is an error, and closed, when no chapter is active, so the read is disabled", () => {
    // TanStack keeps a disabled query pending with nothing in flight
    // (`fetchStatus: "idle"`). README §4: a disabled query is not a loading
    // state, and idle with nothing cached fails closed. Offline changes
    // nothing here, because there is no chapter to check either way.
    chapterStore.activeChapterId = null;
    network.isOffline = true;
    useCurrentChapter.mockReturnValue(chapterRead({ fetchStatus: "idle" }));
    const { result } = renderHook(() => useChapterModuleGateState());
    expect(useCurrentChapter).toHaveBeenCalledWith({
      chapterId: null,
      enabled: false,
    });
    expect(result.current.status).toBe("error");
    expect(result.current.isModuleEnabled("polls")).toBe(false);
  });

  it("is loading while an enabled read with no error sits idle between runs", () => {
    // A read that a newer one cancelled, or one about to start, is reverted
    // to idle without an error. It is not a failure, and nothing is wrong yet.
    useCurrentChapter.mockReturnValue(chapterRead({ fetchStatus: "idle" }));
    const { result } = renderHook(() => useChapterModuleGateState());
    expect(result.current.status).toBe("loading");
    expect(result.current.isModuleEnabled("polls")).toBe(false);
  });

  it("is loading again while a Retry runs after a failure", () => {
    useCurrentChapter.mockReturnValue(
      chapterRead({ isError: true, fetchStatus: "fetching" }),
    );
    const { result } = renderHook(() => useChapterModuleGateState());
    expect(result.current.status).toBe("loading");
  });

  it("is ready from the member view, including a failed refetch over cached data", () => {
    useCurrentChapter.mockReturnValue(
      chapterRead({
        data: { enabled_modules: { polls: false } },
        isError: true,
        fetchStatus: "idle",
      }),
    );
    const { result } = renderHook(() => useChapterModuleGateState());
    expect(result.current.status).toBe("ready");
    expect(result.current.isModuleEnabled("polls")).toBe(false);
    expect(result.current.isModuleEnabled("events")).toBe(true);
  });

  it("stays ready from the cache while a refetch is paused offline", () => {
    useCurrentChapter.mockReturnValue(
      chapterRead({
        data: { enabled_modules: { polls: false } },
        fetchStatus: "paused",
      }),
    );
    network.isOffline = true;
    const { result } = renderHook(() => useChapterModuleGateState());
    expect(result.current.status).toBe("ready");
    expect(result.current.isModuleEnabled("events")).toBe(true);
  });

  it("re-runs a read that failed offline once the dashboard reconnects", () => {
    // TanStack never saw the outage, so nothing else would re-run it.
    const refetch = vi.fn();
    network.isOffline = true;
    useCurrentChapter.mockReturnValue(
      chapterRead({ isError: true, fetchStatus: "idle", refetch }),
    );
    const { rerender } = renderHook(() => useChapterModuleGateState());
    expect(refetch).not.toHaveBeenCalled();

    network.isOffline = false;
    rerender();
    expect(refetch).toHaveBeenCalledTimes(1);
    expect(refetch).toHaveBeenCalledWith({ cancelRefetch: false });
  });

  it("re-runs a read whose last attempt failed just after the reconnect", () => {
    // Still retrying when the connection came back, the read spends its last
    // attempt online and fails then. The outage is what left it failed.
    const refetch = vi.fn();
    network.isOffline = true;
    useCurrentChapter.mockReturnValue(chapterRead({ refetch }));
    const { rerender } = renderHook(() => useChapterModuleGateState());

    network.isOffline = false;
    rerender();
    expect(refetch).not.toHaveBeenCalled();

    useCurrentChapter.mockReturnValue(
      chapterRead({ isError: true, fetchStatus: "idle", refetch }),
    );
    rerender();
    expect(refetch).toHaveBeenCalledTimes(1);

    // Once per outage: a second failure is the ordinary error state.
    rerender();
    expect(refetch).toHaveBeenCalledTimes(1);
  });

  it.each([
    [
      "a read with cached data",
      () => chapterRead({ data: {}, isError: true, fetchStatus: "idle" }),
    ],
    ["a read that has not failed", () => chapterRead({ fetchStatus: "idle" })],
  ])("does not re-run %s after a reconnect", (_label, read) => {
    network.isOffline = true;
    const current = read();
    useCurrentChapter.mockReturnValue(current);
    const { rerender } = renderHook(() => useChapterModuleGateState());
    network.isOffline = false;
    rerender();
    expect(current.refetch).not.toHaveBeenCalled();
  });

  it("does not re-run a disabled read after a reconnect", () => {
    chapterStore.activeChapterId = null;
    network.isOffline = true;
    const current = chapterRead({ isError: true, fetchStatus: "idle" });
    useCurrentChapter.mockReturnValue(current);
    const { rerender } = renderHook(() => useChapterModuleGateState());
    network.isOffline = false;
    rerender();
    expect(current.refetch).not.toHaveBeenCalled();
  });

  it("retries the member-view read", () => {
    const refetch = vi.fn();
    useCurrentChapter.mockReturnValue(
      chapterRead({ isError: true, fetchStatus: "idle", refetch }),
    );
    const { result } = renderHook(() => useChapterModuleGateState());
    result.current.retry();
    expect(refetch).toHaveBeenCalledTimes(1);
  });
});
