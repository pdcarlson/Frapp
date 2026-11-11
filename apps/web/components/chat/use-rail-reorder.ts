"use client";

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type PointerEvent as ReactPointerEvent,
} from "react";
import { signetDarkTokens } from "@repo/theme/signet";
import { prefersReducedMotion } from "./use-rail-flip";

/**
 * Drag to reorder the chat rail (owner, 2026-11-11, #4178): an officer drags a
 * channel row within its section or into another category, or drags a
 * category's heading to move the whole category, the way Discord's server
 * sidebar works. `spec/behavior/chat/README.md` § Sidebar arrangement.
 *
 * **How it feels** (owner, 2026-11-11: "make whatever one you're holding kind
 * of tilt", "reserve the space for it"). The row lifts off the rail as a
 * copy that follows the pointer, a little larger and tilted, swaying with
 * how fast it moves sideways, the way a Trello card does. The rail closes the
 * row's old place and opens a slot where it would land, the rows sliding
 * apart (`use-rail-flip.ts`) rather than a line being drawn between them. On
 * release the copy straightens and settles into the slot, and only then does
 * the row reappear there; a cancelled drag settles back home. Near the top or
 * bottom of the rail the rail scrolls, so a channel can travel past what fits
 * on screen. Under reduced motion the copy neither tilts nor settles.
 *
 * Pointer events, not HTML drag and drop. The row's hit target is a
 * `<button>`, and Firefox starts no HTML drag from inside a button
 * (`components/shared/reorder-list.tsx` met the same wall and moved its grip
 * off one); HTML drag and drop also draws its own translucent snapshot,
 * which can't tilt or settle. Pointer events let one gesture cross sections,
 * and keep the row a plain click until the pointer has travelled
 * `DRAG_START_PX`, so a click that wobbles a pixel still opens the channel.
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
 * - `data-reorder-header="<key>"` on an orderable section's heading, and
 *   `data-reorder-into="<key>"` on an empty category's hint: a channel dropped
 *   on either lands first in that section.
 * - `data-reorder-category="<category id>"` on a category's whole block. A
 *   dragged category goes by height alone: the pointer's height among the
 *   category headings, wherever it is across the rail.
 * - `data-reorder-gap` on the slot the rail opens, `data-reorder-none` on a
 *   section nothing can be dropped in, and `data-reorder-rail` on the whole
 *   rail. Over the slot, or between targets, the last target holds; over a
 *   `data-reorder-none` section or off the rail there is none.
 *
 * Keyboard: with a row or a category heading focused, Alt+Up and Alt+Down move
 * it one place within its list. The rail does that through `onKeyMove`.
 */

/** How far the pointer travels before a press becomes a drag. */
const DRAG_START_PX = 5;
/** The held copy's resting tilt and lift. */
const TILT_DEG = 2.5;
const LIFT_SCALE = 1.04;
/** How far sideways speed sways the tilt, and the most it may. */
const SWAY_PER_PX_MS = 3;
const SWAY_MAX_DEG = 4;
/** Pointer this close to the scroller's edge scrolls it, up to this fast. */
const EDGE_PX = 48;
const EDGE_SPEED_PX = 14;
const { duration, easing } = signetDarkTokens.motion;

export type RailDrag =
  | { kind: "channel"; id: string; section: string }
  | { kind: "category"; id: string };

export type RailDrop =
  /** Before or after a row of an orderable section. */
  | { kind: "row"; section: string; id: string; after: boolean }
  /** On a section's heading, or an empty category: first in that section. */
  | { kind: "header"; section: string }
  /** Before or after a category's block. */
  | { kind: "category"; id: string; after: boolean };

/** The held row's size, for the copy and the slot. */
export interface RailLift {
  width: number;
  height: number;
}

interface Press {
  drag: RailDrag;
  x: number;
  y: number;
  pointerId: number;
  /** Where in the row the pointer took hold. */
  grabX: number;
  grabY: number;
  lift: RailLift;
  rail: HTMLElement | null;
}

/** The nearest ancestor that scrolls vertically, for the edge autoscroll. */
function scrollerOf(el: HTMLElement | null): HTMLElement | null {
  for (let node = el; node; node = node.parentElement) {
    const { overflowY } = getComputedStyle(node);
    if (
      (overflowY === "auto" || overflowY === "scroll") &&
      node.scrollHeight > node.clientHeight
    ) {
      return node;
    }
  }
  return null;
}

/** A dragged category's place: by height among the other headings. */
function categoryDropAt(
  rail: HTMLElement | null,
  x: number,
  y: number,
): RailDrop | null {
  if (!rail) return null;
  const box = rail.getBoundingClientRect();
  if (x < box.left || x > box.right) return null;
  const headers = Array.from(
    rail.querySelectorAll<HTMLElement>(
      "[data-reorder-category] [data-reorder-header]",
    ),
  );
  let last: string | undefined;
  for (const header of headers) {
    const id = header.closest<HTMLElement>("[data-reorder-category]")?.dataset
      .reorderCategory;
    if (!id) continue;
    const rect = header.getBoundingClientRect();
    if (y < rect.top + rect.height / 2) {
      return { kind: "category", id, after: false };
    }
    last = id;
  }
  return last ? { kind: "category", id: last, after: true } : null;
}

/**
 * What is under the pointer for a channel drag: a target, `"hold"` to keep
 * the last one (the slot, or the gap between sections), or null for none.
 */
function channelDropAt(
  el: Element | null,
  y: number,
): RailDrop | "hold" | null {
  if (
    !el?.closest("[data-reorder-rail]") ||
    el.closest("[data-reorder-none]")
  ) {
    return null;
  }
  const row = el.closest<HTMLElement>("[data-reorder-row]");
  if (row) {
    const id = row.dataset.reorderRow;
    const section = row.dataset.reorderSection;
    if (!id || !section) return "hold";
    const rect = row.getBoundingClientRect();
    return {
      kind: "row",
      section,
      id,
      after: y > rect.top + rect.height / 2,
    };
  }
  const into = el.closest<HTMLElement>(
    "[data-reorder-header], [data-reorder-into]",
  );
  const section = into?.dataset.reorderHeader ?? into?.dataset.reorderInto;
  if (section) return { kind: "header", section };
  return "hold";
}

function isNoop(drag: RailDrag, drop: RailDrop): boolean {
  if (drag.kind === "channel") {
    return drop.kind === "row" && drop.id === drag.id;
  }
  return drop.kind === "category" && drop.id === drag.id;
}

export interface RailReorder {
  /** What is being dragged, while a drag is on or settling. */
  dragging: RailDrag | null;
  /** Where it would land if released now; null draws the slot back home. */
  drop: RailDrop | null;
  /** The held row's size while a drag is on. */
  lift: RailLift | null;
  /** True between the release and the copy coming to rest in its slot. */
  settling: boolean;
  /** For the held copy's outer element: the hook moves it. */
  attachHeldCopy: (el: HTMLElement | null) => void;
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
  onLift,
}: {
  enabled: boolean;
  /** A drag was released over a target. The caller decides whether it moved anything. */
  onDrop: (drag: RailDrag, drop: RailDrop) => void;
  /** Alt+Up (`-1`) or Alt+Down (`1`) on a focused row or heading. */
  onKeyMove: (drag: RailDrag, step: -1 | 1) => void;
  /** Right before a press becomes a drag, while the rail still looks as it did. */
  onLift?: () => void;
}): RailReorder {
  const [dragging, setDragging] = useState<RailDrag | null>(null);
  const [drop, setDrop] = useState<RailDrop | null>(null);
  const [lift, setLift] = useState<RailLift | null>(null);
  const [settling, setSettling] = useState(false);
  const press = useRef<Press | null>(null);
  const dropRef = useRef<RailDrop | null>(null);
  const started = useRef(false);
  const detach = useRef<(() => void) | null>(null);
  const ghost = useRef<HTMLElement | null>(null);
  const pointer = useRef({ x: 0, y: 0, t: 0 });
  const timers = useRef<number[]>([]);
  const frame = useRef<number | null>(null);
  const scroller = useRef<HTMLElement | null>(null);
  // The callbacks change every render; the window listeners and key handlers
  // read the latest through these, refreshed after each render.
  const onDropRef = useRef(onDrop);
  const onKeyMoveRef = useRef(onKeyMove);
  const onLiftRef = useRef(onLift);
  useEffect(() => {
    onDropRef.current = onDrop;
    onKeyMoveRef.current = onKeyMove;
    onLiftRef.current = onLift;
  });

  const later = (fn: () => void, ms: number) => {
    timers.current.push(window.setTimeout(fn, ms));
  };

  const end = useCallback(() => {
    detach.current?.();
    detach.current = null;
    for (const id of timers.current) window.clearTimeout(id);
    timers.current = [];
    if (frame.current !== null) cancelAnimationFrame(frame.current);
    frame.current = null;
    press.current = null;
    dropRef.current = null;
    scroller.current = null;
    if (started.current) {
      started.current = false;
      document.body.style.removeProperty("cursor");
      document.body.style.removeProperty("user-select");
    }
    setDragging(null);
    setDrop(null);
    setLift(null);
    setSettling(false);
  }, []);

  // A drag in flight when the rail unmounts, or loses the permission, ends:
  // the cleanup runs on either.
  useEffect(() => end, [enabled, end]);

  /** The held copy's two layers: the outer follows, the inner tilts. */
  const ghostLayers = () => {
    const outer = ghost.current;
    const inner = outer?.firstElementChild as HTMLElement | null | undefined;
    return { outer, inner: inner ?? null };
  };

  const placeGhost = () => {
    const held = press.current;
    const { outer } = ghostLayers();
    if (!held || !outer) return;
    outer.style.translate = `${pointer.current.x - held.grabX}px ${pointer.current.y - held.grabY}px`;
  };

  const tilt = (deg: number, scale: number) => {
    const { inner } = ghostLayers();
    if (!inner) return;
    inner.style.rotate = `${deg}deg`;
    inner.style.scale = String(scale);
  };

  const attachHeldCopy = useCallback((el: HTMLElement | null) => {
    ghost.current = el;
    if (!el) return;
    placeGhost();
    // Lifts on the next frame, so the copy starts flat over the row it left
    // and visibly rises off the rail.
    if (!prefersReducedMotion()) {
      requestAnimationFrame(() => {
        if (started.current && ghost.current === el) tilt(TILT_DEG, LIFT_SCALE);
      });
    }
    // placeGhost and tilt read refs only.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /** Where the current pointer would drop the held item. */
  const resolve = () => {
    const held = press.current;
    if (!held) return;
    const { x, y } = pointer.current;
    let next: RailDrop | null;
    if (held.drag.kind === "category") {
      next = categoryDropAt(held.rail, x, y);
    } else {
      const found = channelDropAt(document.elementFromPoint(x, y), y);
      next = found === "hold" ? dropRef.current : found;
    }
    if (next && isNoop(held.drag, next)) next = null;
    if (JSON.stringify(next) !== JSON.stringify(dropRef.current ?? null)) {
      dropRef.current = next;
      setDrop(next);
    }
  };

  /** Scrolls the rail while the pointer rests near its top or bottom edge. */
  const autoscroll = () => {
    frame.current = null;
    const box = scroller.current;
    if (!started.current || !box) return;
    const rect = box.getBoundingClientRect();
    const { y } = pointer.current;
    let step = 0;
    if (y < rect.top + EDGE_PX) {
      step = -EDGE_SPEED_PX * Math.min(1, (rect.top + EDGE_PX - y) / EDGE_PX);
    } else if (y > rect.bottom - EDGE_PX) {
      step =
        EDGE_SPEED_PX * Math.min(1, (y - (rect.bottom - EDGE_PX)) / EDGE_PX);
    }
    if (step !== 0) {
      const before = box.scrollTop;
      box.scrollTop += step;
      if (box.scrollTop !== before) resolve();
    }
    frame.current = requestAnimationFrame(autoscroll);
  };

  /**
   * The release: commit at once, so the new order is in the cache while the
   * copy settles, then let the copy come to rest in the slot before the row
   * takes its place. A drop with no target settles back to where it began.
   */
  const settle = (target: RailDrop | null) => {
    const held = press.current;
    detach.current?.();
    detach.current = null;
    if (frame.current !== null) cancelAnimationFrame(frame.current);
    frame.current = null;
    if (!held) return end();
    dropRef.current = target;
    setDrop(target);
    if (target) onDropRef.current(held.drag, target);
    if (prefersReducedMotion() || !ghost.current) return end();
    setSettling(true);
    document.body.style.cursor = "";
    // A frame for the slot to be where the drop put it.
    requestAnimationFrame(() => {
      const slot = document.querySelector<HTMLElement>("[data-reorder-gap]");
      const { outer } = ghostLayers();
      if (!slot || !outer) return end();
      const rect = slot.getBoundingClientRect();
      const ms = duration.standard;
      outer.style.transition = `translate ${ms}ms ${easing.standard}`;
      outer.style.translate = `${rect.left}px ${rect.top}px`;
      tilt(0, 1);
      later(end, ms + 20);
    });
  };

  const pointerDownFor = useCallback(
    (drag: RailDrag) => (event: ReactPointerEvent<HTMLElement>) => {
      if (!enabled || event.button !== 0 || event.pointerType === "touch") {
        return;
      }
      if (event.ctrlKey || event.metaKey || event.shiftKey || event.altKey) {
        return;
      }
      end();
      const box = event.currentTarget.getBoundingClientRect();
      press.current = {
        drag,
        x: event.clientX,
        y: event.clientY,
        pointerId: event.pointerId,
        grabX: event.clientX - box.left,
        grabY: event.clientY - box.top,
        lift: { width: box.width, height: box.height },
        rail: event.currentTarget.closest<HTMLElement>("[data-reorder-rail]"),
      };
      pointer.current = {
        x: event.clientX,
        y: event.clientY,
        t: event.timeStamp,
      };

      let settleSway: number | null = null;

      const onMove = (move: PointerEvent) => {
        const held = press.current;
        if (!held || move.pointerId !== held.pointerId) return;
        const last = pointer.current;
        pointer.current = {
          x: move.clientX,
          y: move.clientY,
          t: move.timeStamp,
        };
        if (!started.current) {
          const dx = move.clientX - held.x;
          const dy = move.clientY - held.y;
          if (Math.hypot(dx, dy) < DRAG_START_PX) return;
          onLiftRef.current?.();
          started.current = true;
          document.body.style.cursor = "grabbing";
          document.body.style.userSelect = "none";
          scroller.current = scrollerOf(held.rail);
          setLift(held.lift);
          setDragging(held.drag);
          frame.current = requestAnimationFrame(autoscroll);
        }
        move.preventDefault();
        placeGhost();
        if (!prefersReducedMotion()) {
          // Sway with sideways speed, and ease back to rest once it stops.
          const dt = Math.max(1, move.timeStamp - last.t);
          const vx = (move.clientX - last.x) / dt;
          const sway = Math.max(
            -SWAY_MAX_DEG,
            Math.min(SWAY_MAX_DEG, vx * SWAY_PER_PX_MS),
          );
          tilt(TILT_DEG + sway, LIFT_SCALE);
          if (settleSway !== null) window.clearTimeout(settleSway);
          settleSway = window.setTimeout(() => {
            // Still held (not released, which detaches): back to the rest tilt.
            if (started.current && detach.current) tilt(TILT_DEG, LIFT_SCALE);
          }, 90);
        }
        resolve();
      };

      const onUp = (up: PointerEvent) => {
        const held = press.current;
        if (!held || up.pointerId !== held.pointerId) return;
        if (!started.current) return end();
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
        settle(dropRef.current);
      };

      const onKey = (key: KeyboardEvent) => {
        if (key.key === "Escape" && started.current) {
          key.preventDefault();
          settle(null);
        }
      };

      window.addEventListener("pointermove", onMove);
      window.addEventListener("pointerup", onUp);
      window.addEventListener("pointercancel", end);
      window.addEventListener("keydown", onKey);
      window.addEventListener("blur", end);
      detach.current = () => {
        if (settleSway !== null) window.clearTimeout(settleSway);
        window.removeEventListener("pointermove", onMove);
        window.removeEventListener("pointerup", onUp);
        window.removeEventListener("pointercancel", end);
        window.removeEventListener("keydown", onKey);
        window.removeEventListener("blur", end);
      };
    },
    // The helpers above read refs only.
    // eslint-disable-next-line react-hooks/exhaustive-deps
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

  return {
    dragging,
    drop,
    lift,
    settling,
    attachHeldCopy,
    pointerDownFor,
    keyDownFor,
  };
}
