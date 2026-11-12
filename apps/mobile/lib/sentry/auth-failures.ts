import * as Sentry from "@sentry/react-native";
import { onlineManager } from "@tanstack/react-query";
import {
  createAuthFailureReporter,
  type AuthFailureInput,
} from "@repo/observability";

/**
 * Mobile's binding of the shared signed-out auth failure reporter (#3832).
 * The rules are in `@repo/observability`'s `auth-failures.ts`, and
 * `spec/behavior/observability.md` § Signed-out auth failures owns them.
 *
 * Online is TanStack's `onlineManager`, as for `query-errors.ts`: a sign-in
 * that dies while the connection monitor reads offline is the member's
 * network, not a fault, and is not reported.
 */
const report = createAuthFailureReporter({
  capture: ({ error, level, fingerprint, tags }) => {
    Sentry.captureException(error, { level, fingerprint, tags });
  },
  isOnline: () => onlineManager.isOnline(),
});

/** Report a signed-out auth failure. Never throws. */
export function reportAuthFailure(input: AuthFailureInput): void {
  report(input);
}
