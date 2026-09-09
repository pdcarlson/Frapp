import * as Sentry from "@sentry/nextjs";
import {
  buildLandingServerSentryOptions,
  landingSentryDsn,
} from "./lib/sentry/options";

/**
 * Server and edge Sentry initialization for `apps/landing` (issue #2041).
 *
 * No DSN means no initialization. Landing stays anonymous: this file never
 * sets a Sentry user and never fetches analytics identity.
 */
export function register(): void {
  const dsn = landingSentryDsn();
  if (!dsn) return;
  Sentry.init(buildLandingServerSentryOptions(dsn));
}

export const onRequestError: typeof Sentry.captureRequestError = (
  ...args
) => {
  if (!landingSentryDsn()) return;
  return Sentry.captureRequestError(...args);
};
