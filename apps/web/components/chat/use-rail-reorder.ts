"use client";

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type PointerEvent as ReactPointerEvent,
} from "react";

/**
 * Drag to reorder the chat rail (owner, 2026-11-11, #4178): an officer drags a
 * channel row within its section or into another category, or drags a
 * category's heading to move the whole category, the way Discord's server
 * sidebar works. `spec/behavior/chat/README.md` § Sidebar arrangement.
 *
 * Pointer events, not HTML drag and drop. The row's hit target is a
 * `<button>`, and Firefox starts no HTML drag from inside a button
 * (`components/shared/reorder-list.tsx` met the same wall and moved its grip
 * off one). Pointer events also let one gesture cross sections, and keep the
 * row a plain click until the pointer has travelled `DRAG_START_PX`, so a
 * click that wobbles a pixel still opens the channel.
 *
 * Mouse and pen only. A finger on the rail scrolls it, and a long press opens
 * the row menu; the phone app has no drag yet.
 *
 * The rail marks what can be dragged and dropped on with data attributes, and
 * this hook reads them under the pointer:
 *
 * - `data-reorder-row="<channel id>"` with `data-reorder-section="<key>"` on a
 *   row in an orderable section (the default Channels group or a category;
 *   never Pinned, Direct messages or System).
 * - `data-reorder-header="<key>"` on an orderable section's heading, where a
 *   dropped channel lands first.
 * - `data-reorder-category="<category id>"` on a category's whole block, for a
 *   dragged category.
 * - `data-reorder-none` on a section nothing can be dropped in, and
 *   `data-reorder-rail` on the whole rail. Between targets on the rail the
 *   last target holds; over a `data-reorder-none` section or off the rail
 *   there is none.
 *
 * Keyboard: with a row or a category heading focused, Alt+Up and Alt+Down move
 * it one place within its list. The rail does that through `onKeyMove`.
 */

/** How far the pointer travels before a press becomes a drag. */
const DRAG_START_PX = 5;

export type RailDrag =
  | { kind: "channel"; id: string; section: string }
  | { kind: "category"; id: string };

export type RailDrop =
  /** Before or after a row of an orderable section. */
  | { kind: "row"; section: string; id: string; after: boolean }
  /** On a section's heading: first in that section. */
  | { kind: "header"; section: string }
  /** Before or after a category's block. */
  | { kind: "category"; id: string; after: boolean };

interface Pending {
  drag: RailDrag;
  x: number;
  y: number;
  pointerId: number;
}

/** What is under the pointer for this drag, or `undefined` when nothing is. */
function dropAt(drag: RailDrag, el: Element, y: number): RailDrop | undefined {
  if (drag.kind === "category") {
    const block = el.closest<HTMLElement>("[data-reorder-category]");
    const id = block?.dataset.reorderCategory;
    if (!block || !id) return undefined;
    // Before or after by the heading's middle, not the block's: a long
    // category's block reaches far below its heading, and "drop above it"
    // should mean above the heading the officer is looking at.
    const header =
      block.querySelector<HTMLElement>("[data-reorder-header]") ?? block;
    const rect = header.getBoundingClientRect();
    return { kind: "category", id, after: y > rect.top + rect.height / 2 };
  }
  const row = el.closest<HTMLElement>("[data-reorder-row]");
  if (row) {
    const id = row.dataset.reorderRow;
    const section = row.dataset.reorderSection;
    if (!id || !section) return undefined;
    const rect = row.getBoundingClientRect();
    return {
      kind: "row",
      section,
      id,
      after: y > rect.top + rect.height / 2,
    };
  }
  const header = el.closest<HTMLElement>("[data-reorder-header]");
  const section = header?.dataset.reorderHeader;
  if (section) return { kind: "header", section };
  return undefined;
}

function isNoop(drag: RailDrag, drop: RailDrop): boolean {
  if (drag.kind === "channel") {
    return drop.kind === "row" && drop.id === drag.id;
  }
  return drop.kind === "category" && drop.id === drag.id;
}

export interface RailReorder {
  /** What is being dragged, while a drag is on. */
  dragging: RailDrag | null;
  /** Where it would land if released now. */
  drop: RailDrop | null;
  /** Spread on a draggable row or heading. */
  pointerDownFor: (
    drag: RailDrag,
  ) => (event: ReactPointerEvent<HTMLElement>) => void;
  /** Spread on the focusable control of a draggable row or heading. */
  keyDownFor: (
    drag: RailDrag,
  ) => (event: ReactKeyboardEvent<HTMLElement>) => void;
}

export function useRailReorder({
  enabled,
  onDrop,
  onKeyMove,
}: {
  enabled: boolean;
  /** A drag ended over a target. The caller decides whether it moved anything. */
  onDrop: (drag: RailDrag, drop: RailDrop) => void;
  /** Alt+Up (`-1`) or Alt+Down (`1`) on a focused row or heading. */
  onKeyMove: (drag: RailDrag, step: -1 | 1) => void;
}): RailReorder {
  const [dragging, setDragging] = useState<RailDrag | null>(null);
  const [drop, setDrop] = useState<RailDrop | null>(null);
  const pending = useRef<Pending | null>(null);
  const dropRef = useRef<RailDrop | null>(null);
  const started = useRef(false);
  const detach = useRef<(() => void) | null>(null);
  // The callbacks change every render; the window listeners and key handlers
  // read the latest through these, refreshed after each render.
  const onDropRef = useRef(onDrop);
  const onKeyMoveRef = useRef(onKeyMove);
  useEffect(() => {
    onDropRef.current = onDrop;
    onKeyMoveRef.current = onKeyMove;
  });

  const end = useCallback(() => {
    detach.current?.();
    detach.current = null;
    pending.current = null;
    dropRef.current = null;
    if (started.current) {
      started.current = false;
      document.body.style.removeProperty("cursor");
      document.body.style.removeProperty("user-select");
    }
    setDragging(null);
    setDrop(null);
  }, []);

  // A drag in flight when the rail unmounts, or loses the permission, ends:
  // the cleanup runs on either.
  useEffect(() => end, [enabled, end]);

  const pointerDownFor = useCallback(
    (drag: RailDrag) => (event: ReactPointerEvent<HTMLElement>) => {
      if (!enabled || event.button !== 0 || event.pointerType === "touch") {
        return;
      }
      if (event.ctrlKey || event.metaKey || event.shiftKey || event.altKey) {
        return;
      }
      end();
      pending.current = {
        drag,
        x: event.clientX,
        y: event.clientY,
        pointerId: event.pointerId,
      };

      const onMove = (move: PointerEvent) => {
        const press = pending.current;
        if (!press || move.pointerId !== press.pointerId) return;
        if (!started.current) {
          const dx = move.clientX - press.x;
          const dy = move.clientY - press.y;
          if (Math.hypot(dx, dy) < DRAG_START_PX) return;
          started.current = true;
          document.body.style.cursor = "grabbing";
          document.body.style.userSelect = "none";
          setDragging(press.drag);
        }
        move.preventDefault();
        const el = document.elementFromPoint(move.clientX, move.clientY);
        const next = el ? dropAt(press.drag, el, move.clientY) : undefined;
        let resolved: RailDrop | null;
        if (next) {
          resolved = isNoop(press.drag, next) ? null : next;
        } else if (
          !el?.closest("[data-reorder-rail]") ||
          el.closest("[data-reorder-none]")
        ) {
          // Off the rail, or over a section nothing can be dropped in
          // (Pinned, Direct messages, System): no target.
          resolved = null;
        } else {
          // Between two targets (the gap between sections), the last target
          // holds, so the drop line doesn't flicker while the pointer crosses
          // a few pixels of padding.
          resolved = dropRef.current;
        }
        if (
          JSON.stringify(resolved) !== JSON.stringify(dropRef.current ?? null)
        ) {
          dropRef.current = resolved;
          setDrop(resolved);
        }
      };

      const onUp = (up: PointerEvent) => {
        const press = pending.current;
        if (!press || up.pointerId !== press.pointerId) return;
        const wasDrag = started.current;
        const target = dropRef.current;
        end();
        if (!wasDrag) return;
        // The release still fires a click on the row under it, which would
        // open that channel. Swallow that one click; the timer drops the
        // guard if the release was somewhere no click follows.
        const swallow = (click: MouseEvent) => {
          click.stopPropagation();
          click.preventDefault();
        };
        window.addEventListener("click", swallow, {
          capture: true,
          once: true,
        });
        window.setTimeout(
          () => window.removeEventListener("click", swallow, { capture: true }),
          0,
        );
        if (target) onDropRef.current(press.drag, target);
      };

      const onKey = (key: KeyboardEvent) => {
        if (key.key === "Escape" && started.current) {
          key.preventDefault();
          end();
        }
      };

      window.addEventListener("pointermove", onMove);
      window.addEventListener("pointerup", onUp);
      window.addEventListener("pointercancel", end);
      window.addEventListener("keydown", onKey);
      window.addEventListener("blur", end);
      detach.current = () => {
        window.removeEventListener("pointermove", onMove);
        window.removeEventListener("pointerup", onUp);
        window.removeEventListener("pointercancel", end);
        window.removeEventListener("keydown", onKey);
        window.removeEventListener("blur", end);
      };
    },
    [enabled, end],
  );

  const keyDownFor = useCallback(
    (drag: RailDrag) => (event: ReactKeyboardEvent<HTMLElement>) => {
      if (!enabled || !event.altKey || event.ctrlKey || event.metaKey) return;
      if (event.key !== "ArrowUp" && event.key !== "ArrowDown") return;
      event.preventDefault();
      event.stopPropagation();
      onKeyMoveRef.current(drag, event.key === "ArrowUp" ? -1 : 1);
    },
    [enabled],
  );

  return { dragging, drop, pointerDownFor, keyDownFor };
}
