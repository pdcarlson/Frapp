import {
  POSTHOG_PROPERTY_DENYLIST,
  buildAnonymousPostHogBrowserOptions,
  sanitizeIdentifiedPostHogCapture,
} from "@repo/observability/next";
import type { PostHogConfig } from "posthog-js";

/**
 * Write-only PostHog project token (`phc_…`). Public by design, like a Sentry
 * DSN — it authorizes ingest, not read. The salt and any personal API key stay
 * out of this bundle.
 *
 * Direct `process.env.NEXT_PUBLIC_*` member access so Next inlines it at build
 * time. A dynamic lookup would stay `undefined` in the browser.
 */
export function webPostHogKey(): string | undefined {
  return process.env.NEXT_PUBLIC_POSTHOG_KEY || undefined;
}

export function webPostHogHost(): string {
  return process.env.NEXT_PUBLIC_POSTHOG_HOST || "https://us.i.posthog.com";
}

export function isPostHogConfigured(): boolean {
  return Boolean(webPostHogKey());
}

export type WebPostHogInitOptions = Pick<
  PostHogConfig,
  | "api_host"
  | "autocapture"
  | "capture_pageview"
  | "capture_pageleave"
  | "capture_exceptions"
  | "capture_heatmaps"
  | "disable_session_recording"
  | "person_profiles"
  | "session_recording"
  | "property_denylist"
  | "before_send"
>;

/**
 * Web extras on the anonymous Next PostHog options. Identity is *not* in
 * this object — `applyAnalyticsIdentity` on
 * `@repo/observability/identified-posthog` calls `identify` after
 * `GET /v1/analytics/identity`. `person_profiles: "identified_only"`
 * is the web-only person-profile mode.
 *
 * `before_send` is the identified sanitizer, not landing's anonymous one:
 * `$set` / hex `$groups` must survive. URL-shaped SDK properties still go
 * path-only so `/join?token=` never leaves.
 */
export function buildWebPostHogInitOptions(opts?: {
  environment?: string;
}): WebPostHogInitOptions {
  const environment =
    opts?.environment ??
    process.env.NEXT_PUBLIC_SENTRY_ENVIRONMENT ??
    "development";

  return {
    ...buildAnonymousPostHogBrowserOptions({
      apiHost: webPostHogHost(),
      environment,
    }),
    person_profiles: "identified_only",
    property_denylist: [...POSTHOG_PROPERTY_DENYLIST],
    before_send: sanitizeIdentifiedPostHogCapture,
  };
}
