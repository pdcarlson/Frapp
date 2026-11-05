import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import React from "react";
import { FrappClientProvider } from "./use-frapp-client";
import {
  rushKeys,
  useBidRushCandidate,
  useRushCandidate,
  useVoteRushCandidate,
} from "./use-rush";

const VIEW = {
  id: "cand-1",
  chapter_id: "chapter-1",
  display_name: "Jordan Reyes",
  name_key: "jordan reyes",
  user_id: null,
  stage: "new",
  bid_status: "none",
  created_by: "user-a",
  created_at: "2026-11-04T18:00:00.000Z",
  vote_count: 3,
  viewer_has_voted: false,
};

function createWrapper(
  queryClient: QueryClient,
  mockClient: unknown,
  chapterId: string | null = "chapter-1",
) {
  const Wrapper = ({ children }: { children: React.ReactNode }) => (
    <FrappClientProvider
      chapterId={chapterId}
      client={
        mockClient as unknown as ReturnType<
          typeof import("@repo/api-sdk").createFrappClient
        >
      }
    >
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    </FrappClientProvider>
  );
  Wrapper.displayName = "Wrapper";
  return Wrapper;
}

describe("useRushCandidate", () => {
  let queryClient: QueryClient;

  beforeEach(() => {
    queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
  });

  it("reads one candidate by id", async () => {
    const GET = vi.fn().mockResolvedValue({ data: VIEW, error: null });
    const { result } = renderHook(() => useRushCandidate("cand-1"), {
      wrapper: createWrapper(queryClient, { GET }),
    });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(GET).toHaveBeenCalledWith("/v1/rush/candidates/{id}", {
      params: { path: { id: "cand-1" } },
    });
    expect(result.current.data).toEqual(VIEW);
  });

  it("asks nothing without an id, the card's 'can't read it' signal, or without a chapter", () => {
    const GET = vi.fn();
    renderHook(() => useRushCandidate(undefined), {
      wrapper: createWrapper(queryClient, { GET }),
    });
    renderHook(() => useRushCandidate("cand-1"), {
      wrapper: createWrapper(queryClient, { GET }, null),
    });
    expect(GET).not.toHaveBeenCalled();
  });

  it.each([403, 404])(
    "replaces a tally read earlier with null when a refetch answers %i",
    async (statusCode) => {
      // A deleted candidate (404) or a lost permission (403) must clear the
      // tally: a thrown refetch would keep the read before it.
      let answer: { data: unknown; error: unknown } = {
        data: VIEW,
        error: null,
      };
      const GET = vi.fn(async () => answer);
      const { result } = renderHook(() => useRushCandidate("cand-1"), {
        wrapper: createWrapper(queryClient, { GET }),
      });
      await waitFor(() => expect(result.current.data).toEqual(VIEW));

      answer = { data: undefined, error: { statusCode, message: "No" } };
      await act(async () => {
        await result.current.refetch();
      });
      await waitFor(() => expect(result.current.data).toBeNull());
      expect(result.current.isError).toBe(false);
    },
  );

  it("still throws any other failure", async () => {
    const GET = vi.fn().mockResolvedValue({
      data: undefined,
      error: { statusCode: 500, message: "Internal server error" },
    });
    const { result } = renderHook(() => useRushCandidate("cand-1"), {
      wrapper: createWrapper(queryClient, { GET }),
    });
    await waitFor(() => expect(result.current.isError).toBe(true));
  });
});

describe.each([
  ["useVoteRushCandidate", useVoteRushCandidate, "/v1/rush/candidates/{id}/vote"],
  ["useBidRushCandidate", useBidRushCandidate, "/v1/rush/candidates/{id}/bid"],
] as const)("%s", (_name, useWrite, route) => {
  let queryClient: QueryClient;

  beforeEach(() => {
    queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
    });
  });

  it("posts to the candidate's route and replaces the card's read with the answer", async () => {
    const answered = { ...VIEW, vote_count: 4, viewer_has_voted: true };
    const POST = vi.fn().mockResolvedValue({ data: answered, error: null });
    const { result } = renderHook(() => useWrite(), {
      wrapper: createWrapper(queryClient, { POST }),
    });
    await act(async () => {
      await result.current.mutateAsync("cand-1");
    });
    expect(POST).toHaveBeenCalledWith(route, {
      params: { path: { id: "cand-1" } },
    });
    expect(
      queryClient.getQueryData(rushKeys.detail("chapter-1", "cand-1")),
    ).toEqual(answered);
  });

  it("throws a refusal for the card to word, and leaves the read alone", async () => {
    queryClient.setQueryData(rushKeys.detail("chapter-1", "cand-1"), VIEW);
    const error = { statusCode: 403, message: "No roles assigned" };
    const POST = vi.fn().mockResolvedValue({ data: undefined, error });
    const { result } = renderHook(() => useWrite(), {
      wrapper: createWrapper(queryClient, { POST }),
    });
    await act(async () => {
      await expect(result.current.mutateAsync("cand-1")).rejects.toBe(error);
    });
    expect(
      queryClient.getQueryData(rushKeys.detail("chapter-1", "cand-1")),
    ).toEqual(VIEW);
  });
});
