import * as Sentry from "@sentry/nextjs";
import {
  createAuthFailureReporter,
  type AuthFailureInput,
} from "@repo/observability";
import { isWebOnline } from "./query-errors";

/**
 * Web's binding of the shared signed-out auth failure reporter (#3832). The
 * rules are in `@repo/observability`'s `auth-failures.ts`, and
 * `spec/behavior/observability.md` § Signed-out auth failures owns them.
 *
 * One reporter for the tab, so its rate limit spans the sign-in, sign-up and
 * join screens a member moves between.
 */
const report = createAuthFailureReporter({
  capture: ({ error, level, fingerprint, tags }) => {
    Sentry.captureException(error, { level, fingerprint, tags });
  },
  isOnline: isWebOnline,
});

/** Report a signed-out auth failure. Never throws. */
export function reportAuthFailure(input: AuthFailureInput): void {
  report(input);
}
