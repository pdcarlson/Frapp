"use client";

import { useSyncExternalStore } from "react";

function subscribeNever(): () => void {
  return () => {};
}

/**
 * False during SSR / the first client render, true after hydration.
 * Replaces the `useEffect(() => setMounted(true), [])` hydration gate.
 */
export function useIsClient(): boolean {
  return useSyncExternalStore(subscribeNever, () => true, () => false);
}
