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
 * The thread's rows, newest first as the inverted list draws it. A key ending
 * in `*` is the viewer's own message (unconfirmed, or confirmed from any
 * device), and one ending in `~` is drawn with nothing to read (a blocked
 * member's tombstone, or a deleted message).
 */
const rows = (...ids: string[]): LatestRow[] =>
  ids.map((id) => {
    const own = id.endsWith("*");
    const silent = id.endsWith("~");
    return { id: own || silent ? id.slice(0, -1) : id, own, silent };
  });

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
    // Sent on a clock ahead of the server's: drawn newest at its device time.
    const { result, rerender } = setup(rows("own*", "c-2", "c-1"));
    act(() => result.current.onScroll(scroll(FOLLOW_ARRIVALS_WITHIN + 1)));

    // Confirmed, and re-sorted behind c-2 by its server time: nothing new.
    rerender({ rows: rows("c-2", "own*", "c-1"), channelKey: "chan-1" });
    expect(result.current.hasNewBelow).toBe(false);

    // Someone else's message lands in the skew window, below the newest row.
    rerender({
      rows: rows("c-2", "c-3", "own*", "c-1"),
      channelKey: "chan-1",
    });
    expect(result.current.hasNewBelow).toBe(true);
    expect(result.current.showsJump).toBe(true);
  });

  // Queued offline, the reader's message is confirmed after everything
  // backfilled from the outage, so it is newest again under the same key with
  // the backfilled rows below it.
  it("notices rows backfilled beneath the reader's own message when it comes back newest", () => {
    const { result, rerender } = setup(rows("own*", "c-2", "c-1"));
    act(() => result.current.onScroll(scroll(FOLLOW_ARRIVALS_WITHIN + 1)));

    // Confirmed at the server's time, after the backfill, which is why the
    // reader's own message is no measure of what they had seen.
    rerender({
      rows: rows("own*", "b-2", "b-1", "c-2", "c-1"),
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

  // The send's tap takes the reader to the newest message, but they can be
  // back in history before their row is drawn, and again before the server
  // confirms it, under a key they never saw. It is never news to them.
  it("does not count the reader's own message as news, before or after it is confirmed", () => {
    const { result, rerender } = setup(thread(3));
    act(() => result.current.onScroll(scroll(VIEWPORT * 2)));

    // Pending, then confirmed under the same key.
    rerender({ rows: [...rows("mine*"), ...thread(3)], channelKey: "chan-1" });
    expect(result.current.hasNewBelow).toBe(false);
    expect(result.current.showsJump).toBe(true);

    // And someone else's reply after it still says so.
    rerender({
      rows: [...rows("c-4", "mine*"), ...thread(3)],
      channelKey: "chan-1",
    });
    expect(result.current.hasNewBelow).toBe(true);
  });

  // The thread draws a blocked member's message as a tombstone, and a deleted
  // one as a placeholder: nothing to read, so nothing to say arrived.
  it("does not count a row with nothing to read as news", () => {
    const { result, rerender } = setup(thread(3));
    act(() => result.current.onScroll(scroll(VIEWPORT * 2)));

    rerender({
      rows: rows("t-5~", "d-4~", "c-3", "c-2", "c-1"),
      channelKey: "chan-1",
    });
    expect(result.current.hasNewBelow).toBe(false);
  });

  // On reconnect the realtime manager resubscribes before it backfills, so a
  // live message can be on screen, and seen, before the ones posted during
  // the outage are merged in beneath it at their own times. They are real
  // messages the reader hasn't seen.
  it("counts messages backfilled under a newer one the reader already saw", () => {
    // The live row arrives while the reader is at the newest message.
    const { result, rerender } = setup(rows("live", "c-2", "c-1"));
    act(() => result.current.onScroll(scroll(VIEWPORT * 2)));
    expect(result.current.hasNewBelow).toBe(false);

    rerender({
      rows: rows("live", "b-2", "b-1", "c-2", "c-1"),
      channelKey: "chan-1",
    });
    expect(result.current.hasNewBelow).toBe(true);
    expect(result.current.showsJump).toBe(true);
  });

  // A row the thread held (the block list was still loading) is released
  // between rows the reader had already seen. Telling it from a backfilled
  // message would take its age, and an age cutoff hides backfills (above),
  // so it lights the dot: one offer of a jump to the newest, which they can
  // ignore.
  it("counts an older row that comes into view mid-history", () => {
    const { result, rerender } = setup(thread(3));
    act(() => result.current.onScroll(scroll(VIEWPORT * 2)));

    rerender({
      rows: rows("c-3", "c-2", "h-1", "c-1"),
      channelKey: "chan-1",
    });
    expect(result.current.hasNewBelow).toBe(true);
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
