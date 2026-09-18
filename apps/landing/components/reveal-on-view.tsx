"use client";

import { useEffect, useRef, type ReactNode } from "react";

/**
 * Plays a block's once-only entrance when it first scrolls into view.
 *
 * Adds nothing that has to be taken away again: the rendered markup is the
 * finished block, `reveal-armed` hides its `reveal-item` children at mount, and
 * `is-in` plays them. Without JavaScript, without `IntersectionObserver`, or
 * under `prefers-reduced-motion` neither class is ever added, so the block is
 * drawn at rest — the branch table on the Motion sheet, §4.
 *
 * `once` is structural, not a flag: the observer unobserves on the first
 * intersection, so a reveal cannot replay or run backwards on a scroll up.
 */
export function RevealOnView({
  className,
  children,
}: {
  className?: string;
  children: ReactNode;
}) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const node = ref.current;
    if (!node) return;
    if (typeof IntersectionObserver === "undefined") return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;

    /*
     * Never arm a block the browser has already painted. Arming sets its
     * children to `opacity: 0`, and the observer's first callback is
     * asynchronous, so a block that was on screen at mount disappears for a
     * frame or two and then fades back in: a replay of something the visitor
     * has already seen, which is worse than no entrance at all.
     *
     * It is reachable three ways, none of them exotic: a direct `/#pricing`
     * load, a restored scroll position on a back navigation, and a scroll that
     * beats hydration on a slow connection. Measured on a `/#pricing` load
     * before this guard: six frames at opacity 1, two at 0, then a 300ms fade.
     *
     * A block whose top edge is already above the viewport's bottom has
     * arrived, so it stays drawn and simply never animates.
     */
    if (node.getBoundingClientRect().top < window.innerHeight) return;

    node.classList.add("reveal-armed");
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (!entry.isIntersecting) continue;
          entry.target.classList.add("is-in");
          observer.unobserve(entry.target);
        }
      },
      /*
       * The bottom margin holds a reveal until the block's top edge is properly
       * in, so it reads as arriving rather than as already underway.
       *
       * The enormous TOP margin is the load-bearing half, and it is not a
       * rounding error. An observer only queues an entry when a target CROSSES
       * a threshold. A jump rather than a scroll — an in-page anchor from the
       * nav, End, a restored scroll position, a find-in-page hit — moves the
       * viewport in one step, and a block between the old position and the new
       * one goes from "below, not intersecting" to "above, not intersecting"
       * without ever being inside it. No threshold is crossed, so no entry is
       * ever delivered, and the block stays armed at `opacity: 0` with nothing
       * left to clear it. Checking `boundingClientRect` in the callback does
       * not help: the callback never runs for that target.
       *
       * Extending the root far above the viewport makes "already scrolled
       * past" an INTERSECTING state, so the crossing happens and the block
       * plays. Below the viewport is unaffected, which is the whole point: a
       * block still on its way down stays waiting.
       */
      { rootMargin: "100000px 0px -10% 0px" },
    );
    observer.observe(node);
    return () => observer.disconnect();
  }, []);

  return (
    <div ref={ref} className={className}>
      {children}
    </div>
  );
}
