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
  type LatestRow,
  type LatestScrollableList,
} from "./use-jump-to-latest";

const VIEWPORT = 600;

const layout = (height: number) =>
  ({ nativeEvent: { layout: { height } } }) as LayoutChangeEvent;

/** A scroll to `y` from the newest message (an inverted list's offset). */
const scroll = (y: number) =>
  ({ nativeEvent: { contentOffset: { x: 0, y } } }) as NativeSyntheticEvent<
    NativeScrollEvent
  >;

/**
 * The thread's rows, newest first as the inverted list draws them. A key
 * ending in `*` is the viewer's own send that the server has not confirmed.
 */
const rows = (...ids: string[]): LatestRow[] =>
  ids.map((id) =>
    id.endsWith("*")
      ? { id: id.slice(0, -1), local: true }
      : { id, local: false },
  );

/** Messages 1..n, newest first. */
const thread = (n: number) =>
  rows(...Array.from({ length: n }, (_, index) => `c-${n - index}`));

function setup(initial: LatestRow[] = thread(3), channelKey = "chan-1") {
  const list = { scrollToOffset: vi.fn<LatestScrollableList["scrollToOffset"]>() };
  const listRef = { current: list };
  const hook = renderHook(
    (props: { rows: LatestRow[]; channelKey: string | null }) =>
      useJumpToLatest({ listRef, ...props }),
    { initialProps: { rows: initial, channelKey } },
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
    const { result, rerender } = setup(thread(3));
    act(() => result.current.onScroll(scroll(FOLLOW_ARRIVALS_WITHIN + 1)));
    expect(result.current.showsJump).toBe(false);

    rerender({ rows: thread(4), channelKey: "chan-1" });
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
    const { result, rerender } = setup(thread(3));
    act(() => result.current.onScroll(scroll(FOLLOW_ARRIVALS_WITHIN + 1)));

    rerender({ rows: thread(2), channelKey: "chan-1" });
    expect(result.current.showsJump).toBe(false);
    expect(result.current.hasNewBelow).toBe(false);

    rerender({ rows: thread(4), channelKey: "chan-1" });
    expect(result.current.showsJump).toBe(true);
    expect(result.current.hasNewBelow).toBe(true);
  });

  // The viewer's own message is re-sorted by the server's `created_at` when
  // it is confirmed. With their clock ahead of the server's, a later message
  // from someone else can then sit below the newest row, and neither the
  // newest row nor the timestamp they left at says anything arrived.
  it("notices an arrival behind the newest row after the reader's own message re-sorts", () => {
    const { result, rerender } = setup(rows("own*", "c-2", "c-1"));
    act(() => result.current.onScroll(scroll(FOLLOW_ARRIVALS_WITHIN + 1)));

    // Confirmed, and re-sorted behind c-2 by its server time: nothing new.
    rerender({ rows: rows("c-2", "own", "c-1"), channelKey: "chan-1" });
    expect(result.current.hasNewBelow).toBe(false);

    // Someone else's message lands in the skew window, below the newest row.
    rerender({ rows: rows("c-2", "c-3", "own", "c-1"), channelKey: "chan-1" });
    expect(result.current.hasNewBelow).toBe(true);
    expect(result.current.showsJump).toBe(true);
  });

  // Queued offline, the reader's message is confirmed after everything
  // backfilled from the outage, so it is newest again under the same key with
  // the backfilled rows below it.
  it("notices rows backfilled beneath the reader's own message when it comes back newest", () => {
    const { result, rerender } = setup(rows("own*", "c-2", "c-1"));
    act(() => result.current.onScroll(scroll(FOLLOW_ARRIVALS_WITHIN + 1)));

    rerender({
      rows: rows("own", "b-2", "b-1", "c-2", "c-1"),
      channelKey: "chan-1",
    });
    expect(result.current.hasNewBelow).toBe(true);
    expect(result.current.showsJump).toBe(true);
  });

  it("does not count an older page as news", () => {
    const { result, rerender } = setup(thread(3));
    act(() => result.current.onScroll(scroll(VIEWPORT * 2)));

    rerender({
      rows: rows("c-3", "c-2", "c-1", "o-2", "o-1"),
      channelKey: "chan-1",
    });
    expect(result.current.hasNewBelow).toBe(false);
  });

  // Its row lands a moment before the send that queued it takes the reader to
  // the newest message; the dot must not flash in between.
  it("does not count the reader's own unconfirmed send as news", () => {
    const { result, rerender } = setup(thread(3));
    act(() => result.current.onScroll(scroll(VIEWPORT * 2)));

    rerender({
      rows: rows("mine*", "c-3", "c-2", "c-1"),
      channelKey: "chan-1",
    });
    expect(result.current.hasNewBelow).toBe(false);
  });

  it("says nothing of an arrival within the follow threshold, which scrolls into view", () => {
    const { result, rerender } = setup(thread(3));
    act(() => result.current.onScroll(scroll(FOLLOW_ARRIVALS_WITHIN)));

    rerender({ rows: thread(4), channelKey: "chan-1" });
    expect(result.current.showsJump).toBe(false);
    expect(result.current.hasNewBelow).toBe(false);
  });

  it("never counts as away before the list has measured itself", () => {
    const list = { scrollToOffset: vi.fn() };
    const { result } = renderHook(() =>
      useJumpToLatest({
        listRef: { current: list },
        rows: thread(1),
        channelKey: "chan-1",
      }),
    );
    act(() => result.current.onScroll(scroll(5000)));
    expect(result.current.showsJump).toBe(false);
  });

  it("notices a newer message landing while away, and forgets it on return", () => {
    const { result, rerender } = setup(thread(3));
    act(() => result.current.onScroll(scroll(VIEWPORT * 2)));
    expect(result.current.hasNewBelow).toBe(false);

    rerender({ rows: thread(4), channelKey: "chan-1" });
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
    const { result, rerender } = setup(thread(3));
    act(() => result.current.onScroll(scroll(VIEWPORT * 2)));
    expect(result.current.showsJump).toBe(true);

    act(() => result.current.jumpToLatest({ animated: false }));
    rerender({ rows: thread(4), channelKey: "chan-1" });
    expect(result.current.showsJump).toBe(false);
    expect(result.current.hasNewBelow).toBe(false);
  });

  it("keeps the control through an animated jump until the scroll arrives", () => {
    const { result } = setup(thread(3));
    act(() => result.current.onScroll(scroll(VIEWPORT * 2)));

    act(() => result.current.jumpToLatest());
    expect(result.current.showsJump).toBe(true);
    act(() => result.current.onScroll(scroll(0)));
    expect(result.current.showsJump).toBe(false);
  });

  it("is not away in the next channel because it was in the last", () => {
    const { result, rerender } = setup(thread(3), "chan-1");
    act(() => result.current.onScroll(scroll(VIEWPORT * 2)));
    expect(result.current.showsJump).toBe(true);

    rerender({ rows: rows("d-9"), channelKey: "chan-2" });
    expect(result.current.showsJump).toBe(false);
    expect(result.current.hasNewBelow).toBe(false);

    // And the next crossing in the new channel still registers.
    act(() => result.current.onScroll(scroll(VIEWPORT * 2)));
    expect(result.current.showsJump).toBe(true);
  });
});
