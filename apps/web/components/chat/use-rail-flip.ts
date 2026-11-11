"use client";

import { useCallback, useLayoutEffect, useRef } from "react";
import { signetDarkTokens } from "@repo/theme/signet";

/**
 * Slides the chat rail's rows to their new places instead of letting them
 * jump (#4178): while a drag is on, the rows part to open the slot the
 * dragged row will land in, and close it behind as the slot moves. The
 * classic FLIP technique: measure where each element was, let React move it,
 * draw it back where it was with a transform, then let that transform run out.
 *
 * Every element that should slide carries `data-flip="<stable key>"`: the
 * rows, the section headings, the empty-category hint and the drag's slot.
 * Positions are taken against the rail's own top, so an autoscroll during a
 * drag doesn't read as every row moving.
 *
 * `track` records where everything is the moment before a drag starts and
 * then slides on every render until `release`. `arm` records it and slides
 * the next render that moves anything, for an Alt+Arrow move, whose new order
 * arrives a moment later from the query cache.
 * Under reduced motion nothing slides.
 */

/** Standard-transition timing, `motion.duration.micro` on the standard curve. */
export const RAIL_SLIDE_MS = signetDarkTokens.motion.duration.micro;
export const RAIL_EASING = signetDarkTokens.motion.easing.standard;

/** Script-driven motion checks the preference itself (README §7). */
export function prefersReducedMotion(): boolean {
  // No `matchMedia` (jsdom) is treated as reduced: nothing to animate with.
  if (typeof window === "undefined" || typeof window.matchMedia !== "function")
    return true;
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

/** The vertical offset an in-flight slide has the element at right now. */
function slideOffset(el: HTMLElement): number {
  if (!el.style.transform) return 0;
  const value = getComputedStyle(el).transform;
  if (!value || value === "none" || typeof DOMMatrixReadOnly === "undefined") {
    return 0;
  }
  return new DOMMatrixReadOnly(value).m42;
}

/** Each element's resting top, relative to the rail. */
function measure(rail: HTMLElement): Map<string, number> {
  const railTop = rail.getBoundingClientRect().top;
  const tops = new Map<string, number>();
  rail.querySelectorAll<HTMLElement>("[data-flip]").forEach((el) => {
    const key = el.dataset.flip;
    if (!key) return;
    tops.set(key, el.getBoundingClientRect().top - railTop - slideOffset(el));
  });
  return tops;
}

export function useRailFlip() {
  const railRef = useRef<HTMLDivElement>(null);
  const previous = useRef<Map<string, number> | null>(null);
  /** A drag is on: measure and slide on every render. */
  const tracking = useRef(false);
  const armed = useRef<number | null>(null);

  const snapshot = useCallback(() => {
    const rail = railRef.current;
    previous.current = rail && !prefersReducedMotion() ? measure(rail) : null;
  }, []);

  /** A drag starts: record the rail as it looks, then follow every render. */
  const track = useCallback(() => {
    snapshot();
    tracking.current = true;
  }, [snapshot]);

  /** The drag is over; the render that ended it has already slid. */
  const release = useCallback(() => {
    tracking.current = false;
    if (armed.current === null) previous.current = null;
  }, []);

  /** An Alt+Arrow move: slide on the next render that moves anything. */
  const arm = useCallback(() => {
    snapshot();
    if (!previous.current) return;
    if (armed.current !== null) window.clearTimeout(armed.current);
    // The new order normally lands within a frame or two; if it never comes
    // (the move was refused), stop holding the old positions.
    armed.current = window.setTimeout(() => {
      armed.current = null;
      if (!tracking.current) previous.current = null;
    }, 1000);
  }, [snapshot]);

  // Every render: cheap when idle, since it returns before touching the DOM.
  useLayoutEffect(() => {
    const before = previous.current;
    const rail = railRef.current;
    if (!rail || !before) return;
    if (prefersReducedMotion()) {
      previous.current = null;
      return;
    }
    const railTop = rail.getBoundingClientRect().top;
    const now = new Map<string, number>();
    const moving: HTMLElement[] = [];
    rail.querySelectorAll<HTMLElement>("[data-flip]").forEach((el) => {
      const key = el.dataset.flip;
      if (!key) return;
      const offset = slideOffset(el);
      const top = el.getBoundingClientRect().top - railTop - offset;
      now.set(key, top);
      const was = before.get(key);
      if (was === undefined) return;
      // Where it showed a moment ago (its old place plus whatever slide was
      // still running), less where it now rests.
      const delta = was + offset - top;
      if (Math.abs(delta) < 0.5) return;
      el.style.transition = "none";
      el.style.transform = `translateY(${delta}px)`;
      moving.push(el);
    });
    if (moving.length > 0) {
      // One forced layout for the lot, then every slide runs out together.
      void rail.offsetHeight;
      for (const el of moving) {
        el.style.transition = `transform ${RAIL_SLIDE_MS}ms ${RAIL_EASING}`;
        el.style.transform = "";
      }
    }
    if (tracking.current) {
      previous.current = now;
    } else if (armed.current !== null && moving.length > 0) {
      window.clearTimeout(armed.current);
      armed.current = null;
      previous.current = null;
    }
  });

  return { railRef, track, release, arm };
}
