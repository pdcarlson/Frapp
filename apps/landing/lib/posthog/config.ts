import {
  POSTHOG_EXCEPTION_AUTOCAPTURE,
  shouldEnablePostHogReplay,
  stripAuthority,
} from "@repo/observability";
import type { CaptureResult, PostHogConfig } from "posthog-js";

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

/**
 * Path-only URL for analytics. Query, fragment, and authority never leave.
 * `/join?token=` is recorded as `/join` or dropped by the capture helper.
 */
export function pathOnlyForLandingAnalytics(
  value: string,
): string | undefined {
  const withoutHash = value.split("#")[0] ?? "";
  const withoutQuery = withoutHash.split("?")[0] ?? "";
  if (!withoutQuery) return undefined;
  const path = stripAuthority(withoutQuery);
  if (!path.startsWith("/")) return undefined;
  if (path.includes("?") || path.includes("#")) return undefined;
  return path;
}

const EMAIL_RE = /[^\s@]+@[^\s@]+\.[^\s@]+/;

function looksLikeUrlOrPath(value: string): boolean {
  return (
    value.startsWith("/") ||
    /^[a-zA-Z][a-zA-Z0-9+.-]*:\/\//.test(value)
  );
}

/**
 * Last-line property filter the SDK runs on every capture, including automatic
 * `$current_url` / `$ip` the library would otherwise attach from `window`.
 */
export function sanitizeLandingPostHogProperties(
  properties: Record<string, unknown>,
): Record<string, unknown> {
  const next: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(properties)) {
    if (
      key === "$ip" ||
      key === "ip" ||
      key === "email" ||
      key === "$email" ||
      key === "$set" ||
      key === "$set_once"
    ) {
      continue;
    }
    if (value !== null && typeof value === "object") {
      continue;
    }
    if (typeof value === "string") {
      if (looksLikeUrlOrPath(value)) {
        const path = pathOnlyForLandingAnalytics(value);
        if (path) next[key] = path;
        continue;
      }
      if (EMAIL_RE.test(value)) continue;
      const cut = value.split("#")[0]?.split("?")[0] ?? value;
      next[key] = cut;
      continue;
    }
    next[key] = value;
  }
  return next;
}

export function sanitizeLandingCapture(
  cr: CaptureResult | null,
): CaptureResult | null {
  if (!cr) return null;
  return {
    ...cr,
    properties: sanitizeLandingPostHogProperties(
      (cr.properties ?? {}) as Record<string, unknown>,
    ),
    $set: undefined,
    $set_once: undefined,
  };
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
 * Options the app actually passes to `posthog.init`. Specs assert against
 * this object rather than a copy of the literals.
 *
 * Pageviews are captured manually with a path-only `$pathname` so the SDK's
 * default `$pageview` cannot ship `/join?token=`. Feature flags are disabled:
 * landing has no product flags and flags are not authorization.
 *
 * `person_profiles: "never"` and `cross_subdomain_cookie: false` keep this
 * visitor out of `app.frapp.live`'s identified person (ADR-22).
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
  const replayOn = shouldEnablePostHogReplay({ environment });

  return {
    api_host: landingPostHogHost(),
    autocapture: false,
    capture_pageview: false,
    capture_pageleave: false,
    capture_exceptions: POSTHOG_EXCEPTION_AUTOCAPTURE,
    capture_heatmaps: false,
    disable_session_recording: !replayOn,
    person_profiles: "never",
    cross_subdomain_cookie: false,
    advanced_disable_feature_flags: true,
    property_denylist: ["$ip", "ip", "email", "$email"],
    before_send: sanitizeLandingCapture,
    session_recording: {
      maskAllInputs: true,
      maskTextSelector: "*",
      blockClass: "ph-no-capture",
    },
  };
}
