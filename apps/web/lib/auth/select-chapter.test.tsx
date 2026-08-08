import { renderHook, act } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { describe, it, expect, beforeEach, vi } from "vitest";

const { activateMutate, refreshSession, setActiveChapterId, calls } = vi.hoisted(
  () => {
    const calls: string[] = [];
    return {
      calls,
      activateMutate: vi.fn(async () => {
        calls.push("activate");
      }),
      refreshSession: vi.fn(async () => {
        calls.push("refreshSession");
      }),
      setActiveChapterId: vi.fn(() => {
        calls.push("setActiveChapterId");
      }),
    };
  },
);

vi.mock("@repo/hooks", () => ({
  useActivateChapter: () => ({ mutateAsync: activateMutate }),
}));

vi.mock("@/lib/supabase/client", () => ({
  createSupabaseBrowserClient: () => ({ auth: { refreshSession } }),
}));

vi.mock("@/lib/stores/chapter-store", () => ({
  useChapterStore: (
    selector: (s: { setActiveChapterId: (id: string | null) => void }) => unknown,
  ) => selector({ setActiveChapterId }),
}));

const { useSelectChapter } = await import("./select-chapter");

function makeClient() {
  return new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
}

function renderSelectChapter(qc: QueryClient) {
  return renderHook(() => useSelectChapter(), {
    wrapper: ({ children }: { children: React.ReactNode }) => (
      <QueryClientProvider client={qc}>{children}</QueryClientProvider>
    ),
  });
}

/**
 * The switch has to land server-side, reissue the token, update the store, and
 * drop the cache — see spec/behavior/multi-tenancy.md. Each test here pins one
 * of those so a future refactor can't quietly drop it.
 */
describe("useSelectChapter", () => {
  beforeEach(() => {
    calls.length = 0;
    activateMutate.mockClear();
    refreshSession.mockClear();
    setActiveChapterId.mockClear();
  });

  it("activates server-side, refreshes the session, then updates the store", async () => {
    const qc = makeClient();
    const { result } = renderSelectChapter(qc);

    let switched: boolean | undefined;
    await act(async () => {
      switched = await result.current("chap-2");
    });

    expect(switched).toBe(true);
    expect(activateMutate).toHaveBeenCalledWith("chap-2");
    expect(setActiveChapterId).toHaveBeenCalledWith("chap-2");
    // Order is the whole point: refreshing before activating would reissue the
    // token with the old claim, and writing the store before either would put
    // x-chapter-id ahead of the claim (403 chapter.context.mismatch).
    expect(calls).toEqual(["activate", "refreshSession", "setActiveChapterId"]);
  });

  it("drops cached chapter-scoped data so the previous chapter can't be rendered", async () => {
    const qc = makeClient();
    // Two shapes on purpose: a key that carries chapterId and one that does
    // not. The unscoped kind (["channels"], ["documents"], ["tasks"]) is what
    // makes a blanket clear necessary — invalidating by chapter id would miss it.
    qc.setQueryData(["members", "chap-1"], [{ id: "m-1" }]);
    qc.setQueryData(["channels"], [{ id: "ch-1", name: "general" }]);

    const { result } = renderSelectChapter(qc);
    await act(async () => {
      await result.current("chap-2");
    });

    expect(qc.getQueryData(["members", "chap-1"])).toBeUndefined();
    expect(qc.getQueryData(["channels"])).toBeUndefined();
  });

  it("leaves the store and the cache alone when activation fails", async () => {
    const qc = makeClient();
    qc.setQueryData(["channels"], [{ id: "ch-1" }]);
    activateMutate.mockRejectedValueOnce(new Error("network"));

    const { result } = renderSelectChapter(qc);

    let switched: boolean | undefined;
    await act(async () => {
      switched = await result.current("chap-2");
    });

    expect(switched).toBe(false);
    // Fail-closed: pointing x-chapter-id at a chapter the un-refreshed token
    // still disagrees with would 403 every subsequent request.
    expect(setActiveChapterId).not.toHaveBeenCalled();
    expect(qc.getQueryData(["channels"])).toEqual([{ id: "ch-1" }]);
  });

  it("leaves the store and the cache alone when the session refresh fails", async () => {
    const qc = makeClient();
    qc.setQueryData(["channels"], [{ id: "ch-1" }]);
    refreshSession.mockRejectedValueOnce(new Error("offline"));

    const { result } = renderSelectChapter(qc);

    let switched: boolean | undefined;
    await act(async () => {
      switched = await result.current("chap-2");
    });

    expect(switched).toBe(false);
    expect(setActiveChapterId).not.toHaveBeenCalled();
    expect(qc.getQueryData(["channels"])).toEqual([{ id: "ch-1" }]);
  });
});
