import { renderHook, act } from "@testing-library/react";
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

/**
 * The switch has to land server-side, reissue the token, and update the store,
 * in that order — see spec/behavior/multi-tenancy.md. Each test here pins one
 * step so a future refactor can't quietly drop it.
 *
 * Dropping the outgoing chapter's cached data is step 4 and deliberately lives
 * in `FrappProvider`, keyed on the store write this hook performs; it is
 * covered by that component's own suite.
 */
describe("useSelectChapter", () => {
  beforeEach(() => {
    calls.length = 0;
    activateMutate.mockClear();
    refreshSession.mockClear();
    setActiveChapterId.mockClear();
  });

  it("activates server-side, refreshes the session, then updates the store", async () => {
    const { result } = renderHook(() => useSelectChapter());

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

  it("leaves the store alone when activation fails", async () => {
    activateMutate.mockRejectedValueOnce(new Error("network"));
    const { result } = renderHook(() => useSelectChapter());

    let switched: boolean | undefined;
    await act(async () => {
      switched = await result.current("chap-2");
    });

    expect(switched).toBe(false);
    // Fail-closed: pointing x-chapter-id at a chapter the un-refreshed token
    // still disagrees with would 403 every subsequent request. Not writing the
    // store is also what keeps the cache intact, since the drop is keyed on it.
    expect(setActiveChapterId).not.toHaveBeenCalled();
  });

  it("leaves the store alone when the session refresh fails", async () => {
    refreshSession.mockRejectedValueOnce(new Error("offline"));
    const { result } = renderHook(() => useSelectChapter());

    let switched: boolean | undefined;
    await act(async () => {
      switched = await result.current("chap-2");
    });

    expect(switched).toBe(false);
    expect(calls).toEqual(["activate"]);
    expect(setActiveChapterId).not.toHaveBeenCalled();
  });
});
