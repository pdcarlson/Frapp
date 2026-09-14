"use client";

import { useEffect, useState } from "react";

/**
 * Trailing-edge debounce of a value.
 *
 * One home, because a second copy is two things that have to agree about search
 * behaviour and are free to drift — the duplication class the repo already
 * tracks issues against. Callers: the chat search popover, the find bar, and
 * the onboarding wizard's directory search.
 *
 * `apps/mobile/app/(auth)/create-chapter.tsx` holds a fourth, byte-identical
 * copy. It cannot import this one — `@/lib` is web-only — so folding the two
 * together means promoting the hook into `@repo/hooks`, which is a cross-app
 * change rather than a web cleanup.
 */
export function useDebouncedValue<T>(value: T, delay: number): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const id = setTimeout(() => setDebounced(value), delay);
    return () => clearTimeout(id);
  }, [value, delay]);
  return debounced;
}
