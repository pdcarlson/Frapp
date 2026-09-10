"use client";

import { usePathname } from "next/navigation";
import { useEffect } from "react";
import { captureLandingPageview } from "../lib/posthog/client";

/**
 * Manual `$pageview` on App Router navigations. `usePathname()` is path-only;
 * query strings (`/join?token=`) never reach PostHog from this component.
 */
export function PageviewTracker() {
  const pathname = usePathname();
  useEffect(() => {
    captureLandingPageview(pathname);
  }, [pathname]);
  return null;
}
