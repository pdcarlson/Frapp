import { QueryClient } from "@tanstack/react-query";
import { act, renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { useSemesterRollover } from "./use-semesters";
import { createHookWrapper } from "./test-utils";

function createWrapper(queryClient: QueryClient, mockClient: unknown) {
  return createHookWrapper({
    client: mockClient,
    queryClient,
    chapterId: "chapter-1",
    displayName: "SemesterRolloverWrapper",
  });
}

describe("useSemesterRollover", () => {
  it("re-reads points, whose semester window starts at the archive it writes", async () => {
    const queryClient = new QueryClient();
    const invalidate = vi.spyOn(queryClient, "invalidateQueries");
    const POST = vi
      .fn()
      .mockResolvedValue({ data: { id: "a-1" }, error: null });
    const { result } = renderHook(() => useSemesterRollover(), {
      wrapper: createWrapper(queryClient, { POST }),
    });

    await act(async () => {
      await result.current.mutateAsync({
        label: "Fall 2026",
        start_date: "2026-08-25",
        end_date: "2026-12-18",
      });
    });

    for (const queryKey of [
      ["semesters"],
      ["chapters"],
      ["members"],
      ["points"],
    ]) {
      expect(invalidate).toHaveBeenCalledWith({ queryKey });
    }
  });
});
