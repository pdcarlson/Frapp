"use client";

import Link from "next/link";
import { useEffect, useState, type ReactNode } from "react";
import { LINK_QUIET } from "./styles";

/* The four rules at the top of `app/page.tsx` bind everything this file draws. */

/*
 * The section a header link lights up for. A homepage section opts in with
 * `data-nav-section`; Product covers the two proof sections (chat, then events)
 * and Pricing covers its own. Pages below the homepage carry no such section,
 * so there the links never light, which is right: nothing they point at is on
 * screen.
 */
export type NavSection = "product" | "pricing";

/*
 * A thin band a third of the way down the viewport, under the sticky header.
 * A section is "on screen" while it crosses the band, and the homepage's
 * sections are contiguous and never overlap, so at most one link is lit at a
 * time and the hero and the closing light neither.
 *
 * An observer, not a scroll listener: it costs nothing between crossings. A
 * jump (a nav click, End, a restored scroll position) is still seen, because a
 * section that lands across the band goes from not intersecting to
 * intersecting, which is a crossing. That is the case the reveals' wrapper had
 * to work around, and it only bit there because a reveal's target could jump
 * from below the viewport to above it without ever touching it.
 */
const BAND = "-33% 0px -66% 0px";

/*
 * Lit is the quiet link at its hover colour. Swapped rather than appended: two
 * text colours on one element resolve by stylesheet order, not class order.
 */
const LINK_LIT = LINK_QUIET.replace(
  "text-muted-foreground",
  "text-foreground",
);

/**
 * A header nav link that shows an active state while its section is on screen
 * (scrollspy, #3869).
 *
 * The active state is colour only, plus a 2px rule that is always laid out and
 * only changes colour, so lighting a link moves nothing (no layout shift). Both
 * take `chrome-motion`'s timing, which collapses to 1ms under
 * `prefers-reduced-motion`. The base state is the unlit link, so with no
 * JavaScript or no `IntersectionObserver` the nav is exactly what it was.
 */
export function SectionNavLink({
  href,
  section,
  children,
}: {
  href: string;
  section: NavSection;
  children: ReactNode;
}) {
  const [active, setActive] = useState(false);

  useEffect(() => {
    if (typeof IntersectionObserver === "undefined") return;
    const targets = document.querySelectorAll(
      `[data-nav-section="${section}"]`,
    );
    if (targets.length === 0) return;

    const crossing = new Set<Element>();
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) crossing.add(entry.target);
          else crossing.delete(entry.target);
        }
        setActive(crossing.size > 0);
      },
      { rootMargin: BAND },
    );
    targets.forEach((target) => observer.observe(target));
    return () => observer.disconnect();
  }, [section]);

  return (
    <Link
      href={href}
      aria-current={active ? "location" : undefined}
      className={`${active ? LINK_LIT : LINK_QUIET} relative`}
    >
      {children}
      <span
        aria-hidden="true"
        className={`chrome-motion absolute inset-x-0 bottom-1.5 h-0.5 rounded-full ${active ? "bg-foreground" : "bg-transparent"}`}
      />
    </Link>
  );
}
