import { useEffect } from "react";
import { usePathname } from "expo-router";

/**
 * The focused route's path, for code that opens a link outside a component
 * (`lib/chat/open-link.ts`) and so can't call `usePathname` itself, but must
 * still pass it to `openHref` so a link to the kind of screen already on top
 * replaces it rather than stacking a second (owner, 2026-11-07). The app's
 * stack layout keeps it current (`useTrackCurrentPathname`).
 */
let current: string | undefined;

export function currentPathname(): string | undefined {
  return current;
}

/** Mounted once, in `app/(app)/_layout.tsx`. */
export function useTrackCurrentPathname(): void {
  const pathname = usePathname();
  useEffect(() => {
    current = pathname;
  }, [pathname]);
}
