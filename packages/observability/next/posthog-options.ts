import {
  POSTHOG_EXCEPTION_AUTOCAPTURE,
  POSTHOG_PRODUCTION_REPLAY_ENABLED,
  pathOnlyAnalyticsPath,
} from "../src/index";

/**
 * Anonymous PostHog JS options shared by Next.js apps.
 *
 * Replay-off, exception autocapture off, no pageview autocapture.
 * This object has **no** `person_profiles`, identify, group, or alias
 * fields. Web adds `identified_only` in `apps/web`. Landing adds `never`.
 */

/**
 * Session replay stays off in every environment until Paul approves
 * production replay (#2038). Production cannot turn on while
 * {@link POSTHOG_PRODUCTION_REPLAY_ENABLED} is false.
 */
export function shouldEnablePostHogReplay(opts: {
  environment: string;
}): boolean {
  if (opts.environment === "production") {
    return POSTHOG_PRODUCTION_REPLAY_ENABLED;
  }
  return false;
}

export const ANONYMOUS_POSTHOG_SESSION_RECORDING = {
  maskAllInputs: true,
  maskTextSelector: "*",
  blockClass: "ph-no-capture",
} as const;

export function buildAnonymousPostHogBrowserOptions(opts: {
  apiHost: string;
  environment: string;
}) {
  const replayOn = shouldEnablePostHogReplay({
    environment: opts.environment,
  });
  return {
    api_host: opts.apiHost,
    autocapture: false as const,
    capture_pageview: false as const,
    capture_pageleave: false as const,
    capture_exceptions: POSTHOG_EXCEPTION_AUTOCAPTURE,
    capture_heatmaps: false as const,
    disable_session_recording: !replayOn,
    session_recording: ANONYMOUS_POSTHOG_SESSION_RECORDING,
  };
}

const EMAIL_RE = /[^\s@]+@[^\s@]+\.[^\s@]+/;

function looksLikeUrlOrPath(value: string): boolean {
  return (
    value.startsWith("/") || /^[a-zA-Z][a-zA-Z0-9+.-]*:\/\//.test(value)
  );
}

/**
 * Last-line property filter. Drops IP, email, `$set`, nested bodies, and
 * reduces URL-shaped strings to a path. Used by landing `before_send`.
 */
export function sanitizeAnonymousPostHogProperties(
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
        const path = pathOnlyAnalyticsPath(value);
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

export function sanitizeAnonymousPostHogCapture<
  T extends { properties?: unknown; $set?: unknown; $set_once?: unknown },
>(cr: T | null): T | null {
  if (!cr) return null;
  return {
    ...cr,
    properties: sanitizeAnonymousPostHogProperties(
      (cr.properties ?? {}) as Record<string, unknown>,
    ),
    $set: undefined,
    $set_once: undefined,
  };
}
