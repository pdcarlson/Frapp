import * as Sentry from "@sentry/nextjs";
import {
  buildAuthFailureReport,
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

/**
 * The same report from a route handler (`/auth/callback`). Not rate-limited:
 * one server process serves every member, so a limiter here would let one
 * member's failure hide everyone else's for the interval. Each request is one
 * link opened once, so there is no retry loop to damp. Never throws.
 */
export function reportServerAuthFailure(input: AuthFailureInput): void {
  try {
    const report = buildAuthFailureReport(input);
    if (!report) return;
    Sentry.captureException(report.error, {
      level: report.level,
      fingerprint: report.fingerprint,
      tags: report.tags,
    });
  } catch {
    // Reporting is a side channel; the redirect still happens.
  }
}
