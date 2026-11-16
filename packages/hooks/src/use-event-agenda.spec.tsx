/** @vitest-environment jsdom */
import React from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { createFrappClient } from "@repo/api-sdk";
import { useSaveEventLists } from "./use-event-agenda";
import { FrappClientProvider } from "./use-frapp-client";

const CHAPTER = "ch-1";
const KEY = ["events", CHAPTER, "evt-1"];
const ROW = {
  id: "evt-1",
  name: "Chapter Meeting",
  agenda: [{ id: "a1", text: "Treasurer report", done: false }],
};

function setup(PATCH: ReturnType<typeof vi.fn>) {
  const queryClient = new QueryClient({
    defaultOptions: { mutations: { retry: false } },
  });
  queryClient.setQueryData(KEY, ROW);
  const Wrapper = ({ children }: { children: React.ReactNode }) => (
    <FrappClientProvider
      client={{ PATCH } as unknown as ReturnType<typeof createFrappClient>}
      chapterId={CHAPTER}
    >
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    </FrappClientProvider>
  );
  const { result } = renderHook(() => useSaveEventLists("evt-1"), {
    wrapper: Wrapper,
  });
  return { result, queryClient };
}

describe("useSaveEventLists (#4934)", () => {
  it("sends the occurrence's own list, with no series scope", async () => {
    const PATCH = vi.fn().mockResolvedValue({ data: ROW, error: undefined });
    const { result } = setup(PATCH);
    const agenda = [{ id: "a1", text: "Treasurer report", done: true }];
    await act(async () => {
      await result.current.mutateAsync({ agenda });
    });
    expect(PATCH).toHaveBeenCalledWith("/v1/events/{id}", {
      params: { path: { id: "evt-1" } },
      body: { agenda },
    });
  });

  it("shows a check-off at once, and puts it back when the save is refused", async () => {
    let refuse!: (value: unknown) => void;
    const PATCH = vi.fn(
      () =>
        new Promise((resolve) => {
          refuse = resolve;
        }),
    );
    const { result, queryClient } = setup(PATCH);
    const agenda = [{ id: "a1", text: "Treasurer report", done: true }];
    let saving!: Promise<unknown>;
    await act(async () => {
      saving = result.current.mutateAsync({ agenda }).catch(() => undefined);
      await Promise.resolve();
    });
    expect(queryClient.getQueryData(KEY)).toEqual({ ...ROW, agenda });
    await act(async () => {
      refuse({ data: undefined, error: { message: "nope" } });
      await saving;
    });
    expect(queryClient.getQueryData(KEY)).toEqual(ROW);
  });
});
