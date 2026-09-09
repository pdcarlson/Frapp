import * as Sentry from "@sentry/nextjs";
import { buildWebSentryOptions, webSentryDsn } from "@/lib/sentry/options";
import { initWebPostHog } from "@/lib/posthog/client";
import { withPostHogSentryCorrelation } from "@/lib/sentry/correlation";

/**
 * Browser Sentry + PostHog initialization for apps/web.
 *
 * `instrumentation-client.ts` at the app root is the Next 16 convention,
 * verified against `node_modules/next/dist/docs/01-app/03-api-reference/
 * 03-file-conventions/instrumentation-client.md` per `apps/web/AGENTS.md`. It
 * runs after the document loads and **before React hydration**, which is what
 * makes it the right place to install error tracking: an exception thrown
 * during hydration is still captured.
 *
 * Only synchronous top-level code is guaranteed to finish before hydration, so
 * both SDKs are initialized directly rather than behind a dynamic import.
 *
 * **No DSN / no PostHog key means no initialization at all** — local dev,
 * tests, and CI report nowhere, matching the API's behavior and this app's own
 * analytics gating.
 *
 * Landing is a different app (WS6) and stays out of this file.
 */
initWebPostHog();

const dsn = webSentryDsn();
if (dsn) {
  const options = buildWebSentryOptions(dsn);
  Sentry.init({
    ...options,
    beforeSend: withPostHogSentryCorrelation(options.beforeSend),
  });
}

/**
 * Navigation breadcrumbs for App Router transitions. The SDK expects this hook
 * to be re-exported from here so client-side navigations are instrumented; it
 * is a no-op when `Sentry.init` was never called.
 *
 * The URL becomes a breadcrumb message, so it goes through the free-text sweep
 * with everything else — query strings on a navigation are exactly the place a
 * token or an email turns up.
 */
export const onRouterTransitionStart = Sentry.captureRouterTransitionStart;
