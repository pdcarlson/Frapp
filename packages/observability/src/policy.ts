/**
 * Shared observability policy constants. Vendor SDK **init** is not here —
 * each app's options module reads these and applies them locally.
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

export const OBSERVABILITY_PROVIDERS = {
  exceptions: "sentry",
  traces: "sentry",
  productAnalytics: "posthog",
  replay: "posthog",
} as const;
