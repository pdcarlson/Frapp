/**
 * Shared observability policy constants. Vendor SDK **init calls** are not
 * here — each app still calls `Sentry.init` / `posthog.init` locally.
 * Anonymous Next.js option builders live in `@repo/observability/next`.
 *
 * Values match the intended contract in `spec/behavior/observability.md`.
 * A dashboard that disagrees is a tracked bug, not a reason to change these.
 */

export { DEFAULT_TRACES_SAMPLE_RATE } from "./sample-rate";

/** Sentry error events: do not set a lower SDK `sampleRate`. */
export const SENTRY_ERROR_SAMPLE_RATE = 1;

/** Sentry Replay is not initialized on any surface. */
export const SENTRY_REPLAY_ENABLED = false;

/** PostHog exception autocapture is off in every SDK and in the project. */
export const POSTHOG_EXCEPTION_AUTOCAPTURE = false;

/**
 * Production PostHog session replay stays off until Paul approves disclosure,
 * consent, and retention. Staging may record only after masking/blocklist and
 * opt-out gates exist in code.
 */
export const POSTHOG_PRODUCTION_REPLAY_ENABLED = false;

/**
 * Session replay stays off in every environment until chat/document capture
 * is proven masked and Paul approves production replay. The production path
 * cannot turn on while {@link POSTHOG_PRODUCTION_REPLAY_ENABLED} is false.
 */
export function shouldEnablePostHogReplay(opts: {
  environment: string;
}): boolean {
  if (opts.environment === "production") {
    return POSTHOG_PRODUCTION_REPLAY_ENABLED;
  }
  return false;
}

export const OBSERVABILITY_PROVIDERS = {
  exceptions: "sentry",
  traces: "sentry",
  productAnalytics: "posthog",
  replay: "posthog",
} as const;

/**
 * Content-free PostHog timeline marker named in
 * `spec/behavior/observability.md` § Privacy and replay. Emitted from the
 * API exception filter and from a client Sentry `beforeSend` so a Sentry
 * issue can be lined up with the PostHog session. Never carry exception type,
 * stack, message, request body, or query string.
 */
export const SENTRY_ERROR_CORRELATED_EVENT = "sentry-error-correlated";

/**
 * Keys the `sentry-error-correlated` marker may carry. Unknown keys are
 * dropped rather than forwarded — exception type, stack, message, body,
 * and query string must never ride along even if a caller passes them.
 */
export const SENTRY_ERROR_CORRELATED_PROPERTY_KEYS = [
  "sentry_event_id",
  "trace_id",
  "request_id",
  "route",
  "status_class",
  "release",
] as const;

/**
 * Keep only allowlisted string properties for the timeline marker.
 */
export function pickSentryErrorCorrelatedProperties(
  properties: Record<string, unknown>,
): Record<string, string> {
  const allowed = new Set<string>(SENTRY_ERROR_CORRELATED_PROPERTY_KEYS);
  const sanitized: Record<string, string> = {};
  for (const [key, value] of Object.entries(properties)) {
    if (!allowed.has(key)) continue;
    if (typeof value !== "string" || value.length === 0) continue;
    sanitized[key] = value;
  }
  return sanitized;
}

/**
 * Default sample rate for sanitized PostHog logs (request log,
 * `security_event`, `push_delivery`). Override with `POSTHOG_LOGS_SAMPLE_RATE`.
 * This is not a pipe from Render stdout.
 */
export const DEFAULT_POSTHOG_LOGS_SAMPLE_RATE = 1;
