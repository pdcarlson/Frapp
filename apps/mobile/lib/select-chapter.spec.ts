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
  refreshError: null as Error | null,
  client: null as { auth: { refreshSession: () => Promise<void> } } | null,
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
        if (mockState.refreshError) throw mockState.refreshError;
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

  it("reports failure when the refresh itself fails", async () => {
    mockState.refreshError = new Error("network down");
    const selectChapter = renderSelect();

    // Activation succeeded server-side, but the token in hand still carries the
    // previous claim, so the caller must not treat this as a completed switch.
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
