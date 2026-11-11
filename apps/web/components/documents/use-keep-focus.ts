"use client";

import { useEffect, useRef } from "react";

/** The attribute a control carries so focus can find it again. */
export const KEEP_FOCUS_ATTRIBUTE = "data-keep-focus";

/**
 * Keeps keyboard focus on a Star or Pin control whose row moves (#3934).
 *
 * Starring a folder moves it into the Starred group of the rail, and pinning
 * moves it into Pinned; inside a folder view a starred file moves to the head
 * of the list. The rail draws each group in its own element, so the row is
 * unmounted and mounted again in its new place, and the button that had focus
 * goes with it: focus drops to the page and the next Tab starts from the top.
 *
 * `remember(key)` names the control just pressed. After each render, if focus
 * has fallen to the page (and only then), the control carrying that key under
 * `rootRef` takes it back. A pin moves its row only once the server answers,
 * so the memory lasts a few seconds; a deliberate move of focus elsewhere
 * forgets it at once.
 */
export function useKeepFocus<T extends HTMLElement>() {
  const rootRef = useRef<T | null>(null);
  const pending = useRef<{ key: string; until: number } | null>(null);

  useEffect(() => {
    const want = pending.current;
    if (!want) return;
    if (Date.now() > want.until) {
      pending.current = null;
      return;
    }
    const active = document.activeElement;
    if (active && active !== document.body) {
      // Still on the control, or moved on by the member: nothing to restore.
      if (active.getAttribute(KEEP_FOCUS_ATTRIBUTE) !== want.key) {
        pending.current = null;
      }
      return;
    }
    const target = rootRef.current?.querySelector<HTMLElement>(
      `[${KEEP_FOCUS_ATTRIBUTE}="${CSS.escape(want.key)}"]`,
    );
    target?.focus();
  });

  function remember(key: string) {
    pending.current = { key, until: Date.now() + 5000 };
  }

  return { rootRef, remember };
}
