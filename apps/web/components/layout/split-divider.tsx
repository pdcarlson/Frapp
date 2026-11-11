"use client";

import { useRef, useState, type KeyboardEvent, type PointerEvent } from "react";
import {
  CHANNELS_WIDTH,
  clampToolShare,
  PANE_FLOOR,
  toolShareBounds,
} from "@/components/layout/shell-layout";
import { DEFAULT_TOOL_SHARE } from "@/components/layout/shell-prefs";
import { FOCUS_RING_SHELL } from "@/components/ui/focus";
import { cn } from "@/lib/utils";

/** How far one arrow press moves the divider, in pixels. */
const KEY_STEP_PX = 24;

/** The two sides of the divider: chat on the left, the tool page on the right. */
export type SplitSide = "chat" | "page";

/**
 * How close to an edge a drag must reach to close that side: half a pane's
 * floor. The side stops at its 375px floor and the pointer keeps going; past
 * the halfway mark of that floor the side fades, and letting go closes it.
 */
const COLLAPSE_PX = PANE_FLOOR / 2;

/**
 * The divider between chat and the tool page (#3779): drag it, move it with
 * the arrow keys, or double-click it to go back to 50/50. It is the window
 * splitter pattern (WAI-ARIA `separator`, focusable), and its value is the
 * tool page's share in percent.
 *
 * Dragged all the way to an edge, it closes that side (Paul, 2026-11-11, the
 * way VS Code's and Figma's panels snap shut): to the right edge closes the
 * tool page, to the left closes chat. The side stops at its floor and fades
 * once the pointer is past half of it (`COLLAPSE_PX`), so the member sees
 * what letting go will do, and dragging back cancels it. A close keeps the
 * split the member had before the drag.
 *
 * It never lets either side below 375px. CSS holds that floor too
 * (`dashboard-shell.tsx`), so a share saved at a wider window still lays out
 * at a narrower one; this clamps what the member can set so the value it
 * announces is the one on screen.
 */
export function SplitDivider({
  share,
  onChange,
  onCommit,
  rowRef,
  onCollapsePreview,
  onCollapse,
}: {
  share: number;
  /** Every move, while dragging or pressing keys. */
  onChange: (share: number) => void;
  /** The settled value, to remember. */
  onCommit: (share: number) => void;
  /** The row chat and the tool page share, which the share is measured on. */
  rowRef: React.RefObject<HTMLElement | null>;
  /** The side a release would close now, or `null`, as the drag moves. */
  onCollapsePreview?: (side: SplitSide | null) => void;
  /** A drag let go at an edge: close that side. */
  onCollapse?: (side: SplitSide) => void;
}) {
  const [dragging, setDragging] = useState(false);
  // The value a drag last set, so the commit on release is that value even
  // if the parent has not re-rendered with it yet.
  const latest = useRef(share);
  // The share when the drag started, kept if the drag closes a side.
  const start = useRef(share);
  // The side a release would close, if the pointer is at an edge.
  const pending = useRef<SplitSide | null>(null);

  const rowWidth = () => rowRef.current?.getBoundingClientRect().width ?? 0;
  // The range announced to assistive tech, measured when the divider is
  // focused or grabbed (layout is not readable during render).
  const [bounds, setBounds] = useState({ min: 0, max: 1 });
  const measure = () => setBounds(toolShareBounds(rowWidth()));

  /** The side the pointer is close enough to an edge to close, if any. */
  const collapseAt = (clientX: number): SplitSide | null => {
    if (!onCollapse) return null;
    const row = rowRef.current?.getBoundingClientRect();
    if (!row) return null;
    if (row.right - clientX < COLLAPSE_PX) return "page";
    if (clientX - row.left - CHANNELS_WIDTH < COLLAPSE_PX) return "chat";
    return null;
  };

  const setPending = (side: SplitSide | null) => {
    if (pending.current === side) return;
    pending.current = side;
    onCollapsePreview?.(side);
  };

  const shareAt = (clientX: number) => {
    const row = rowRef.current?.getBoundingClientRect();
    if (!row) return latest.current;
    // The tool page is right of the divider: its share is what is left of
    // the row past the pointer, out of the width after the channels column.
    const flexible = row.width - CHANNELS_WIDTH - 1;
    if (flexible <= 0) return latest.current;
    return clampToolShare((row.right - clientX) / flexible, row.width);
  };

  const onPointerDown = (event: PointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) return;
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    measure();
    latest.current = share;
    start.current = share;
    setPending(null);
    setDragging(true);
  };
  const onPointerMove = (event: PointerEvent<HTMLDivElement>) => {
    if (!dragging) return;
    latest.current = shareAt(event.clientX);
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
      // Closing a side is not a new split: put back the one from before.
      onChange(start.current);
      onCollapse?.(side);
      return;
    }
    onCommit(latest.current);
  };

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const width = rowWidth();
    const flexible = Math.max(1, width - CHANNELS_WIDTH - 1);
    const step = KEY_STEP_PX / flexible;
    const { min, max } = toolShareBounds(width);
    let next: number | null = null;
    // Left grows the tool page (the divider moves left), right shrinks it.
    if (event.key === "ArrowLeft") next = share + step;
    else if (event.key === "ArrowRight") next = share - step;
    // The window-splitter pattern: Home to the minimum value, End to the
    // maximum, the value being the page's share.
    else if (event.key === "Home") next = min;
    else if (event.key === "End") next = max;
    else if (event.key === "Enter") next = DEFAULT_TOOL_SHARE;
    if (next === null) return;
    event.preventDefault();
    const clamped = clampToolShare(next, width);
    onChange(clamped);
    onCommit(clamped);
  };

  const reset = () => {
    const clamped = clampToolShare(DEFAULT_TOOL_SHARE, rowWidth());
    onChange(clamped);
    onCommit(clamped);
  };

  const { min, max } = bounds;

  return (
    <div
      role="separator"
      aria-orientation="vertical"
      aria-label="Resize chat and page"
      aria-valuenow={Math.round(share * 100)}
      aria-valuemin={Math.round(min * 100)}
      aria-valuemax={Math.round(max * 100)}
      aria-valuetext={`Page ${Math.round(share * 100)} percent`}
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
