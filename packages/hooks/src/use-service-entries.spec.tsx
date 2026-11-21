import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { QueryClient } from "@tanstack/react-query";
import { useReviewServiceEntry, useServiceEntry } from "./use-service-entries";
import { createHookWrapper, createTestQueryClient } from "./test-utils";

function createWrapper(
  queryClient: QueryClient,
  mockClient: unknown,
  chapterId: string | null = "chapter-1",
) {
  return createHookWrapper({
    client: mockClient,
    queryClient,
    chapterId,
    displayName: "Wrapper",
  });
}

describe("useServiceEntry", () => {
  let queryClient: QueryClient;

  beforeEach(() => {
    queryClient = createTestQueryClient();
  });

  it("reads one entry by id", async () => {
    const GET = vi.fn().mockResolvedValue({
      data: { id: "entry-1", status: "APPROVED" },
      error: null,
    });
    const { result } = renderHook(() => useServiceEntry("entry-1"), {
      wrapper: createWrapper(queryClient, { GET }),
    });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(GET).toHaveBeenCalledWith("/v1/service-entries/{id}", {
      signal: expect.any(AbortSignal),
      params: { path: { id: "entry-1" } },
    });
    expect(result.current.data).toEqual({ id: "entry-1", status: "APPROVED" });
  });

  it("asks nothing for an empty id, the card's 'can't read it' signal, or without a chapter", () => {
    // Without a chapter the permissions read is held too, and an owner's card
    // would otherwise ask for its entry with no chapter context.
    const GET = vi.fn();
    renderHook(() => useServiceEntry(""), {
      wrapper: createWrapper(queryClient, { GET }),
    });
    renderHook(() => useServiceEntry("entry-1"), {
      wrapper: createWrapper(queryClient, { GET }, null),
    });
    expect(GET).not.toHaveBeenCalled();
  });

  it.each([403, 404])(
    "replaces a badge read earlier with null when a refetch answers %i",
    async (statusCode) => {
      // A deleted entry (404) or a lost permission (403) must clear the badge:
      // a thrown refetch would keep the "Approved" read before it.
      let answer: { data: unknown; error: unknown } = {
        data: { id: "entry-1", status: "APPROVED" },
        error: null,
      };
      const GET = vi.fn(async () => answer);
      const { result } = renderHook(() => useServiceEntry("entry-1"), {
        wrapper: createWrapper(queryClient, { GET }),
      });
      await waitFor(() =>
        expect(result.current.data).toEqual({
          id: "entry-1",
          status: "APPROVED",
        }),
      );

      answer = { data: undefined, error: { statusCode, message: "No" } };
      await act(async () => {
        await result.current.refetch();
      });

      await waitFor(() => expect(result.current.data).toBeNull());
      expect(result.current.isError).toBe(false);
    },
  );

  it("still throws on any other failure, so it is retried and reported", async () => {
    const GET = vi.fn().mockResolvedValue({
      data: undefined,
      error: { statusCode: 500, message: "Internal server error" },
    });
    const { result } = renderHook(() => useServiceEntry("entry-1"), {
      wrapper: createWrapper(queryClient, { GET }),
    });
    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(result.current.data).toBeUndefined();
  });

  it("throws a chapter-context 403, which clears by itself, so it keeps its retry", async () => {
    const GET = vi.fn().mockResolvedValue({
      data: undefined,
      error: {
        statusCode: 403,
        code: "chapter.context.mismatch",
        message: "Chapter context mismatch",
      },
    });
    const { result } = renderHook(() => useServiceEntry("entry-1"), {
      wrapper: createWrapper(queryClient, { GET }),
    });
    await waitFor(() => expect(result.current.isError).toBe(true));
  });

  it("refreshes when an officer reviews the entry from any screen", async () => {
    let status = "PENDING";
    const GET = vi.fn(async () => ({
      data: { id: "entry-1", status },
      error: null,
    }));
    const PATCH = vi.fn(async () => {
      status = "APPROVED";
      return { data: { id: "entry-1" }, error: null };
    });
    const wrapper = createWrapper(queryClient, { GET, PATCH });
    const entry = renderHook(() => useServiceEntry("entry-1"), { wrapper });
    await waitFor(() => expect(entry.result.current.data).toBeDefined());

    const review = renderHook(() => useReviewServiceEntry(), { wrapper });
    await act(async () => {
      await review.result.current.mutateAsync({
        id: "entry-1",
        body: { status: "APPROVED" },
      });
    });

    await waitFor(() =>
      expect(entry.result.current.data).toEqual({
        id: "entry-1",
        status: "APPROVED",
      }),
    );
  });
});

describe("useReviewServiceEntry points refresh", () => {
  it.each([
    ["APPROVED", true],
    ["REJECTED", false],
  ] as const)(
    "re-reads points after a %s review only when it awards them",
    async (status, refreshesPoints) => {
      const queryClient = createTestQueryClient();
      const invalidate = vi.spyOn(queryClient, "invalidateQueries");
      const PATCH = vi.fn(async () => ({
        data: { id: "entry-1" },
        error: null,
      }));
      const { result } = renderHook(() => useReviewServiceEntry(), {
        wrapper: createWrapper(queryClient, { PATCH }),
      });

      await act(async () => {
        await result.current.mutateAsync({ id: "entry-1", body: { status } });
      });

      expect(invalidate).toHaveBeenCalledWith({
        queryKey: ["service-entries"],
      });
      // Approval awards the submitter's SERVICE points in the same
      // transaction; the leaderboard must not keep the old total.
      if (refreshesPoints) {
        expect(invalidate).toHaveBeenCalledWith({ queryKey: ["points"] });
      } else {
        expect(invalidate).not.toHaveBeenCalledWith({ queryKey: ["points"] });
      }
    },
  );
});
