import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import React from "react";
import { FrappClientProvider } from "./use-frapp-client";
import { useReviewServiceEntry, useServiceEntry } from "./use-service-entries";

function createWrapper(queryClient: QueryClient, mockClient: unknown) {
  const Wrapper = ({ children }: { children: React.ReactNode }) => (
    <FrappClientProvider
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

describe("useServiceEntry", () => {
  let queryClient: QueryClient;

  beforeEach(() => {
    queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
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
      params: { path: { id: "entry-1" } },
    });
    expect(result.current.data).toEqual({ id: "entry-1", status: "APPROVED" });
  });

  it("asks nothing for an empty id, the card's 'can't read it' signal", () => {
    const GET = vi.fn();
    renderHook(() => useServiceEntry(""), {
      wrapper: createWrapper(queryClient, { GET }),
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
