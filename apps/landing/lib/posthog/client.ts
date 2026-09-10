import posthog from "posthog-js";
import {
  pathOnlyAnalyticsPath,
  pickSentryErrorCorrelatedProperties,
  SENTRY_ERROR_CORRELATED_EVENT,
} from "@repo/observability";
import { sanitizeAnonymousPostHogProperties } from "@repo/observability/next";
import {
  buildLandingPostHogInitOptions,
  landingPostHogKey,
} from "./config";
import {
  LANDING_CTA_EVENT,
  LANDING_CTA_SET,
  LANDING_CTA_SURFACE_SET,
  type LandingCta,
  type LandingCtaSurface,
} from "./events";

export type { LandingCta, LandingCtaSurface } from "./events";

/**
 * Landing never identify/alias/group. The adapter surface omits those methods
 * so a caller cannot accidentally alias a marketing visitor onto a member.
 */
export interface LandingPostHogAdapter {
  capture(event: string, properties?: Record<string, unknown>): void;
  getSessionId(): string | undefined;
  getReplayId(): string | undefined;
  getDistinctId(): string | undefined;
}

export type MemoryPostHogCall =
  | { type: "capture"; event: string; properties?: Record<string, unknown> }
  | { type: "stopSessionRecording" };

export function createMemoryPostHogAdapter(): {
  adapter: LandingPostHogAdapter;
  calls: MemoryPostHogCall[];
  setRecording: (on: boolean) => void;
  setDistinctId: (id: string | undefined) => void;
} {
  const calls: MemoryPostHogCall[] = [];
  const sessionId = "ph_session_test";
  let recording = false;
  let distinctId: string | undefined;
  const adapter: LandingPostHogAdapter = {
    capture(event, properties) {
      calls.push({ type: "capture", event, properties });
    },
    getSessionId: () => sessionId,
    getReplayId: () => (recording ? sessionId : undefined),
    getDistinctId: () => distinctId,
  };
  return {
    adapter,
    calls,
    setRecording(on) {
      recording = on;
    },
    setDistinctId(id) {
      distinctId = id;
    },
  };
}

let testAdapter: LandingPostHogAdapter | null = null;
let liveAdapter: LandingPostHogAdapter | null = null;
let liveInitialized = false;

export function bindPostHogAdapterForTests(
  adapter: LandingPostHogAdapter | null,
): void {
  testAdapter = adapter;
  liveInitialized = false;
  liveAdapter = null;
}

function currentAdapter(): LandingPostHogAdapter | null {
  return testAdapter ?? liveAdapter;
}

export function isPostHogReady(): boolean {
  return currentAdapter() !== null;
}

export function getPostHogSessionId(): string | undefined {
  return currentAdapter()?.getSessionId();
}

export function getPostHogReplayId(): string | undefined {
  return currentAdapter()?.getReplayId();
}

export function getPostHogDistinctId(): string | undefined {
  return currentAdapter()?.getDistinctId() || undefined;
}

function capture(
  event: string,
  properties: Record<string, unknown>,
): void {
  const adapter = currentAdapter();
  if (!adapter) return;
  adapter.capture(event, sanitizeAnonymousPostHogProperties(properties));
}

/**
 * Manual `$pageview`. Rejects any path that still carries a query or fragment
 * so `/join?token=` is never recorded as a URL.
 */
export function captureLandingPageview(pathname: string): void {
  if (pathname.includes("?") || pathname.includes("#")) return;
  const path = pathOnlyAnalyticsPath(pathname);
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
 * Content-free timeline marker. Drops unknown keys rather than forwarding them.
 */
export function captureSentryErrorCorrelated(
  properties: Record<string, unknown>,
): void {
  const adapter = currentAdapter();
  if (!adapter) return;
  adapter.capture(
    SENTRY_ERROR_CORRELATED_EVENT,
    pickSentryErrorCorrelatedProperties(properties),
  );
}

/**
 * Init exactly once. No-op without `NEXT_PUBLIC_POSTHOG_KEY`. Tests bind a
 * memory adapter so they never open a transport.
 */
export function initLandingPostHog(): void {
  if (testAdapter) return;
  if (liveInitialized) return;
  const key = landingPostHogKey();
  if (!key) return;
  if (typeof window === "undefined") return;
  liveInitialized = true;
  posthog.init(key, buildLandingPostHogInitOptions());
  liveAdapter = {
    capture(event, properties) {
      posthog.capture(event, properties);
    },
    getSessionId: () => posthog.get_session_id() || undefined,
    getReplayId: () =>
      posthog.sessionRecordingStarted()
        ? posthog.get_session_id() || undefined
        : undefined,
    getDistinctId: () => posthog.get_distinct_id() || undefined,
  };
}
