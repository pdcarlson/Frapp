"use client";

import { useRef, useState, type KeyboardEvent, type PointerEvent } from "react";
import {
  chatWidthBounds,
  clampChatWidth,
  PANE_FLOOR,
} from "@/components/layout/shell-layout";
import { DEFAULT_CHAT_WIDTH } from "@/components/layout/shell-prefs";
import { FOCUS_RING_SHELL } from "@/components/ui/focus";
import { cn } from "@/lib/utils";

/** How far one arrow press moves the divider, in pixels. */
const KEY_STEP_PX = 24;

/** The two sides of the divider: the tool page on the left, chat on the right. */
export type SplitSide = "chat" | "page";

/**
 * How close to an edge a drag must reach to close that side: half a pane's
 * floor. The side stops at its 375px floor and the pointer keeps going; past
 * the halfway mark of that floor the side fades, and letting go closes it.
 */
const COLLAPSE_PX = PANE_FLOOR / 2;

/**
 * The divider between the tool page and chat's side panel (#3779, #5575):
 * drag it, move it with the arrow keys, or double-click it to go back to the
 * default width. It is the window splitter pattern (WAI-ARIA `separator`,
 * focusable), and its value is the chat panel's width in pixels, which is
 * what the shell remembers: a side panel keeps its width as the window
 * changes, as Slack's and Linear's do, and the tool page takes the rest.
 *
 * Dragged all the way to an edge, it closes that side (Paul, 2026-11-11, the
 * way VS Code's and Figma's panels snap shut): to the right edge closes chat,
 * to the left closes the tool page. The side stops at its floor and fades
 * once the pointer is past half of it (`COLLAPSE_PX`), so the member sees
 * what letting go will do, and dragging back cancels it. A close keeps the
 * width the member had before the drag.
 *
 * It never lets either side below 375px. CSS holds that floor too
 * (`dashboard-shell.tsx`), so a width saved at a wider window still lays out
 * at a narrower one; this clamps what the member can set so the value it
 * announces is the one on screen.
 */
export function SplitDivider({
  width,
  onChange,
  onCommit,
  rowRef,
  onCollapsePreview,
  onCollapse,
}: {
  /** The chat panel's width, in pixels. */
  width: number;
  /** Every move, while dragging or pressing keys. */
  onChange: (width: number) => void;
  /** The settled value, to remember. */
  onCommit: (width: number) => void;
  /** The row the tool page and chat share, which the width is clamped to. */
  rowRef: React.RefObject<HTMLElement | null>;
  /** The side a release would close now, or `null`, as the drag moves. */
  onCollapsePreview?: (side: SplitSide | null) => void;
  /** A drag let go at an edge: close that side. */
  onCollapse?: (side: SplitSide) => void;
}) {
  const [dragging, setDragging] = useState(false);
  // The value a drag last set, so the commit on release is that value even
  // if the parent has not re-rendered with it yet.
  const latest = useRef(width);
  // The width when the drag started, kept if the drag closes a side.
  const start = useRef(width);
  // The side a release would close, if the pointer is at an edge.
  const pending = useRef<SplitSide | null>(null);

  const rowWidth = () => rowRef.current?.getBoundingClientRect().width ?? 0;
  // The range announced to assistive tech, measured when the divider is
  // focused or grabbed (layout is not readable during render).
  const [bounds, setBounds] = useState({ min: PANE_FLOOR, max: PANE_FLOOR });
  const measure = () => setBounds(chatWidthBounds(rowWidth()));

  /** The side the pointer is close enough to an edge to close, if any. */
  const collapseAt = (clientX: number): SplitSide | null => {
    if (!onCollapse) return null;
    const row = rowRef.current?.getBoundingClientRect();
    if (!row) return null;
    if (row.right - clientX < COLLAPSE_PX) return "chat";
    if (clientX - row.left < COLLAPSE_PX) return "page";
    return null;
  };

  const setPending = (side: SplitSide | null) => {
    if (pending.current === side) return;
    pending.current = side;
    onCollapsePreview?.(side);
  };

  const widthAt = (clientX: number) => {
    const row = rowRef.current?.getBoundingClientRect();
    if (!row) return latest.current;
    // Chat is right of the divider: its width is the row past the pointer.
    return clampChatWidth(row.right - clientX, row.width);
  };

  const onPointerDown = (event: PointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) return;
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    measure();
    latest.current = width;
    start.current = width;
    setPending(null);
    setDragging(true);
  };
  const onPointerMove = (event: PointerEvent<HTMLDivElement>) => {
    if (!dragging) return;
    latest.current = widthAt(event.clientX);
    onChange(latest.current);
    setPending(collapseAt(event.clientX));
  };
  const endDrag = (event: PointerEvent<HTMLDivElement>) => {
    if (!dragging) return;
    setDragging(false);
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    const side = event.type === "pointercancel" ? null : pending.current;
    setPending(null);
    if (side) {
      // Closing a side is not a new width: put back the one from before.
      onChange(start.current);
      onCollapse?.(side);
      return;
    }
    onCommit(latest.current);
  };

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const row = rowWidth();
    const { min, max } = chatWidthBounds(row);
    let next: number | null = null;
    // Left widens chat (the divider moves left), right narrows it.
    if (event.key === "ArrowLeft") next = width + KEY_STEP_PX;
    else if (event.key === "ArrowRight") next = width - KEY_STEP_PX;
    // The window-splitter pattern: Home to the minimum value, End to the
    // maximum, the value being chat's width.
    else if (event.key === "Home") next = min;
    else if (event.key === "End") next = max;
    else if (event.key === "Enter") next = DEFAULT_CHAT_WIDTH;
    if (next === null) return;
    event.preventDefault();
    const clamped = clampChatWidth(next, row);
    onChange(clamped);
    onCommit(clamped);
  };

  const reset = () => {
    const clamped = clampChatWidth(DEFAULT_CHAT_WIDTH, rowWidth());
    onChange(clamped);
    onCommit(clamped);
  };

  const { min, max } = bounds;

  return (
    <div
      role="separator"
      aria-orientation="vertical"
      aria-label="Resize page and chat"
      aria-valuenow={Math.round(width)}
      aria-valuemin={min}
      aria-valuemax={max}
      aria-valuetext={`Chat ${Math.round(width)} pixels wide`}
      tabIndex={0}
      title={
        onCollapse
          ? "Drag to resize, or to an edge to close that side. Double-click to reset."
          : "Drag to resize. Double-click to reset."
      }
      data-split-divider=""
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={endDrag}
      onPointerCancel={endDrag}
      onDoubleClick={reset}
      onFocus={measure}
      onKeyDown={onKeyDown}
      className={cn(
        // 1px hairline, with an 8px grab area centered on it.
        "group relative z-10 -mx-1 w-2 shrink-0 cursor-col-resize touch-none outline-none",
        FOCUS_RING_SHELL,
      )}
    >
      <span
        aria-hidden="true"
        className={cn(
          "pointer-events-none absolute inset-y-0 left-1/2 w-px -translate-x-1/2 bg-border transition-colors",
          "group-hover:w-0.5 group-hover:bg-accent-border group-focus-visible:w-0.5 group-focus-visible:bg-accent-border",
          dragging && "w-0.5 bg-accent-border",
        )}
      />
    </div>
  );
}
