"use client";

import {
  createContext,
  useContext,
  useLayoutEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";
import { SPLIT_QUERY } from "@/components/layout/shell-layout";

/**
 * The tool page header's action slot, beside its X. The shell sets it; the
 * header itself only shows from the side-by-side width up (CSS).
 */
export const ToolHeaderSlot = createContext<HTMLElement | null>(null);

/** The page action row's look (`page-actions.tsx`), for the narrow width. */
// Hidden while it holds nothing, or only the action's box with nothing in it
// (a `<Can>` the viewer doesn't pass), as `PageActions` collapses.
const ROW =
  "flex min-h-[34px] max-w-full flex-wrap items-center justify-end gap-2 empty:hidden [&:has(>div:empty)]:hidden";

/**
 * A tool page's one main action, such as New minutes, in the page's header
 * beside its X (Paul, 2026-11-19: "what if the new minutes button goes up to
 * the Minutes section header next to the x?"), the way Linear and Notion keep
 * a page's New button in its title bar rather than in a row of its own. Where
 * the header isn't shown (a narrow window, where the title is in the top
 * bar), or outside the shell, it stays in the page's action row.
 *
 * The action is drawn once, into a box of its own that moves between the
 * header and the row as the width crosses the line. Moving the box moves the
 * DOM, not the React tree, so a dialog the action opened keeps what was typed
 * in it, and its opener stays the one focus returns to. The box is placed
 * before paint, from the width itself rather than the shell's state, which
 * isn't known on the first render, so the action never shows in one place and
 * then jumps to the other.
 */
export function ToolHeaderActions({ children }: { children: ReactNode }) {
  const slot = useContext(ToolHeaderSlot);
  const rowRef = useRef<HTMLDivElement>(null);
  const [box, setBox] = useState<HTMLElement | null>(null);

  useLayoutEffect(() => {
    const element = document.createElement("div");
    element.className = "flex items-center gap-2";
    setBox(element);
    return () => element.remove();
  }, []);

  useLayoutEffect(() => {
    if (!box) return;
    const wide =
      typeof window.matchMedia === "function"
        ? window.matchMedia(SPLIT_QUERY)
        : null;
    const place = () => {
      const target = slot && wide?.matches ? slot : rowRef.current;
      if (target && box.parentElement !== target) target.appendChild(box);
    };
    place();
    wide?.addEventListener("change", place);
    return () => wide?.removeEventListener("change", place);
  }, [box, slot]);

  return (
    <>
      <div ref={rowRef} className={ROW} />
      {box ? createPortal(children, box) : null}
    </>
  );
}
