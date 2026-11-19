"use client";

import { useEffect } from "react";
import { useSearchParams } from "next/navigation";
import { settingEntryById } from "@repo/hooks/settings-search";

/** How long to wait for the field to draw, for a tab whose reads are slow. */
const WAIT_MS = 4000;

const FORM_CONTROL = "input, select, textarea, button, [role='switch']";

/**
 * The block to light for an anchor: what the page marks with
 * `data-setting-highlight`, else a form control's or a legend's own field (its
 * label and control together), else the anchor itself, which is a section.
 */
export function settingHighlightTarget(anchor: HTMLElement): HTMLElement {
  const marked = anchor.closest<HTMLElement>("[data-setting-highlight]");
  if (marked) return marked;
  if (anchor.matches(FORM_CONTROL) || anchor.tagName === "LEGEND") {
    return anchor.parentElement ?? anchor;
  }
  return anchor;
}

/**
 * Lights the setting a search opened: `?setting=<id>` (settings search,
 * `settings-search.ts` in `@repo/hooks`), on Chapter settings and on
 * Settings. Waits for its element, scrolls it to the middle of the pane,
 * focuses a field without scrolling again, and runs `.setting-flash` on its
 * block. Then drops `?setting=` from the address, so a refresh or the back
 * button doesn't light it again; the rest of the address stays as it was.
 */
export function useSettingJump() {
  const settingId = useSearchParams().get("setting");
  useEffect(() => {
    const entry = settingEntryById(settingId);
    if (!settingId) return;
    const clearParam = () => {
      const url = new URL(window.location.href);
      if (url.searchParams.get("setting") !== settingId) return;
      url.searchParams.delete("setting");
      window.history.replaceState(null, "", url.toString());
    };
    const anchorId = entry?.web?.anchor;
    if (!anchorId) {
      clearParam();
      return;
    }
    let frame = 0;
    const started = performance.now();
    const reduceMotion = window.matchMedia?.(
      "(prefers-reduced-motion: reduce)",
    ).matches;
    const look = () => {
      const anchor = document.getElementById(anchorId);
      if (!anchor) {
        if (performance.now() - started < WAIT_MS) {
          frame = requestAnimationFrame(look);
        } else {
          clearParam();
        }
        return;
      }
      const lit = settingHighlightTarget(anchor);
      lit.scrollIntoView?.({
        block: "center",
        behavior: reduceMotion ? "auto" : "smooth",
      });
      if (anchor.matches(FORM_CONTROL) && !anchor.hasAttribute("disabled")) {
        anchor.focus({ preventScroll: true });
      }
      // Restart the animation when the same block is lit twice in a row.
      lit.classList.remove("setting-flash");
      void lit.offsetWidth;
      lit.classList.add("setting-flash");
      // Not cleared on unmount: dropping `?setting=` re-runs this effect,
      // and the light has to outlast that.
      setTimeout(
        () => lit.classList.remove("setting-flash"),
        reduceMotion ? 2000 : 2700,
      );
      clearParam();
    };
    frame = requestAnimationFrame(look);
    return () => cancelAnimationFrame(frame);
  }, [settingId]);
}
