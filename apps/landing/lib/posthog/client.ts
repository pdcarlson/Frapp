import posthog from "posthog-js";
import {
  canStartLivePostHogInit,
  captureAnalyticsEvent,
  setLivePostHogAdapter,
} from "@repo/observability/next";
import {
  buildLandingPostHogInitOptions,
  landingPostHogKey,
  pathOnlyForLandingAnalytics,
  sanitizeLandingPostHogProperties,
} from "./config";
import {
  LANDING_CTA_EVENT,
  LANDING_CTA_SET,
  LANDING_CTA_SURFACE_SET,
  type LandingCta,
  type LandingCtaSurface,
} from "./events";

export type { LandingCta, LandingCtaSurface } from "./events";

function capture(
  event: string,
  properties: Record<string, unknown>,
): void {
  captureAnalyticsEvent(event, sanitizeLandingPostHogProperties(properties));
}

/**
 * Manual `$pageview`. Rejects any path that still carries a query or fragment
 * so `/join?token=` is never recorded as a URL.
 */
export function captureLandingPageview(pathname: string): void {
  if (pathname.includes("?") || pathname.includes("#")) return;
  const path = pathOnlyForLandingAnalytics(pathname);
  if (!path || path !== pathname) return;
  capture("$pageview", { $pathname: path, $current_url: path });
}

export function captureLandingCta(
  cta: LandingCta | string,
  surface: LandingCtaSurface | string,
): void {
  if (!LANDING_CTA_SET.has(cta) || !LANDING_CTA_SURFACE_SET.has(surface)) {
    return;
  }
  capture(LANDING_CTA_EVENT, { cta, surface });
}

/**
 * Init exactly once. No-op without `NEXT_PUBLIC_POSTHOG_KEY`. Tests bind a
 * memory adapter on `@repo/observability` so they never open a transport.
 *
 * Identify / alias / group stay no-ops. Landing visitors must not be aliased
 * onto an authenticated distinct id (ADR-22).
 */
export function initLandingPostHog(): void {
  if (!canStartLivePostHogInit()) return;
  const key = landingPostHogKey();
  if (!key) return;
  if (typeof window === "undefined") return;
  posthog.init(key, buildLandingPostHogInitOptions());
  setLivePostHogAdapter({
    identify() {},
    reset() {},
    group() {},
    resetGroups() {},
    optOutCapturing() {},
    optInCapturing() {},
    stopSessionRecording() {
      posthog.stopSessionRecording();
    },
    capture(event, properties) {
      posthog.capture(event, properties);
    },
    getSessionId: () => posthog.get_session_id() || undefined,
    getReplayId: () =>
      posthog.sessionRecordingStarted()
        ? posthog.get_session_id() || undefined
        : undefined,
    getDistinctId: () => posthog.get_distinct_id() || undefined,
    isFeatureEnabled: () => false,
  });
}
