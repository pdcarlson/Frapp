import * as Sentry from "@sentry/react-native";
import { resetPostHog } from "@repo/observability/identified-posthog";

/**
 * Clears PostHog identity/groups and Sentry user on logout. Called from
 * `signOut` (`lib/auth-session.tsx`), the one funnel every sign-out goes
 * through, so no screen that signs out can drift.
 */
export function resetObservabilityOnLogout(): void {
  resetPostHog();
  Sentry.setUser(null);
}
