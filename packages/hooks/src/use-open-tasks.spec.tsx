/** @vitest-environment jsdom */
import { act, renderHook, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import {
  openTaskKeys,
  useClaimOpenTask,
  useReleaseTask,
  type OpenTask,
} from "./use-open-tasks";
import { taskKeys } from "./use-tasks";
import { createHookWrapper, createTestQueryClient } from "./test-utils";

const CHAPTER = "chapter-1";

function posting(id: string): OpenTask {
  return { id, title: id } as OpenTask;
}

function setup(post: ReturnType<typeof vi.fn>) {
  const queryClient = createTestQueryClient();
  const wrapper = createHookWrapper({
    client: { POST: post },
    queryClient,
    chapterId: CHAPTER,
    displayName: "OpenTasksHookWrapper",
  });
  const listKey = openTaskKeys.list(CHAPTER);
  queryClient.setQueryData(listKey, [posting("a"), posting("b")]);
  queryClient.setQueryData(taskKeys.lists(CHAPTER), []);
  return { queryClient, wrapper, listKey };
}

describe("useClaimOpenTask", () => {
  it("takes the posting off the list on the tap and refreshes the board", async () => {
    let settle: (value: { data: unknown; error: unknown }) => void = () => {};
    const post = vi.fn(
      () =>
        new Promise<{ data: unknown; error: unknown }>((resolve) => {
          settle = resolve;
        }),
    );
    const { queryClient, wrapper, listKey } = setup(post);
    const { result } = renderHook(() => useClaimOpenTask(), { wrapper });

    act(() => result.current.mutate("a"));
    await waitFor(() =>
      expect(queryClient.getQueryData<OpenTask[]>(listKey)).toEqual([
        posting("b"),
      ]),
    );
    expect(post).toHaveBeenCalledWith("/v1/open-tasks/{id}/claim", {
      params: { path: { id: "a" } },
    });

    await act(async () => settle({ data: { id: "task-1" }, error: null }));
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(queryClient.getQueryState(taskKeys.lists(CHAPTER))?.isInvalidated).toBe(
      true,
    );
  });

  it("puts the posting back when someone else claimed it first", async () => {
    const post = vi.fn(async () => ({
      data: null,
      error: { message: "Someone already claimed this" },
    }));
    const { queryClient, wrapper, listKey } = setup(post);
    const { result } = renderHook(() => useClaimOpenTask(), { wrapper });

    act(() => result.current.mutate("a"));
    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(queryClient.getQueryData<OpenTask[]>(listKey)).toEqual([
      posting("a"),
      posting("b"),
    ]);
  });
});

describe("useReleaseTask", () => {
  it("gives the task back and refreshes both lists", async () => {
    const post = vi.fn(async () => ({ data: posting("a"), error: null }));
    const { queryClient, wrapper, listKey } = setup(post);
    const { result } = renderHook(() => useReleaseTask(), { wrapper });

    await act(async () => result.current.mutateAsync("task-1"));
    expect(post).toHaveBeenCalledWith("/v1/tasks/{id}/release", {
      params: { path: { id: "task-1" } },
    });
    expect(queryClient.getQueryState(listKey)?.isInvalidated).toBe(true);
    expect(queryClient.getQueryState(taskKeys.lists(CHAPTER))?.isInvalidated).toBe(
      true,
    );
  });
});
