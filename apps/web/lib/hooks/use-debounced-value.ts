"use client";

import { useEffect, useState } from "react";

/**
 * Trailing-edge debounce of a value.
 *
 * Lived privately inside `dashboard-command-menu.tsx` while it had exactly one
 * caller. The chat search popover is the second, and both debounce a query on
 * its way into `useSearch` — so a second copy would be two things that have to
 * agree about search behaviour but are free to drift, which is the duplication
 * class the repo already tracks issues against.
 */
export function useDebouncedValue<T>(value: T, delay: number): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const id = setTimeout(() => setDebounced(value), delay);
    return () => clearTimeout(id);
  }, [value, delay]);
  return debounced;
}
