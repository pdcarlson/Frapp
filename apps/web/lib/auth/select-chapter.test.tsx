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
 * The switch has to land server-side, reissue the token, and update the store,
 * in that order — see spec/behavior/multi-tenancy.md. Each test here pins one
 * step so a future refactor can't quietly drop it. The cache drop that follows
 * belongs to `FrappProvider`; it is covered in that component's own suite.
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
    // still disagrees with would 403 every subsequent request. Leaving the
    // store alone also means FrappProvider never sees a change, so the cache
    // survives too.
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
