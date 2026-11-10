/** @vitest-environment jsdom */
import React from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createFrappClient } from "@repo/api-sdk";
import { FrappClientProvider } from "./use-frapp-client";
import {
  useAssignPledgeClasses,
  useDeletePledgeClass,
  usePledgeClasses,
  useReorderPledgeClasses,
} from "./use-pledge-classes";

const CHAPTER = "chapter-1";
const answered = (data: unknown) => ({ data, error: undefined });
const refused = (statusCode: number) => ({
  data: undefined,
  error: { statusCode },
});

describe("pledge class hooks", () => {
  let queryClient: QueryClient;
  let invalidate: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    invalidate = vi.spyOn(queryClient, "invalidateQueries");
  });

  const wrapperFor = (client: unknown) => {
    const Wrapper = ({ children }: { children: React.ReactNode }) => (
      <FrappClientProvider
        client={client as ReturnType<typeof createFrappClient>}
        chapterId={CHAPTER}
      >
        <QueryClientProvider client={queryClient}>
          {children}
        </QueryClientProvider>
      </FrappClientProvider>
    );
    Wrapper.displayName = "PledgeClassHookWrapper";
    return Wrapper;
  };

  it("reads the chapter's classes in the order the API serves them", async () => {
    const classes = [
      { id: "b", name: "Beta", position: 0 },
      { id: "a", name: "Alpha", position: 1 },
    ];
    const client = { GET: vi.fn().mockResolvedValue(answered(classes)) };
    const { result } = renderHook(() => usePledgeClasses(), {
      wrapper: wrapperFor(client),
    });
    await waitFor(() => expect(result.current.data).toEqual(classes));
    expect(client.GET).toHaveBeenCalledWith("/v1/pledge-classes");
  });

  it("re-reads the list after a refused reorder, so a stale editor catches up", async () => {
    const client = { PUT: vi.fn().mockResolvedValue(refused(409)) };
    const { result } = renderHook(() => useReorderPledgeClasses(), {
      wrapper: wrapperFor(client),
    });
    await act(async () => {
      await expect(result.current.mutateAsync(["a", "b"])).rejects.toEqual({
        statusCode: 409,
      });
    });
    expect(client.PUT).toHaveBeenCalledWith("/v1/pledge-classes/order", {
      body: { ids: ["a", "b"] },
    });
    expect(invalidate).toHaveBeenCalledWith({
      queryKey: ["pledge-classes", CHAPTER],
    });
  });

  it("refreshes the member reads after an assignment", async () => {
    const assignments = [
      { member_id: "m1", pledge_class_id: "a", order_number: 1 },
    ];
    const client = { PUT: vi.fn().mockResolvedValue(answered(assignments)) };
    const { result } = renderHook(() => useAssignPledgeClasses(), {
      wrapper: wrapperFor(client),
    });
    await act(async () => {
      await result.current.mutateAsync(assignments);
    });
    expect(client.PUT).toHaveBeenCalledWith("/v1/pledge-classes/assignments", {
      body: { assignments },
    });
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ["members", CHAPTER] });
  });

  it("refreshes both the list and the members after a delete", async () => {
    const client = { DELETE: vi.fn().mockResolvedValue(answered(undefined)) };
    const { result } = renderHook(() => useDeletePledgeClass(), {
      wrapper: wrapperFor(client),
    });
    await act(async () => {
      await result.current.mutateAsync("a");
    });
    expect(invalidate).toHaveBeenCalledWith({
      queryKey: ["pledge-classes", CHAPTER],
    });
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ["members", CHAPTER] });
  });
});
