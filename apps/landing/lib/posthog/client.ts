import posthog from "posthog-js";
import { SENTRY_ERROR_CORRELATED_EVENT } from "@repo/observability";
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
  SENTRY_CORRELATION_MARKER_ALLOWLIST,
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
  adapter.capture(event, sanitizeLandingPostHogProperties(properties));
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
 * Content-free timeline marker. Drops unknown keys rather than forwarding them.
 */
export function captureSentryErrorCorrelated(
  properties: Record<string, unknown>,
): void {
  const adapter = currentAdapter();
  if (!adapter) return;
  const sanitized: Record<string, string> = {};
  for (const [key, value] of Object.entries(properties)) {
    if (!SENTRY_CORRELATION_MARKER_ALLOWLIST.has(key)) continue;
    if (typeof value !== "string" || value.length === 0) continue;
    sanitized[key] = value;
  }
  adapter.capture(SENTRY_ERROR_CORRELATED_EVENT, sanitized);
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
