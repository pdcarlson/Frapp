import { act, renderHook, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import React from "react";
import type { Activity } from "./activity-rows";
import { activityKeys } from "./use-activity";
import {
  useClearActivityLinkState,
  useSetActivityLinkState,
} from "./use-activity-links";
import { FrappClientProvider } from "./use-frapp-client";

const KEY = activityKeys.chapter("chapter-1");

const link = (id: string) => ({
  id,
  url: `https://forms.gle/${id}`,
  host: "forms.gle",
  message_id: `m-${id}`,
  thread_root_id: null,
  channel_id: "c1",
  channel_name: "rush",
  channel_type: "PUBLIC",
  posted_by: "olive",
  posted_by_name: "Olive",
  posted_at: "2026-11-10T15:00:00.000Z",
});

const read = (ids: string[]) =>
  ({
    needs_you: {
      tasks: [],
      task_confirmations: [],
      hours_approvals: [],
      polls: [],
    },
    coming_up: [],
    links: ids.map(link),
    made_by_you: { polls: [], tasks: [], files: [], events: [] },
    needs_you_count: 0,
    unavailable: [],
  }) as unknown as Activity;

const linkIds = (client: QueryClient) =>
  client.getQueryData<Activity>(KEY)?.links.map((row) => row.id);

/** A write the test answers by hand, one per call, in any order. */
function deferredWrites() {
  const pending: { resolve: () => void; reject: (e: unknown) => void }[] = [];
  const call = vi.fn(
    () =>
      new Promise<{ error?: unknown }>((resolve) =>
        pending.push({
          resolve: () => resolve({}),
          reject: (error) => resolve({ error }),
        }),
      ),
  );
  return { call, pending };
}

function setup(write: ReturnType<typeof vi.fn>) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  queryClient.setQueryData(KEY, read(["a", "b", "c"]));
  const invalidate = vi.spyOn(queryClient, "invalidateQueries");
  const client = { PUT: write, DELETE: write };
  const wrapper = ({ children }: { children: React.ReactNode }) => (
    <FrappClientProvider
      client={
        client as unknown as ReturnType<
          typeof import("@repo/api-sdk").createFrappClient
        >
      }
      chapterId="chapter-1"
    >
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    </FrappClientProvider>
  );
  return { queryClient, invalidate, wrapper };
}

describe("link writes (#3897)", () => {
  it("takes the row off at once and re-reads Activity when the write lands", async () => {
    const { call, pending } = deferredWrites();
    const { queryClient, invalidate, wrapper } = setup(call);
    const { result } = renderHook(() => useSetActivityLinkState("done"), {
      wrapper,
    });

    let done!: Promise<unknown>;
    act(() => {
      done = result.current.mutateAsync("b");
    });
    await waitFor(() => expect(linkIds(queryClient)).toEqual(["a", "c"]));
    expect(call).toHaveBeenCalledWith("/v1/activity/links/{id}/state", {
      params: { path: { id: "b" } },
      body: { state: "done" },
    });
    expect(invalidate).not.toHaveBeenCalled();

    await act(async () => {
      pending[0]!.resolve();
      await done;
    });
    expect(invalidate).toHaveBeenCalledWith({ queryKey: KEY, exact: true });
  });

  it("puts the row back where it was when the write fails", async () => {
    const { call, pending } = deferredWrites();
    const { queryClient, wrapper } = setup(call);
    const { result } = renderHook(() => useSetActivityLinkState("hidden"), {
      wrapper,
    });

    let hidden!: Promise<unknown>;
    act(() => {
      hidden = result.current.mutateAsync("b");
    });
    await waitFor(() => expect(linkIds(queryClient)).toEqual(["a", "c"]));
    await act(async () => {
      pending[0]!.reject(new Error("nope"));
      await hidden.catch(() => {});
    });
    expect(linkIds(queryClient)).toEqual(["a", "b", "c"]);
  });

  it("answers each of two quick writes, and re-reads only after the last", async () => {
    const { call, pending } = deferredWrites();
    const { invalidate, wrapper } = setup(call);
    const { result } = renderHook(() => useSetActivityLinkState("done"), {
      wrapper,
    });

    const answered: string[] = [];
    let first!: Promise<unknown>;
    let second!: Promise<unknown>;
    act(() => {
      first = result.current.mutateAsync("a").then(() => answered.push("a"));
    });
    await waitFor(() => expect(call).toHaveBeenCalledTimes(1));
    act(() => {
      second = result.current.mutateAsync("b").then(() => answered.push("b"));
    });
    await waitFor(() => expect(call).toHaveBeenCalledTimes(2));

    // The second lands first: a re-read now would bring "a" back.
    await act(async () => {
      pending[1]!.resolve();
      await second;
    });
    expect(invalidate).not.toHaveBeenCalled();

    await act(async () => {
      pending[0]!.resolve();
      await first;
    });
    expect(answered).toEqual(["b", "a"]);
    await waitFor(() => expect(invalidate).toHaveBeenCalledTimes(1));
  });

  it("waits for the re-read to bring an undone link back, rather than guessing its fields", async () => {
    const { call, pending } = deferredWrites();
    const { queryClient, invalidate, wrapper } = setup(call);
    queryClient.setQueryData(KEY, read(["a"]));
    const { result } = renderHook(() => useClearActivityLinkState(), {
      wrapper,
    });

    let cleared!: Promise<unknown>;
    act(() => {
      cleared = result.current.mutateAsync("b");
    });
    await waitFor(() => expect(call).toHaveBeenCalledTimes(1));
    expect(linkIds(queryClient)).toEqual(["a"]);
    await act(async () => {
      pending[0]!.resolve();
      await cleared;
    });
    expect(invalidate).toHaveBeenCalledWith({ queryKey: KEY, exact: true });
  });
});
