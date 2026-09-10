import {
  POSTHOG_PROPERTY_DENYLIST,
  buildAnonymousPostHogBrowserOptions,
  sanitizeAnonymousPostHogCapture,
} from "@repo/observability/next";
import type { PostHogConfig } from "posthog-js";

/**
 * Write-only PostHog project token (`phc_…`). Same Infisical
 * `${POSTHOG_API_KEY}` as `apps/web` — one PostHog project per environment.
 * Direct `process.env.NEXT_PUBLIC_*` member access so Next inlines it.
 */
export function landingPostHogKey(): string | undefined {
  return process.env.NEXT_PUBLIC_POSTHOG_KEY || undefined;
}

export function landingPostHogHost(): string {
  return process.env.NEXT_PUBLIC_POSTHOG_HOST || "https://us.i.posthog.com";
}

export function isPostHogConfigured(): boolean {
  return Boolean(landingPostHogKey());
}

export type LandingPostHogInitOptions = Pick<
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
  | "cross_subdomain_cookie"
  | "advanced_disable_feature_flags"
  | "property_denylist"
  | "before_send"
>;

/**
 * Landing-only extras on the anonymous Next PostHog options.
 *
 * `person_profiles: "never"` and `cross_subdomain_cookie: false` keep this
 * visitor out of `app.frapp.live`'s identified person (ADR-22). Feature flags
 * stay off: landing has no product flags and flags are not authorization.
 *
 * Do not pass PostHog `defaults: '2026-01-30'` — that pack can enable
 * exception autocapture.
 */
export function buildLandingPostHogInitOptions(opts?: {
  environment?: string;
}): LandingPostHogInitOptions {
  const environment =
    opts?.environment ??
    process.env.NEXT_PUBLIC_SENTRY_ENVIRONMENT ??
    "development";

  return {
    ...buildAnonymousPostHogBrowserOptions({
      apiHost: landingPostHogHost(),
      environment,
    }),
    person_profiles: "never",
    cross_subdomain_cookie: false,
    advanced_disable_feature_flags: true,
    property_denylist: [...POSTHOG_PROPERTY_DENYLIST],
    before_send: sanitizeAnonymousPostHogCapture,
  };
}
