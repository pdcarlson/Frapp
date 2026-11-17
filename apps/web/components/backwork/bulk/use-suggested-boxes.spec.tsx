import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Prepared, Submission } from "@/lib/backwork-bulk/session";
import type { QueueItem } from "@/lib/bulk-upload/queue";

const state = vi.hoisted(() => ({
  roster: {
    data: undefined as Array<{ display_name: string | null }> | undefined,
    isPending: true,
    fetchStatus: "fetching" as "fetching" | "idle" | "paused",
  },
  search: vi.fn(),
}));

vi.mock("@repo/hooks", () => ({ useChapterRoster: () => state.roster }));
vi.mock("@/lib/backwork-bulk/pdf", () => ({ suggestDocumentBoxes: state.search }));

import { useSuggestedBoxes } from "./use-suggested-boxes";

const BOX = { x: 1, y: 2, width: 3, height: 4 };

function item(id: string): QueueItem<Prepared, Submission> {
  return {
    id,
    file: new File([], `${id}.pdf`),
    status: "ready",
    prepared: { doc: { id } } as unknown as Prepared,
  } as QueueItem<Prepared, Submission>;
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

beforeEach(() => {
  state.roster = { data: [{ display_name: "Jordan Ellis" }, { display_name: null }], isPending: false, fetchStatus: "idle" };
  state.search.mockReset();
});

describe("useSuggestedBoxes", () => {
  it("is null while the search runs, then gives that document's boxes, searched with the roster's names", async () => {
    const run = deferred<{ boxes: Record<number, typeof BOX[]>; textLength: number }>();
    state.search.mockReturnValue(run.promise);
    const a = item("a");
    const { result } = renderHook(() => useSuggestedBoxes(a));
    expect(result.current).toBeNull();
    await waitFor(() => expect(state.search).toHaveBeenCalled());
    expect(state.search.mock.calls[0]![1]).toEqual(["Jordan Ellis"]);
    await act(async () => run.resolve({ boxes: { 1: [BOX] }, textLength: 500 }));
    expect(result.current).toEqual({ id: "a", boxes: { 1: [BOX] }, textLength: 500 });
  });

  it("waits for a roster still loading, and doesn't wait for one that failed or is offline", async () => {
    state.search.mockResolvedValue({ boxes: {}, textLength: 500 });
    state.roster = { data: undefined, isPending: true, fetchStatus: "fetching" };
    const { rerender } = renderHook(({ doc }) => useSuggestedBoxes(doc), { initialProps: { doc: item("b") } });
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(state.search).not.toHaveBeenCalled();

    state.roster = { data: undefined, isPending: true, fetchStatus: "paused" };
    rerender({ doc: item("c") });
    await waitFor(() => expect(state.search).toHaveBeenCalledTimes(1));
    expect(state.search.mock.calls[0]![1]).toEqual([]);
  });

  it("stops the search when its document leaves the editor, and never shows its boxes on the next one", async () => {
    const first = deferred<{ boxes: Record<number, typeof BOX[]>; textLength: number }>();
    const second = deferred<{ boxes: Record<number, typeof BOX[]>; textLength: number }>();
    state.search.mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise);
    const { result, rerender } = renderHook(({ doc }) => useSuggestedBoxes(doc), {
      initialProps: { doc: item("d") },
    });
    await waitFor(() => expect(state.search).toHaveBeenCalledTimes(1));
    const signal = state.search.mock.calls[0]![2] as AbortSignal;

    rerender({ doc: item("e") });
    await waitFor(() => expect(state.search).toHaveBeenCalledTimes(2));
    expect(signal.aborted).toBe(true);
    await act(async () => first.resolve({ boxes: { 1: [BOX] }, textLength: 500 }));
    expect(result.current).toBeNull();
    await act(async () => second.resolve({ boxes: {}, textLength: 0 }));
    expect(result.current).toEqual({ id: "e", boxes: {}, textLength: 0 });
  });

  it("says the file couldn't be searched when the search fails", async () => {
    state.search.mockRejectedValue(new Error("bad pdf"));
    const { result } = renderHook(() => useSuggestedBoxes(item("f")));
    await waitFor(() => expect(result.current).toEqual({ id: "f", boxes: {}, textLength: -1 }));
  });
});
