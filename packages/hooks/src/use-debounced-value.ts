import { useEffect, useState } from "react";

/**
 * `value`, once it has stopped changing for `delayMs` (a trailing-edge
 * debounce). One home for web and the phone, because two copies are two
 * things that have to agree about search behaviour and are free to drift.
 * Callers: GIF search here, web's chat search, find bar and onboarding
 * directory search (through `apps/web/lib/hooks/use-debounced-value.ts`), and
 * mobile's create-chapter search.
 */
export function useDebouncedValue<T>(value: T, delayMs: number): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const id = setTimeout(() => setDebounced(value), delayMs);
    return () => clearTimeout(id);
  }, [value, delayMs]);
  return debounced;
}
