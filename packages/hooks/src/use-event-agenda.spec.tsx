/** @vitest-environment jsdom */
import { QueryClient } from "@tanstack/react-query";
import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  EVENT_LISTS_SAVE_DELAY_MS,
  useEventListsEditor,
  type EventLists,
} from "./use-event-agenda";
import { createHookWrapper } from "./test-utils";

/**
 * One meeting's agenda and attachments editor (#4934): changes show at once,
 * coalesce into one save after a pause, never overlap, and a refused save
 * goes back to the server's lists.
 */

const CHAPTER = "ch-1";
const SERVER: EventLists = {
  agenda: [
    { id: "a", text: "A", done: false },
    { id: "b", text: "B", done: false },
  ],
  attachments: [],
};

function setup(PATCH: ReturnType<typeof vi.fn>, onFailed = vi.fn()) {
  const queryClient = new QueryClient();
  queryClient.setQueryData(["events", CHAPTER, "evt-1"], {
    id: "evt-1",
    ...SERVER,
  });
  const Wrapper = createHookWrapper({
    client: { PATCH },
    queryClient,
    chapterId: CHAPTER,
  });
  const view = renderHook(
    () => useEventListsEditor("evt-1", SERVER, { onFailed }),
    { wrapper: Wrapper },
  );
  return { ...view, queryClient, onFailed };
}

const check = (id: string) => (items: EventLists["agenda"]) =>
  items.map((item) => (item.id === id ? { ...item, done: true } : item));

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe("useEventListsEditor (#4934)", () => {
  it("shows a change at once and sends a run of them as one save", async () => {
    const PATCH = vi.fn().mockResolvedValue({ data: {}, error: undefined });
    const { result } = setup(PATCH);
    act(() => {
      result.current.change("agenda", check("a"));
      result.current.change("agenda", check("b"));
    });
    expect(result.current.agenda.every((item) => item.done)).toBe(true);
    expect(PATCH).not.toHaveBeenCalled();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(EVENT_LISTS_SAVE_DELAY_MS);
    });
    expect(PATCH).toHaveBeenCalledTimes(1);
    expect(PATCH).toHaveBeenCalledWith("/v1/events/{id}", {
      params: { path: { id: "evt-1" } },
      body: {
        agenda: [
          { id: "a", text: "A", done: true },
          { id: "b", text: "B", done: true },
        ],
      },
    });
  });

  it("never overlaps saves, and the next carries every change since", async () => {
    let answer!: (value: unknown) => void;
    const PATCH = vi
      .fn()
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            answer = resolve;
          }),
      )
      .mockResolvedValue({ data: {}, error: undefined });
    const { result } = setup(PATCH);
    act(() => result.current.change("agenda", check("a")));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(EVENT_LISTS_SAVE_DELAY_MS);
    });
    // B is checked while A's save is still out.
    act(() => result.current.change("agenda", check("b")));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(EVENT_LISTS_SAVE_DELAY_MS);
    });
    expect(PATCH).toHaveBeenCalledTimes(1);
    await act(async () => {
      answer({ data: {}, error: undefined });
      await vi.runAllTimersAsync();
    });
    expect(PATCH).toHaveBeenCalledTimes(2);
    expect(PATCH.mock.calls[1]?.[1].body.agenda).toEqual([
      { id: "a", text: "A", done: true },
      { id: "b", text: "B", done: true },
    ]);
  });

  it("goes back to the server's lists when a save is refused, and says so", async () => {
    const PATCH = vi
      .fn()
      .mockResolvedValue({ data: undefined, error: { message: "nope" } });
    const { result, onFailed } = setup(PATCH);
    act(() => result.current.change("agenda", check("a")));
    expect(result.current.agenda[0]?.done).toBe(true);
    await act(async () => {
      await vi.runAllTimersAsync();
    });
    expect(onFailed).toHaveBeenCalledTimes(1);
    expect(result.current.agenda).toEqual(SERVER.agenda);
    // Nothing retries it.
    await act(async () => {
      await vi.runAllTimersAsync();
    });
    expect(PATCH).toHaveBeenCalledTimes(1);
  });

  it("writes the save into the event's read and refetches only it and the list", async () => {
    const PATCH = vi.fn().mockResolvedValue({ data: {}, error: undefined });
    const { result, queryClient } = setup(PATCH);
    queryClient.setQueryData(["events", CHAPTER, "other"], { id: "other" });
    const invalidate = vi.spyOn(queryClient, "invalidateQueries");
    act(() => result.current.change("agenda", check("a")));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(EVENT_LISTS_SAVE_DELAY_MS + 50);
    });
    expect(
      (queryClient.getQueryData(["events", CHAPTER, "evt-1"]) as EventLists)
        .agenda[0]?.done,
    ).toBe(true);
    expect(invalidate.mock.calls.map(([filters]) => filters)).toEqual([
      { queryKey: ["events", CHAPTER, "evt-1"], exact: true },
      { queryKey: ["events", CHAPTER], exact: true },
    ]);
  });

  it("sends a change still waiting when the editor goes away", async () => {
    const PATCH = vi.fn().mockResolvedValue({ data: {}, error: undefined });
    const { result, unmount } = setup(PATCH);
    act(() => result.current.change("agenda", check("a")));
    unmount();
    await act(async () => {
      await Promise.resolve();
    });
    expect(PATCH).toHaveBeenCalledTimes(1);
  });
});
