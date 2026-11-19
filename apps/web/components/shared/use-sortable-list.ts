"use client";

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent,
  type PointerEvent,
} from "react";

/**
 * Drag to reorder a short vertical list (an event's agenda, #5561 follow-up;
 * Paul 2026-11-19: "who thought arrows to move agenda items around was
 * smart?"). The row is picked up by its grip, follows the pointer, and the
 * rows it passes slide out of its way, the way Notion's and Linear's lists
 * and Apple Reminders reorder. Dropping it calls `onMove(from, to)` once.
 *
 * The grip is also the keyboard's way in: focused, the up and down arrows
 * move its row one place, so the list never needs arrow buttons on every row
 * to be reachable without a mouse. Focus follows the moved row (React
 * re-inserts a moved row's node on some moves, which blurs it, as
 * `reorder-list.tsx` found), and each move is announced as "Alpha, 2 of 5"
 * through `announcement`, which the caller puts in a polite live region.
 *
 * No library: a list this short (30 at most) measures its rows once when a
 * drag starts, and every move after that is arithmetic on those rects.
 */
export function useSortableList({
  count,
  onMove,
  disabled = false,
}: {
  count: number;
  onMove: (from: number, to: number) => void;
  disabled?: boolean;
}) {
  const rows = useRef<(HTMLElement | null)[]>([]);
  const session = useRef<{
    from: number;
    startY: number;
    mids: number[];
    shift: number;
    pointerId: number;
    label: string;
  } | null>(null);
  const [drag, setDrag] = useState<{
    from: number;
    to: number;
    dy: number;
    shift: number;
  } | null>(null);

  const rowRef = useCallback(
    (index: number) => (element: HTMLElement | null) => {
      rows.current[index] = element;
    },
    [],
  );

  // The drop target as last drawn, read on release.
  const target = useRef<number | null>(null);
  // The row whose grip takes focus back once the list has redrawn.
  const refocus = useRef<number | null>(null);
  const [announcement, setAnnouncement] = useState("");
  useEffect(() => {
    const index = refocus.current;
    if (index === null) return;
    refocus.current = null;
    rows.current[index]
      ?.querySelector<HTMLElement>("[data-sortable-grip]")
      ?.focus();
  });

  const moveTo = (from: number, to: number, label: string) => {
    onMove(from, to);
    setAnnouncement(`${label}, ${to + 1} of ${count}`);
  };

  const end = (commit: boolean) => {
    const current = session.current;
    const to = target.current;
    session.current = null;
    target.current = null;
    setDrag(null);
    if (commit && current && to !== null && to !== current.from) {
      moveTo(current.from, to, current.label);
    }
  };

  function handleProps(index: number, label: string) {
    return {
      "aria-label": `Reorder ${label}`,
      "aria-keyshortcuts": "ArrowUp ArrowDown",
      title: "Drag to reorder, or use the arrow keys",
      "data-sortable-grip": "",
      disabled,
      onPointerDown: (event: PointerEvent<HTMLElement>) => {
        if (disabled || event.button !== 0) return;
        const rects = rows.current
          .slice(0, count)
          .map((row) => row?.getBoundingClientRect() ?? null);
        const own = rects[index];
        if (!own) return;
        event.preventDefault();
        event.currentTarget.setPointerCapture?.(event.pointerId);
        const next = rects[index + 1] ?? null;
        const prev = rects[index - 1] ?? null;
        const gap = next
          ? next.top - own.bottom
          : prev
            ? own.top - prev.bottom
            : 0;
        session.current = {
          from: index,
          startY: event.clientY,
          mids: rects.map((rect) => (rect ? rect.top + rect.height / 2 : 0)),
          shift: own.height + Math.max(0, gap),
          pointerId: event.pointerId,
          label,
        };
        target.current = index;
        setDrag({
          from: index,
          to: index,
          dy: 0,
          shift: own.height + Math.max(0, gap),
        });
      },
      onPointerMove: (event: PointerEvent<HTMLElement>) => {
        const current = session.current;
        if (!current || event.pointerId !== current.pointerId) return;
        const dy = event.clientY - current.startY;
        const centre = (current.mids[current.from] ?? 0) + dy;
        let to = current.from;
        current.mids.forEach((mid, i) => {
          if (i > current.from && centre > mid) to = Math.max(to, i);
          if (i < current.from && centre < mid) to = Math.min(to, i);
        });
        target.current = to;
        setDrag({ from: current.from, to, dy, shift: current.shift });
      },
      onPointerUp: () => end(true),
      onPointerCancel: () => end(false),
      onLostPointerCapture: () => {
        if (session.current) end(true);
      },
      onKeyDown: (event: KeyboardEvent<HTMLElement>) => {
        if (disabled) return;
        if (event.key === "ArrowUp" && index > 0) {
          event.preventDefault();
          refocus.current = index - 1;
          moveTo(index, index - 1, label);
        } else if (event.key === "ArrowDown" && index < count - 1) {
          event.preventDefault();
          refocus.current = index + 1;
          moveTo(index, index + 1, label);
        } else if (event.key === "Escape" && session.current) {
          end(false);
        }
      },
    };
  }

  /** Where row `index` draws while a drag is under way. */
  function rowStyle(index: number): CSSProperties | undefined {
    if (!drag) return undefined;
    if (index === drag.from) {
      return {
        transform: `translateY(${drag.dy}px)`,
        position: "relative",
        zIndex: 10,
      };
    }
    let offset = 0;
    if (drag.to > drag.from && index > drag.from && index <= drag.to) {
      offset = -drag.shift;
    } else if (drag.to < drag.from && index < drag.from && index >= drag.to) {
      offset = drag.shift;
    }
    return {
      transform: offset ? `translateY(${offset}px)` : undefined,
      transition: "transform 150ms ease",
    };
  }

  return {
    rowRef,
    handleProps,
    rowStyle,
    /** The index being dragged, or `null`. */
    dragging: drag?.from ?? null,
    /** The last move, said for a screen reader ("Alpha, 2 of 5"). */
    announcement,
  };
}
