/** @vitest-environment jsdom */
import { renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * #764. The failure this suite exists to prevent is an ordering one, and it is
 * silent: activating a chapter without then refreshing the session leaves the
 * new `active_chapter_id` claim unissued, so `x-chapter-id` and the token
 * disagree and `ChapterGuard` answers 403 `chapter.context.mismatch` to *every*
 * subsequent request. Asserting only "both were called" would pass against that
 * bug, so the order itself is recorded and asserted.
 */

const mockState = vi.hoisted(() => ({
  calls: [] as string[],
  activateError: null as Error | null,
  /**
   * Modelled on the REAL contract, which is the whole point of this field.
   *
   * `GoTrueClient._refreshSession` catches every `AuthError` — network failures
   * included — and RESOLVES with `{ data, error }`. It does not reject. An
   * earlier version of this suite mocked it as throwing, so it passed against
   * code that never inspected the returned error: a false green on exactly the
   * path it was written to cover.
   */
  refreshError: null as { message: string } | null,
  client: null as {
    auth: {
      refreshSession: () => Promise<{ error: { message: string } | null }>;
    };
  } | null,
}));

vi.mock("@repo/hooks", () => ({
  useActivateChapter: () => ({
    mutateAsync: vi.fn(async (chapterId: string) => {
      mockState.calls.push(`activate:${chapterId}`);
      if (mockState.activateError) throw mockState.activateError;
      return { id: chapterId };
    }),
  }),
}));

vi.mock("./supabase", () => ({
  getSupabaseClient: () => mockState.client,
}));

const { useSelectChapter } = await import("./select-chapter");

function renderSelect() {
  return renderHook(() => useSelectChapter()).result.current;
}

beforeEach(() => {
  mockState.calls = [];
  mockState.activateError = null;
  mockState.refreshError = null;
  mockState.client = {
    auth: {
      refreshSession: vi.fn(async () => {
        mockState.calls.push("refreshSession");
        return { error: mockState.refreshError };
      }),
    },
  };
});

afterEach(() => {
  vi.clearAllMocks();
});

describe("useSelectChapter", () => {
  it("activates server-side before refreshing the session", async () => {
    const selectChapter = renderSelect();

    await expect(selectChapter("chapter-a")).resolves.toBe(true);

    expect(mockState.calls).toEqual(["activate:chapter-a", "refreshSession"]);
  });

  it("does not refresh the session when activation fails", async () => {
    mockState.activateError = new Error("activate failed");
    const selectChapter = renderSelect();

    await expect(selectChapter("chapter-a")).resolves.toBe(false);

    // Refreshing after a failed activate would reissue the *old* claim and make
    // the failure look like a success to everything downstream.
    expect(mockState.calls).toEqual(["activate:chapter-a"]);
  });

  it("reports failure when the refresh RESOLVES with an error", async () => {
    mockState.refreshError = { message: "network down" };
    const selectChapter = renderSelect();

    // The regression guard. `refreshSession` resolving with `{ error }` rather
    // than rejecting means a bare `await` inside a try/catch reports success
    // for a failed refresh — and the picker then waits forever for a navigation
    // that cannot come, because the token still carries the previous claim.
    await expect(selectChapter("chapter-a")).resolves.toBe(false);
    expect(mockState.calls).toEqual(["activate:chapter-a", "refreshSession"]);
  });

  it("fails closed when Supabase is not configured", async () => {
    mockState.client = null;
    const selectChapter = renderSelect();

    await expect(selectChapter("chapter-a")).resolves.toBe(false);
    expect(mockState.calls).toEqual([]);
  });

  it("never throws, so a caller cannot roll back a completed action", async () => {
    mockState.activateError = new Error("boom");
    const selectChapter = renderSelect();

    await expect(selectChapter("chapter-a")).resolves.toBe(false);
  });
});
