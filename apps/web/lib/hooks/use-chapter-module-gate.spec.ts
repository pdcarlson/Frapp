import { renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The member-facing module gate (#1982).
 *
 * The shell used to read module state off `useOrgConfig()`, whose endpoint is
 * guarded by `chapter-config:view`. For an ordinary member that read errors on
 * every load, and the nav's gate failed open for good. These pin the source
 * and the three states a caller has to tell apart.
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

vi.mock("@/lib/stores/chapter-store", () => ({
  useChapterStore: (selector: (s: { activeChapterId: string | null }) => unknown) =>
    selector({ activeChapterId: "chapter-1" }),
}));

const { useChapterModuleGate } = await import("./use-chapter-module-gate");

describe("useChapterModuleGate", () => {
  beforeEach(() => {
    useCurrentChapter.mockReset();
  });

  it("reads the active chapter's member-readable payload", () => {
    useCurrentChapter.mockReturnValue({ data: undefined, isError: false });
    renderHook(() => useChapterModuleGate());
    expect(useCurrentChapter).toHaveBeenCalledWith({
      chapterId: "chapter-1",
      enabled: true,
    });
  });

  it("does not gate while the read is in flight, so nothing flashes out", () => {
    useCurrentChapter.mockReturnValue({ data: undefined, isError: false });
    const { result } = renderHook(() => useChapterModuleGate());
    expect(result.current).toBeUndefined();
  });

  it("hides exactly the modules the chapter switched off", () => {
    useCurrentChapter.mockReturnValue({
      data: { enabled_modules: { polls: false, events: true } },
      isError: false,
    });
    const { result } = renderHook(() => useChapterModuleGate());
    expect(result.current?.("polls")).toBe(false);
    expect(result.current?.("events")).toBe(true);
    // Absence is not disablement: a chapter created before a module existed
    // never turned it off.
    expect(result.current?.("backwork")).toBe(true);
  });

  it("closes once the read has failed, rather than advertising routes the API refuses", () => {
    useCurrentChapter.mockReturnValue({ data: undefined, isError: true });
    const { result } = renderHook(() => useChapterModuleGate());
    expect(result.current?.("events")).toBe(false);
  });

  it("keeps answering from cached data when only a refetch failed", () => {
    useCurrentChapter.mockReturnValue({
      data: { enabled_modules: { polls: false } },
      isError: true,
    });
    const { result } = renderHook(() => useChapterModuleGate());
    expect(result.current?.("events")).toBe(true);
    expect(result.current?.("polls")).toBe(false);
  });
});
