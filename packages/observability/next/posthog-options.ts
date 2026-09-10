import {
  POSTHOG_EXCEPTION_AUTOCAPTURE,
  isPseudonymHex,
  pathOnlyAnalyticsPath,
  shouldEnablePostHogReplay,
} from "../src/index";

export { shouldEnablePostHogReplay } from "../src/index";

/**
 * Anonymous PostHog JS options shared by Next.js apps.
 *
 * Replay-off, exception autocapture off, no pageview autocapture.
 * This object has **no** `person_profiles`, identify, group, or alias
 * fields. Web and mobile add `identified_only` in their app PostHog
 * config. Landing adds `never`.
 */

export const ANONYMOUS_POSTHOG_SESSION_RECORDING = {
  maskAllInputs: true,
  maskTextSelector: "*",
  blockClass: "ph-no-capture",
} as const;

/**
 * Keys posthog-js must not attach even before `before_send`. Shared by
 * landing and identified web so the denylist cannot drift.
 */
export const POSTHOG_PROPERTY_DENYLIST = [
  "$ip",
  "ip",
  "email",
  "$email",
] as const;

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

function asPropertyMap(value: unknown): Record<string, unknown> | undefined {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    return undefined;
  }
  return value as Record<string, unknown>;
}

/**
 * Chapter (and any other) group keys may leave only as 64-hex. A raw
 * UUID or chapter id is dropped rather than forwarded.
 */
function sanitizeGroups(
  value: unknown,
): Record<string, string> | undefined {
  const rec = asPropertyMap(value);
  if (!rec) return undefined;
  const next: Record<string, string> = {};
  for (const [key, groupKey] of Object.entries(rec)) {
    if (typeof groupKey === "string" && isPseudonymHex(groupKey)) {
      next[key] = groupKey;
    }
  }
  return Object.keys(next).length > 0 ? next : undefined;
}

/**
 * Identified PostHog JS (`apps/web`) and RN (`apps/mobile`). Same path-only
 * / no-email / no-IP rules as the anonymous filter, but `$set` / `$set_once`
 * are sanitized rather than dropped, and `$groups` survive when every value
 * is 64-hex. DOM-free: RN core `before_send` uses the same CaptureEvent
 * envelope as posthog-js.
 *
 * Do not point landing at this helper — a marketing visitor must not grow a
 * person profile.
 */
export function sanitizeIdentifiedPostHogCapture<
  T extends { properties?: unknown; $set?: unknown; $set_once?: unknown },
>(cr: T | null): T | null {
  if (!cr) return null;
  const rawProps = asPropertyMap(cr.properties) ?? {};
  const properties = sanitizeAnonymousPostHogProperties(rawProps);
  const nestedSet = asPropertyMap(rawProps.$set);
  const nestedSetOnce = asPropertyMap(rawProps.$set_once);
  if (nestedSet) {
    properties.$set = sanitizeAnonymousPostHogProperties(nestedSet);
  }
  if (nestedSetOnce) {
    properties.$set_once = sanitizeAnonymousPostHogProperties(nestedSetOnce);
  }
  const groups = sanitizeGroups(rawProps.$groups);
  if (groups) properties.$groups = groups;

  const topSet = asPropertyMap(cr.$set);
  const topSetOnce = asPropertyMap(cr.$set_once);
  return {
    ...cr,
    properties,
    $set: topSet ? sanitizeAnonymousPostHogProperties(topSet) : undefined,
    $set_once: topSetOnce
      ? sanitizeAnonymousPostHogProperties(topSetOnce)
      : undefined,
  };
}
