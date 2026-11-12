import React from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, renderHook } from "@testing-library/react";
import type { createFrappClient } from "@repo/api-sdk";
import { describe, expect, it, vi } from "vitest";
import { FrappClientProvider } from "./use-frapp-client";
import { useSemesterRollover } from "./use-semesters";

function createWrapper(queryClient: QueryClient, mockClient: unknown) {
  const Wrapper = ({ children }: { children: React.ReactNode }) => (
    <FrappClientProvider
      chapterId="chapter-1"
      client={mockClient as ReturnType<typeof createFrappClient>}
    >
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    </FrappClientProvider>
  );
  Wrapper.displayName = "SemesterRolloverWrapper";
  return Wrapper;
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
