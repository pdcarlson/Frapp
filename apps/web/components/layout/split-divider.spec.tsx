/** @vitest-environment jsdom */
import { fireEvent, render, screen } from "@testing-library/react";
import { createRef } from "react";
import { describe, expect, it, vi } from "vitest";
import { SplitDivider } from "./split-divider";
import {
  PANE_FLOOR,
  SPLIT_MIN_WIDTH,
  chatWidthBounds,
  clampChatWidth,
} from "./shell-layout";
import {
  DEFAULT_CHAT_WIDTH,
  parseChatOpen,
  parseChatWidth,
} from "./shell-prefs";

/** A row of `width` px whose right edge is at `width`. */
function rowOf(width: number) {
  const ref = createRef<HTMLDivElement>();
  const row = document.createElement("div");
  row.getBoundingClientRect = () =>
    ({ width, right: width, left: 0 }) as DOMRect;
  (ref as { current: HTMLDivElement }).current = row;
  return ref;
}

function setup(chatWidth = 400, rowWidth = 1200) {
  const onChange = vi.fn();
  const onCommit = vi.fn();
  render(
    <SplitDivider
      width={chatWidth}
      onChange={onChange}
      onCommit={onCommit}
      rowRef={rowOf(rowWidth)}
    />,
  );
  return { onChange, onCommit, divider: screen.getByRole("separator") };
}

describe("SplitDivider (#3779, chat on the right since #5575)", () => {
  it("is a focusable vertical separator announcing chat's width", () => {
    const { divider } = setup(400);
    expect(divider).toHaveAttribute("aria-orientation", "vertical");
    expect(divider).toHaveAttribute("tabindex", "0");
    expect(divider).toHaveAttribute("aria-valuenow", "400");
    expect(divider).toHaveAttribute("aria-valuetext", "Chat 400 pixels wide");
  });

  it("moves with the arrow keys, and remembers each move", () => {
    const { divider, onChange, onCommit } = setup(400);
    fireEvent.keyDown(divider, { key: "ArrowLeft" });
    // Left widens chat, the panel right of the divider.
    expect(onChange.mock.calls[0]![0]).toBe(424);
    expect(onCommit).toHaveBeenCalledWith(424);
    fireEvent.keyDown(divider, { key: "ArrowRight" });
    expect(onChange.mock.calls[1]![0]).toBe(376);
  });

  it("never lets either side below 375px", () => {
    const row = 1200;
    const { divider, onChange } = setup(400, row);
    fireEvent.keyDown(divider, { key: "Home" });
    fireEvent.keyDown(divider, { key: "End" });
    // Home is chat's narrowest, End its widest (window splitter).
    const [min, max] = [onChange.mock.calls[0]![0], onChange.mock.calls[1]![0]];
    expect(min).toBe(PANE_FLOOR);
    // The page keeps its floor past the divider's 1px.
    expect(row - 1 - max).toBeGreaterThanOrEqual(PANE_FLOOR);
  });

  it("moves from the width on screen when the saved one is wider than the row allows", () => {
    // Saved at 800 on a wide window; this row leaves chat at most 624.
    const { divider, onChange } = setup(800, 1000);
    fireEvent.keyDown(divider, { key: "ArrowRight" });
    expect(onChange.mock.calls[0]![0]).toBe(1000 - 1 - PANE_FLOOR - 24);
  });

  it("resets to the default width on a double-click", () => {
    const { divider, onCommit } = setup(600);
    fireEvent.doubleClick(divider);
    expect(onCommit).toHaveBeenCalledWith(DEFAULT_CHAT_WIDTH);
  });

  it("drags, and commits chat's width where the pointer let go", () => {
    const { divider, onChange, onCommit } = setup(400, 1200);
    divider.setPointerCapture = () => {};
    divider.hasPointerCapture = () => false;
    fireEvent.pointerDown(divider, { button: 0, pointerId: 1, clientX: 800 });
    fireEvent.pointerMove(divider, { pointerId: 1, clientX: 700 });
    fireEvent.pointerUp(divider, { pointerId: 1, clientX: 700 });
    expect(onChange.mock.calls[0]![0]).toBe(500);
    expect(onCommit).toHaveBeenCalledWith(500);
  });

  describe("dragged to an edge, it closes that side (Paul, 2026-11-11)", () => {
    function setupCollapse(chatWidth = 400, rowWidth = 1200) {
      const onChange = vi.fn();
      const onCommit = vi.fn();
      const onCollapse = vi.fn();
      const onCollapsePreview = vi.fn();
      render(
        <SplitDivider
          width={chatWidth}
          onChange={onChange}
          onCommit={onCommit}
          rowRef={rowOf(rowWidth)}
          onCollapse={onCollapse}
          onCollapsePreview={onCollapsePreview}
        />,
      );
      const divider = screen.getByRole("separator");
      divider.setPointerCapture = () => {};
      divider.hasPointerCapture = () => false;
      return { divider, onChange, onCommit, onCollapse, onCollapsePreview };
    }

    it("closes chat when let go at the right edge, keeping the width from before", () => {
      const { divider, onChange, onCommit, onCollapse, onCollapsePreview } =
        setupCollapse(450, 1200);
      fireEvent.pointerDown(divider, { button: 0, pointerId: 1, clientX: 750 });
      // Past chat's floor but not yet half of it: only the floor holds.
      fireEvent.pointerMove(divider, { pointerId: 1, clientX: 1200 - 300 });
      expect(onCollapsePreview).not.toHaveBeenCalledWith("chat");
      // Past half the floor: chat fades to say a release closes it.
      fireEvent.pointerMove(divider, { pointerId: 1, clientX: 1190 });
      expect(onCollapsePreview).toHaveBeenLastCalledWith("chat");
      fireEvent.pointerUp(divider, { pointerId: 1, clientX: 1190 });
      expect(onCollapse).toHaveBeenCalledWith("chat");
      expect(onCollapsePreview).toHaveBeenLastCalledWith(null);
      // The floor-clamped width is not remembered; the one before the drag is.
      expect(onChange).toHaveBeenLastCalledWith(450);
      expect(onCommit).not.toHaveBeenCalled();
    });

    it("closes the page when let go at the left edge", () => {
      const { divider, onCollapse } = setupCollapse(400, 1200);
      fireEvent.pointerDown(divider, { button: 0, pointerId: 1, clientX: 800 });
      fireEvent.pointerMove(divider, { pointerId: 1, clientX: 20 });
      fireEvent.pointerUp(divider, { pointerId: 1, clientX: 20 });
      expect(onCollapse).toHaveBeenCalledWith("page");
    });

    it("cancels when dragged back from the edge before letting go", () => {
      const { divider, onCollapse, onCommit, onCollapsePreview } =
        setupCollapse(400, 1200);
      fireEvent.pointerDown(divider, { button: 0, pointerId: 1, clientX: 800 });
      fireEvent.pointerMove(divider, { pointerId: 1, clientX: 1190 });
      fireEvent.pointerMove(divider, { pointerId: 1, clientX: 700 });
      expect(onCollapsePreview).toHaveBeenLastCalledWith(null);
      fireEvent.pointerUp(divider, { pointerId: 1, clientX: 700 });
      expect(onCollapse).not.toHaveBeenCalled();
      expect(onCommit).toHaveBeenCalled();
    });
  });
});

describe("shell layout constants and cookies (#3779, #5575)", () => {
  it("starts side by side only where both floors fit beside the full nav", () => {
    expect(240 + 2 * PANE_FLOOR + 2).toBeLessThanOrEqual(SPLIT_MIN_WIDTH);
    // The shell's Tailwind classes spell the breakpoint out literally.
    expect(SPLIT_MIN_WIDTH).toBe(1056);
  });

  it("gives the tool page at 1440px the width it has alone at 820px", () => {
    // The full nav and its hairline, the divider, then the default panel.
    const tool = 1440 - 241 - 1 - DEFAULT_CHAT_WIDTH;
    expect(tool).toBeGreaterThanOrEqual(820);
  });

  it("pins chat at its floor on a row too narrow for both floors", () => {
    expect(chatWidthBounds(700)).toEqual({ min: PANE_FLOOR, max: PANE_FLOOR });
    expect(clampChatWidth(900, 1000)).toBe(1000 - 1 - PANE_FLOOR);
  });

  it("reads chat as open unless closed, and a foreign width as the default", () => {
    expect(parseChatOpen(undefined)).toBe(true);
    expect(parseChatOpen("0")).toBe(false);
    expect(parseChatWidth(undefined)).toBe(DEFAULT_CHAT_WIDTH);
    expect(parseChatWidth("480")).toBe(480);
    expect(parseChatWidth("-3")).toBe(DEFAULT_CHAT_WIDTH);
    // An ultrawide window's choice reads back (CSS holds the floors).
    expect(parseChatWidth("4100")).toBe(4100);
    expect(parseChatWidth("abc")).toBe(DEFAULT_CHAT_WIDTH);
  });
});
