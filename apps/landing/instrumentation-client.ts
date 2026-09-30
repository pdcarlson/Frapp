import * as Sentry from "@sentry/nextjs";
import { sentryEnvelopeScrubIntegration } from "@repo/observability/next";
import { initLandingPostHog } from "./lib/posthog/client";
import { withPostHogSentryCorrelation } from "./lib/sentry/correlation";
import {
  buildLandingSentryOptions,
  landingSentryDsn,
} from "./lib/sentry/options";

/**
 * Browser Sentry + PostHog initialization for `apps/landing`.
 *
 * `instrumentation-client.ts` runs after the document loads and before React
 * hydration, so a hydration exception is still captured. Both SDKs init
 * synchronously; a dynamic import is not guaranteed to finish in time.
 *
 * No DSN / no PostHog key means no initialization. Landing never identify /
 * alias / group, and never reads `NEXT_PUBLIC_SENTRY_DSN` (that is frapp-web).
 */
initLandingPostHog();

const dsn = landingSentryDsn();
if (dsn) {
  const options = buildLandingSentryOptions(dsn);
  Sentry.init({
    ...options,
    beforeSend: withPostHogSentryCorrelation(options.beforeSend),
    // Scrubs what the SDK sends without an event: the standalone INP span,
    // named after the clicked element's selector (#2736). See
    // `sentryEnvelopeScrubIntegration`.
    integrations: [sentryEnvelopeScrubIntegration()],
  });
}

export const onRouterTransitionStart = Sentry.captureRouterTransitionStart;
