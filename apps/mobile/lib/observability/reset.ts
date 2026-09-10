import * as Sentry from "@sentry/react-native";
import { resetPostHog } from "@repo/observability/identified-posthog";

/**
 * Clears PostHog identity/groups and Sentry user on logout. Called from
 * `signOut` so the three sign-out screens cannot drift.
 */
export function resetObservabilityOnLogout(): void {
  resetPostHog();
  Sentry.setUser(null);
}
