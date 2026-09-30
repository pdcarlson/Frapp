import { renderHook, act, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { describe, it, expect, beforeEach, vi } from "vitest";
// Static import, not `await import()`: this package compiles as CommonJS under
// NodeNext, where top-level await is an error. Vitest hoists `vi.mock` above
// imports regardless, so the stub below still lands before the module loads —
// the same shape every other spec in this package uses.
import { usePatchOrgConfig, usePendingConfigKeys } from "./use-org-config";

const { mockPatch } = vi.hoisted(() => ({ mockPatch: vi.fn() }));

// Stub the client provider; the hook only needs a PATCH-capable client and an
// active chapter id. Spread the real module rather than listing exports, per
// the convention in use-members.spec.tsx — a bare factory replaces the module
// wholesale, so the day this hook reaches for a third export the failure points
// here instead of at the call site.
vi.mock("./use-frapp-client", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./use-frapp-client")>()),
  useFrappClient: () => ({ PATCH: mockPatch }),
  useActiveChapterId: () => "chap-1",
}));

const QUERY_KEY = ["chapter-config", "chap-1"] as const;

function makeWrapper(qc: QueryClient) {
  return function Wrapper({ children }: { children: React.ReactNode }) {
    return <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
  };
}

function makeClient() {
  return new QueryClient({
    defaultOptions: {
      queries: { retry: false },
      mutations: { retry: false },
    },
  });
}

describe("usePatchOrgConfig optimistic cache", () => {
  beforeEach(() => {
    mockPatch.mockReset();
  });

  it("optimistically merges the diff into the cache on mutate", async () => {
    const qc = makeClient();
    qc.setQueryData(QUERY_KEY, { enabled_modules: { events: true, tasks: true } });
    mockPatch.mockResolvedValueOnce({ data: {}, error: undefined });

    const { result } = renderHook(() => usePatchOrgConfig(), {
      wrapper: makeWrapper(qc),
    });

    await act(async () => {
      await result.current.mutateAsync({ enabled_modules: { events: false } });
    });

    const cached = qc.getQueryData<{
      enabled_modules: Record<string, boolean>;
    }>(QUERY_KEY);
    // events flipped, tasks preserved (one-level merge of the json column).
    expect(cached?.enabled_modules.events).toBe(false);
    expect(cached?.enabled_modules.tasks).toBe(true);
  });

  it("rolls the cache back to the previous value when the PATCH fails", async () => {
    const qc = makeClient();
    qc.setQueryData(QUERY_KEY, { vocabulary: { recruitment: "Rush" } });
    mockPatch.mockResolvedValueOnce({ data: undefined, error: { message: "boom" } });

    const { result } = renderHook(() => usePatchOrgConfig(), {
      wrapper: makeWrapper(qc),
    });

    await act(async () => {
      await result.current
        .mutateAsync({ vocabulary: { recruitment: "Intake" } })
        .catch(() => undefined);
    });

    const cached = qc.getQueryData<{ vocabulary: Record<string, string> }>(
      QUERY_KEY,
    );
    expect(cached?.vocabulary.recruitment).toBe("Rush");
  });
});

// The web shell's module gate reads `enabled_modules` off the current-chapter
// payload, because members cannot read the config endpoint (#1982). A toggle
// that only moved the config cache left the nav up to five minutes behind.
describe("usePatchOrgConfig and the current-chapter cache", () => {
  const CHAPTER_KEY = ["chapters", "current", "chap-1"] as const;

  beforeEach(() => {
    mockPatch.mockReset();
  });

  it("writes a module toggle into the current chapter at once", async () => {
    const qc = makeClient();
    qc.setQueryData(QUERY_KEY, { enabled_modules: { reports: true } });
    qc.setQueryData(CHAPTER_KEY, {
      name: "Alpha",
      enabled_modules: { reports: true, polls: true },
    });
    let seenDuringFlight: unknown;
    mockPatch.mockImplementationOnce(async () => {
      seenDuringFlight = qc.getQueryData(CHAPTER_KEY);
      return { data: {}, error: undefined };
    });

    const { result } = renderHook(() => usePatchOrgConfig(), {
      wrapper: makeWrapper(qc),
    });
    await act(async () => {
      await result.current.mutateAsync({ enabled_modules: { reports: false } });
    });

    expect(seenDuringFlight).toEqual({
      name: "Alpha",
      enabled_modules: { reports: false, polls: true },
    });
    // Settling re-reads it, so the server's answer wins in the end.
    expect(qc.getQueryState(CHAPTER_KEY)?.isInvalidated).toBe(true);
  });

  it("puts the current chapter back when the PATCH fails", async () => {
    const qc = makeClient();
    qc.setQueryData(QUERY_KEY, { enabled_modules: { reports: true } });
    qc.setQueryData(CHAPTER_KEY, { enabled_modules: { reports: true } });
    mockPatch.mockResolvedValueOnce({ data: undefined, error: { message: "boom" } });

    const { result } = renderHook(() => usePatchOrgConfig(), {
      wrapper: makeWrapper(qc),
    });
    await act(async () => {
      await result.current
        .mutateAsync({ enabled_modules: { reports: false } })
        .catch(() => undefined);
    });

    expect(qc.getQueryData(CHAPTER_KEY)).toEqual({
      enabled_modules: { reports: true },
    });
  });

  // `scope` serialises the PATCHes, not `onMutate`: a second toggle writes its
  // optimistic value while the first is still in flight. Neither the first
  // one's failure nor its settling re-read may undo the second.
  function deferred<T>() {
    let resolve!: (value: T) => void;
    const promise = new Promise<T>((r) => {
      resolve = r;
    });
    return { promise, resolve };
  }

  it("keeps a later toggle when an earlier one fails", async () => {
    const qc = makeClient();
    qc.setQueryData(QUERY_KEY, { enabled_modules: { reports: true, polls: true } });
    qc.setQueryData(CHAPTER_KEY, { enabled_modules: { reports: true, polls: true } });
    const first = deferred<{ data: undefined; error: { message: string } }>();
    const second = deferred<{ data: object; error: undefined }>();
    mockPatch
      .mockImplementationOnce(() => first.promise)
      .mockImplementationOnce(() => second.promise);

    const { result } = renderHook(() => usePatchOrgConfig(), {
      wrapper: makeWrapper(qc),
    });
    let reportsWrite!: Promise<unknown>;
    let pollsWrite!: Promise<unknown>;
    await act(async () => {
      reportsWrite = result.current
        .mutateAsync({ enabled_modules: { reports: false } })
        .catch(() => undefined);
      pollsWrite = result.current.mutateAsync({ enabled_modules: { polls: false } });
      await Promise.resolve();
    });
    await waitFor(() =>
      expect(qc.getQueryData(CHAPTER_KEY)).toEqual({
        enabled_modules: { reports: false, polls: false },
      }),
    );

    await act(async () => {
      first.resolve({ data: undefined, error: { message: "boom" } });
      await reportsWrite;
    });
    // Reports goes back; Polls, still in flight, stays off.
    expect(qc.getQueryData(CHAPTER_KEY)).toEqual({
      enabled_modules: { reports: true, polls: false },
    });

    await act(async () => {
      second.resolve({ data: {}, error: undefined });
      await pollsWrite;
    });
  });

  it("re-reads the current chapter only after the last queued write settles", async () => {
    const qc = makeClient();
    qc.setQueryData(QUERY_KEY, { enabled_modules: {} });
    qc.setQueryData(CHAPTER_KEY, { enabled_modules: {} });
    const first = deferred<{ data: object; error: undefined }>();
    const second = deferred<{ data: object; error: undefined }>();
    mockPatch
      .mockImplementationOnce(() => first.promise)
      .mockImplementationOnce(() => second.promise);

    const { result } = renderHook(() => usePatchOrgConfig(), {
      wrapper: makeWrapper(qc),
    });
    let reportsWrite!: Promise<unknown>;
    let pollsWrite!: Promise<unknown>;
    await act(async () => {
      reportsWrite = result.current.mutateAsync({ enabled_modules: { reports: false } });
      pollsWrite = result.current.mutateAsync({ enabled_modules: { polls: false } });
      await Promise.resolve();
    });

    await act(async () => {
      first.resolve({ data: {}, error: undefined });
      await reportsWrite;
    });
    // A re-read now would return the row without Polls and flip it back on.
    expect(qc.getQueryState(CHAPTER_KEY)?.isInvalidated).toBe(false);

    await act(async () => {
      second.resolve({ data: {}, error: undefined });
      await pollsWrite;
    });
    expect(qc.getQueryState(CHAPTER_KEY)?.isInvalidated).toBe(true);
  });

  it("leaves the current chapter's data alone for a write with no module toggle", async () => {
    const qc = makeClient();
    qc.setQueryData(QUERY_KEY, { vocabulary: { recruitment: "Rush" } });
    const chapter = { enabled_modules: { reports: true } };
    qc.setQueryData(CHAPTER_KEY, chapter);
    let seenDuringFlight: unknown;
    mockPatch.mockImplementationOnce(async () => {
      seenDuringFlight = qc.getQueryData(CHAPTER_KEY);
      return { data: {}, error: undefined };
    });

    const { result } = renderHook(() => usePatchOrgConfig(), {
      wrapper: makeWrapper(qc),
    });
    await act(async () => {
      await result.current.mutateAsync({ vocabulary: { recruitment: "Intake" } });
    });

    expect(seenDuringFlight).toBe(chapter);
  });
});

describe("usePendingConfigKeys (#881)", () => {
  beforeEach(() => {
    mockPatch.mockReset();
  });

  it("reports only the in-flight config leaves so sibling controls stay interactive", async () => {
    const qc = makeClient();
    let resolvePatch!: (value: { data: unknown; error: unknown }) => void;
    mockPatch.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolvePatch = resolve;
        }),
    );

    const { result } = renderHook(
      () => ({
        patch: usePatchOrgConfig(),
        pending: usePendingConfigKeys(),
      }),
      { wrapper: makeWrapper(qc) },
    );

    act(() => {
      void result.current.patch.mutateAsync({
        enabled_modules: { events: false },
      });
    });

    await waitFor(() => {
      expect(result.current.pending.has("enabled_modules")).toBe(true);
      expect(result.current.pending.has("enabled_modules.events")).toBe(true);
    });
    expect(result.current.pending.has("enabled_modules.tasks")).toBe(false);
    expect(result.current.pending.has("dues")).toBe(false);
    expect(result.current.pending.has("branding")).toBe(false);

    await act(async () => {
      resolvePatch({ data: {}, error: undefined });
    });

    await waitFor(() => {
      expect(result.current.pending.size).toBe(0);
    });
  });
});
