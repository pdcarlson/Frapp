/** @vitest-environment jsdom */
import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  JUMP_RETRY_MS,
  useJumpToMessage,
  type JumpableList,
} from "./use-jump-to-message";

const rows = (...ids: string[]) => ids.map((id) => ({ message: { id } }));

function fakeList() {
  return {
    scrollToIndex: vi.fn<JumpableList["scrollToIndex"]>(),
    scrollToOffset: vi.fn<JumpableList["scrollToOffset"]>(),
  };
}

function setup(initialRows = rows("a", "b", "c", "d"), resetKey = "chan-1") {
  const list = fakeList();
  const hook = renderHook(
    ({ r, key }: { r: typeof initialRows; key: string }) =>
      useJumpToMessage<JumpableList>(r, key),
    { initialProps: { r: initialRows, key: resetKey } },
  );
  (hook.result.current.listRef as { current: JumpableList | null }).current =
    list;
  return { ...hook, list };
}

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe("useJumpToMessage", () => {
  it("scrolls to the message's row", () => {
    const { result, list } = setup();
    act(() => result.current.jumpToMessage("c"));
    expect(list.scrollToIndex).toHaveBeenCalledWith({
      index: 2,
      animated: true,
      viewPosition: 0.5,
    });
  });

  it("does nothing for a message that isn't a row", () => {
    const { result, list } = setup();
    act(() => result.current.jumpToMessage("zz"));
    expect(list.scrollToIndex).not.toHaveBeenCalled();
  });

  it("retries once, re-finding the message in the rows on screen then", () => {
    const { result, list, rerender } = setup(rows("a", "b", "c", "d"));
    act(() => result.current.jumpToMessage("d"));
    act(() =>
      result.current.onScrollToIndexFailed({ index: 3, averageItemLength: 80 }),
    );
    expect(list.scrollToOffset).toHaveBeenCalledWith({
      offset: 240,
      animated: false,
    });
    // Older rows loaded in front of it meanwhile: the index moved.
    rerender({ r: rows("x", "a", "b", "c", "d"), key: "chan-1" });
    act(() => vi.advanceTimersByTime(JUMP_RETRY_MS));
    expect(list.scrollToIndex).toHaveBeenLastCalledWith({
      index: 4,
      animated: true,
      viewPosition: 0.5,
    });

    // A second failure doesn't loop.
    list.scrollToOffset.mockClear();
    act(() =>
      result.current.onScrollToIndexFailed({ index: 4, averageItemLength: 80 }),
    );
    expect(list.scrollToOffset).not.toHaveBeenCalled();
  });

  it("drops the retry when the message is no longer a row, rather than scrolling past the end", () => {
    const { result, list, rerender } = setup(rows("a", "b", "c", "d"));
    act(() => result.current.jumpToMessage("d"));
    act(() =>
      result.current.onScrollToIndexFailed({ index: 3, averageItemLength: 80 }),
    );
    rerender({ r: rows("a"), key: "chan-1" });
    list.scrollToIndex.mockClear();
    act(() => vi.advanceTimersByTime(JUMP_RETRY_MS));
    expect(list.scrollToIndex).not.toHaveBeenCalled();
  });

  it("cancels a pending retry on a channel switch", () => {
    const { result, list, rerender } = setup(rows("a", "b", "c", "d"));
    act(() => result.current.jumpToMessage("d"));
    act(() =>
      result.current.onScrollToIndexFailed({ index: 3, averageItemLength: 80 }),
    );
    // Same rows, so only the cancel can stop the retry.
    rerender({ r: rows("a", "b", "c", "d"), key: "chan-2" });
    list.scrollToIndex.mockClear();
    act(() => vi.advanceTimersByTime(JUMP_RETRY_MS));
    expect(list.scrollToIndex).not.toHaveBeenCalled();
  });
});
