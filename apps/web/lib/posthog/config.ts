import {
  POSTHOG_EXCEPTION_AUTOCAPTURE,
  shouldEnablePostHogReplay,
} from "@repo/observability";
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
>;

/**
 * Options the app actually passes to `posthog.init`. Specs assert against
 * this object rather than a copy of the literals.
 */
export function buildWebPostHogInitOptions(opts?: {
  environment?: string;
}): WebPostHogInitOptions {
  const environment =
    opts?.environment ??
    process.env.NEXT_PUBLIC_SENTRY_ENVIRONMENT ??
    "development";
  const replayOn = shouldEnablePostHogReplay({ environment });

  return {
    api_host: webPostHogHost(),
    autocapture: false,
    capture_pageview: false,
    capture_pageleave: false,
    capture_exceptions: POSTHOG_EXCEPTION_AUTOCAPTURE,
    capture_heatmaps: false,
    disable_session_recording: !replayOn,
    person_profiles: "identified_only",
    session_recording: {
      maskAllInputs: true,
      maskTextSelector: "*",
      blockClass: "ph-no-capture",
    },
  };
}
