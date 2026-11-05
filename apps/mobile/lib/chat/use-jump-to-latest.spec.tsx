/** @vitest-environment jsdom */
import { act, renderHook } from "@testing-library/react";
import type {
  LayoutChangeEvent,
  NativeScrollEvent,
  NativeSyntheticEvent,
} from "react-native";
import { describe, expect, it, vi } from "vitest";
import {
  FOLLOW_ARRIVALS_WITHIN,
  useJumpToLatest,
  type LatestScrollableList,
  type NewestRow,
} from "./use-jump-to-latest";

const VIEWPORT = 600;

const layout = (height: number) =>
  ({ nativeEvent: { layout: { height } } }) as LayoutChangeEvent;

/** A scroll to `y` from the newest message (an inverted list's offset). */
const scroll = (y: number) =>
  ({ nativeEvent: { contentOffset: { x: 0, y } } }) as NativeSyntheticEvent<
    NativeScrollEvent
  >;

/** The `n`th message, each a second after the last, as the cache orders them. */
const row = (n: number): NewestRow => ({
  id: `c-${n}`,
  createdAt: `2026-11-05T10:00:${String(n).padStart(2, "0")}.000Z`,
});

function setup(newest: NewestRow | null = row(3), channelKey = "chan-1") {
  const list = { scrollToOffset: vi.fn<LatestScrollableList["scrollToOffset"]>() };
  const listRef = { current: list };
  const hook = renderHook(
    (props: { newest: NewestRow | null; channelKey: string | null }) =>
      useJumpToLatest({ listRef, ...props }),
    { initialProps: { newest, channelKey } },
  );
  act(() => hook.result.current.onLayout(layout(VIEWPORT)));
  return { ...hook, list };
}

describe("useJumpToLatest", () => {
  it("shows the plain control only past one screen of history", () => {
    const { result } = setup();
    expect(result.current.showsJump).toBe(false);

    act(() => result.current.onScroll(scroll(VIEWPORT - 1)));
    expect(result.current.showsJump).toBe(false);

    act(() => result.current.onScroll(scroll(VIEWPORT + 1)));
    expect(result.current.showsJump).toBe(true);
    expect(result.current.hasNewBelow).toBe(false);

    act(() => result.current.onScroll(scroll(40)));
    expect(result.current.showsJump).toBe(false);
  });

  // Between the follow threshold and one screen, the list no longer scrolls an
  // arrival into view, so a reply landing there would be out of sight with
  // nothing to say so.
  it("says so when something lands while the reader is just past the follow threshold", () => {
    const { result, rerender } = setup(row(3));
    act(() => result.current.onScroll(scroll(FOLLOW_ARRIVALS_WITHIN + 1)));
    expect(result.current.showsJump).toBe(false);

    rerender({ newest: row(4), channelKey: "chan-1" });
    expect(result.current.showsJump).toBe(true);
    expect(result.current.hasNewBelow).toBe(true);

    // Reading further back keeps the notice: the arrival is still unseen.
    act(() => result.current.onScroll(scroll(VIEWPORT * 2)));
    expect(result.current.hasNewBelow).toBe(true);

    act(() => result.current.onScroll(scroll(FOLLOW_ARRIVALS_WITHIN)));
    expect(result.current.showsJump).toBe(false);
    expect(result.current.hasNewBelow).toBe(false);
  });

  // Discarding your own failed newest message takes its row out of the cache,
  // so the row before it becomes the newest. Nothing arrived.
  it("lights no dot when the newest row goes away, and still notices a later arrival", () => {
    const { result, rerender } = setup(row(3));
    act(() => result.current.onScroll(scroll(FOLLOW_ARRIVALS_WITHIN + 1)));

    rerender({ newest: row(2), channelKey: "chan-1" });
    expect(result.current.showsJump).toBe(false);
    expect(result.current.hasNewBelow).toBe(false);

    rerender({ newest: row(4), channelKey: "chan-1" });
    expect(result.current.showsJump).toBe(true);
    expect(result.current.hasNewBelow).toBe(true);
  });

  it("counts a newer row that shares the last one's timestamp as an arrival", () => {
    const { result, rerender } = setup(row(3));
    act(() => result.current.onScroll(scroll(FOLLOW_ARRIVALS_WITHIN + 1)));

    rerender({
      newest: { id: "c-3b", createdAt: row(3).createdAt },
      channelKey: "chan-1",
    });
    expect(result.current.hasNewBelow).toBe(true);
  });

  it("says nothing of an arrival within the follow threshold, which scrolls into view", () => {
    const { result, rerender } = setup(row(3));
    act(() => result.current.onScroll(scroll(FOLLOW_ARRIVALS_WITHIN)));

    rerender({ newest: row(4), channelKey: "chan-1" });
    expect(result.current.showsJump).toBe(false);
    expect(result.current.hasNewBelow).toBe(false);
  });

  it("never counts as away before the list has measured itself", () => {
    const list = { scrollToOffset: vi.fn() };
    const { result } = renderHook(() =>
      useJumpToLatest({
        listRef: { current: list },
        newest: row(1),
        channelKey: "chan-1",
      }),
    );
    act(() => result.current.onScroll(scroll(5000)));
    expect(result.current.showsJump).toBe(false);
  });

  it("notices a newer message landing while away, and forgets it on return", () => {
    const { result, rerender } = setup(row(3));
    act(() => result.current.onScroll(scroll(VIEWPORT * 2)));
    expect(result.current.hasNewBelow).toBe(false);

    rerender({ newest: row(4), channelKey: "chan-1" });
    expect(result.current.hasNewBelow).toBe(true);

    act(() => result.current.onScroll(scroll(0)));
    expect(result.current.showsJump).toBe(false);
    expect(result.current.hasNewBelow).toBe(false);

    // Leaving again starts from the message that is newest now.
    act(() => result.current.onScroll(scroll(VIEWPORT * 2)));
    expect(result.current.hasNewBelow).toBe(false);
  });

  it("scrolls to the newest message, animated unless told otherwise", () => {
    const { result, list } = setup();
    act(() => result.current.jumpToLatest());
    expect(list.scrollToOffset).toHaveBeenLastCalledWith({
      offset: 0,
      animated: true,
    });
    act(() => result.current.jumpToLatest({ animated: false }));
    expect(list.scrollToOffset).toHaveBeenLastCalledWith({
      offset: 0,
      animated: false,
    });
  });

  it("clears the control at once on an unanimated jump, so the member's own send lights no dot", () => {
    const { result, rerender } = setup(row(3));
    act(() => result.current.onScroll(scroll(VIEWPORT * 2)));
    expect(result.current.showsJump).toBe(true);

    act(() => result.current.jumpToLatest({ animated: false }));
    rerender({ newest: row(4), channelKey: "chan-1" });
    expect(result.current.showsJump).toBe(false);
    expect(result.current.hasNewBelow).toBe(false);
  });

  it("keeps the control through an animated jump until the scroll arrives", () => {
    const { result } = setup(row(3));
    act(() => result.current.onScroll(scroll(VIEWPORT * 2)));

    act(() => result.current.jumpToLatest());
    expect(result.current.showsJump).toBe(true);
    act(() => result.current.onScroll(scroll(0)));
    expect(result.current.showsJump).toBe(false);
  });

  it("is not away in the next channel because it was in the last", () => {
    const { result, rerender } = setup(row(3), "chan-1");
    act(() => result.current.onScroll(scroll(VIEWPORT * 2)));
    expect(result.current.showsJump).toBe(true);

    rerender({
      newest: { id: "d-9", createdAt: "2026-11-04T09:00:00.000Z" },
      channelKey: "chan-2",
    });
    expect(result.current.showsJump).toBe(false);
    expect(result.current.hasNewBelow).toBe(false);

    // And the next crossing in the new channel still registers.
    act(() => result.current.onScroll(scroll(VIEWPORT * 2)));
    expect(result.current.showsJump).toBe(true);
  });
});
