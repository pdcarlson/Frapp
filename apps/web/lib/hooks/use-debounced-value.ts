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
 * One copy remains, in `apps/mobile/app/(auth)/create-chapter.tsx` — the same
 * body with the parameter spelled `delayMs`. `@/*` resolves per app, so mobile
 * cannot import this file; folding the two together means promoting the hook
 * into `@repo/hooks`, the move `useNow` already made for the same reason
 * (`packages/hooks/src/use-now.ts`).
 */
export function useDebouncedValue<T>(value: T, delay: number): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const id = setTimeout(() => setDebounced(value), delay);
    return () => clearTimeout(id);
  }, [value, delay]);
  return debounced;
}
