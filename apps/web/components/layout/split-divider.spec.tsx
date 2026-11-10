/** @vitest-environment jsdom */
import { fireEvent, render, screen } from "@testing-library/react";
import { createRef } from "react";
import { describe, expect, it, vi } from "vitest";
import { SplitDivider } from "./split-divider";
import {
  CHANNELS_WIDTH,
  PANE_FLOOR,
  SPLIT_MIN_WIDTH,
  FULL_NAV_SPLIT_WIDTH,
  toolShareBounds,
} from "./shell-layout";
import { parseChatOpen, parseToolShare } from "./shell-prefs";

/** A row of `width` px whose right edge is at `width`. */
function rowOf(width: number) {
  const ref = createRef<HTMLDivElement>();
  const row = document.createElement("div");
  row.getBoundingClientRect = () =>
    ({ width, right: width, left: 0 }) as DOMRect;
  (ref as { current: HTMLDivElement }).current = row;
  return ref;
}

function setup(share = 0.5, width = 1200) {
  const onChange = vi.fn();
  const onCommit = vi.fn();
  render(
    <SplitDivider
      share={share}
      onChange={onChange}
      onCommit={onCommit}
      rowRef={rowOf(width)}
    />,
  );
  return { onChange, onCommit, divider: screen.getByRole("separator") };
}

describe("SplitDivider (#3779)", () => {
  it("is a focusable vertical separator announcing the page's share", () => {
    const { divider } = setup(0.5);
    expect(divider).toHaveAttribute("aria-orientation", "vertical");
    expect(divider).toHaveAttribute("tabindex", "0");
    expect(divider).toHaveAttribute("aria-valuenow", "50");
  });

  it("moves with the arrow keys, and remembers each move", () => {
    const { divider, onChange, onCommit } = setup(0.5);
    fireEvent.keyDown(divider, { key: "ArrowLeft" });
    // Left widens the page beside it.
    expect(onChange.mock.calls[0]![0]).toBeGreaterThan(0.5);
    expect(onCommit).toHaveBeenCalledWith(onChange.mock.calls[0]![0]);
    fireEvent.keyDown(divider, { key: "ArrowRight" });
    expect(onChange.mock.calls[1]![0]).toBeLessThan(0.5);
  });

  it("never lets either side below 375px", () => {
    const width = 1200;
    const { divider, onChange } = setup(0.5, width);
    fireEvent.keyDown(divider, { key: "Home" });
    fireEvent.keyDown(divider, { key: "End" });
    const flexible = width - CHANNELS_WIDTH - 1;
    const [max, min] = [onChange.mock.calls[0]![0], onChange.mock.calls[1]![0]];
    expect(Math.round(flexible * max)).toBeLessThanOrEqual(
      flexible - PANE_FLOOR,
    );
    expect(Math.round(flexible * min)).toBeGreaterThanOrEqual(PANE_FLOOR);
  });

  it("resets to 50/50 on a double-click", () => {
    const { divider, onCommit } = setup(0.7);
    fireEvent.doubleClick(divider);
    expect(onCommit).toHaveBeenCalledWith(0.5);
  });

  it("drags, and commits where the pointer let go", () => {
    const { divider, onChange, onCommit } = setup(0.5, 1200);
    divider.setPointerCapture = () => {};
    divider.hasPointerCapture = () => false;
    fireEvent.pointerDown(divider, { button: 0, pointerId: 1, clientX: 600 });
    fireEvent.pointerMove(divider, { pointerId: 1, clientX: 700 });
    fireEvent.pointerUp(divider, { pointerId: 1, clientX: 700 });
    const moved = onChange.mock.calls[0]![0];
    expect(moved).toBeCloseTo((1200 - 700) / (1200 - 241), 3);
    expect(onCommit).toHaveBeenCalledWith(moved);
  });
});

describe("shell layout constants and cookies (#3779)", () => {
  it("starts side by side only where both floors fit beside the rail, and the full nav only where they fit beside it", () => {
    expect(56 + CHANNELS_WIDTH + 2 * PANE_FLOOR + 3).toBeLessThanOrEqual(
      SPLIT_MIN_WIDTH,
    );
    expect(240 + CHANNELS_WIDTH + 2 * PANE_FLOOR + 3).toBeLessThanOrEqual(
      FULL_NAV_SPLIT_WIDTH,
    );
    // The shell's Tailwind classes spell the breakpoint out literally.
    expect(SPLIT_MIN_WIDTH).toBe(1056);
  });

  it("pins both bounds at 50/50 on a row too narrow for the floors", () => {
    expect(toolShareBounds(800)).toEqual({ min: 0.5, max: 0.5 });
  });

  it("reads chat as open unless closed, and a foreign split as 50/50", () => {
    expect(parseChatOpen(undefined)).toBe(true);
    expect(parseChatOpen("0")).toBe(false);
    expect(parseToolShare(undefined)).toBe(0.5);
    expect(parseToolShare("0.3")).toBe(0.3);
    expect(parseToolShare("7")).toBe(0.5);
    expect(parseToolShare("abc")).toBe(0.5);
  });
});
