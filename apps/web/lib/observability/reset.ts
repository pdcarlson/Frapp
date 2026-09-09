"use client";

import * as Sentry from "@sentry/nextjs";
import { resetPostHog } from "@/lib/posthog/client";

/**
 * Clears PostHog identity/groups and Sentry user on logout. Called from
 * `signOutCurrentSession` so the account menu and profile panel cannot drift.
 */
export function resetObservabilityOnLogout(): void {
  resetPostHog();
  Sentry.setUser(null);
}
