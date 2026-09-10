import {
  SENTRY_ERROR_CORRELATED_ALLOWLIST,
  SENTRY_ERROR_CORRELATED_EVENT,
} from "./policy";
import { validatedChapterGroupId, validatedDistinctId } from "./identity";
import type { AnalyticsIdentity } from "./correlation";

/**
 * The surface tests fake and production wraps. Specs bind a memory adapter
 * so they never open a network transport. Vendor SDK construction stays in
 * each app — this is the shared identify / groups / opt-out / marker logic.
 */
export interface PostHogAdapter {
  identify(distinctId: string): void;
  reset(): void;
  group(groupType: string, groupKey: string): void;
  resetGroups(): void;
  optOutCapturing(): void;
  optInCapturing(): void;
  stopSessionRecording(): void;
  capture(event: string, properties?: Record<string, unknown>): void;
  getSessionId(): string | undefined;
  getReplayId(): string | undefined;
  getDistinctId(): string | undefined;
  isFeatureEnabled(flag: string): boolean | undefined;
}

export type MemoryPostHogCall =
  | { type: "identify"; distinctId: string }
  | { type: "reset" }
  | { type: "group"; groupType: string; groupKey: string }
  | { type: "resetGroups" }
  | { type: "optOut" }
  | { type: "optIn" }
  | { type: "stopSessionRecording" }
  | { type: "capture"; event: string; properties?: Record<string, unknown> };

export function createMemoryPostHogAdapter(): {
  adapter: PostHogAdapter;
  calls: MemoryPostHogCall[];
  setRecording: (on: boolean) => void;
} {
  const calls: MemoryPostHogCall[] = [];
  let distinctId: string | undefined;
  const sessionId = "ph_session_test";
  let recording = false;
  const adapter: PostHogAdapter = {
    identify(id) {
      distinctId = id;
      calls.push({ type: "identify", distinctId: id });
    },
    reset() {
      distinctId = undefined;
      calls.push({ type: "reset" });
    },
    group(groupType, groupKey) {
      calls.push({ type: "group", groupType, groupKey });
    },
    resetGroups() {
      calls.push({ type: "resetGroups" });
    },
    optOutCapturing() {
      calls.push({ type: "optOut" });
    },
    optInCapturing() {
      calls.push({ type: "optIn" });
    },
    stopSessionRecording() {
      recording = false;
      calls.push({ type: "stopSessionRecording" });
    },
    capture(event, properties) {
      calls.push({ type: "capture", event, properties });
    },
    getSessionId: () => sessionId,
    getReplayId: () => (recording ? sessionId : undefined),
    getDistinctId: () => distinctId,
    isFeatureEnabled: () => false,
  };
  return {
    adapter,
    calls,
    setRecording(on) {
      recording = on;
    },
  };
}

let testAdapter: PostHogAdapter | null = null;
let liveAdapter: PostHogAdapter | null = null;
let liveInitialized = false;
let optedOut = false;

export function bindPostHogAdapterForTests(
  adapter: PostHogAdapter | null,
): void {
  testAdapter = adapter;
  liveInitialized = false;
  liveAdapter = null;
  optedOut = false;
}

/**
 * True when an app may construct its vendor client. False when tests have
 * bound a memory adapter, or live init already ran.
 */
export function canStartLivePostHogInit(): boolean {
  return testAdapter === null && !liveInitialized;
}

export function setLivePostHogAdapter(adapter: PostHogAdapter): void {
  liveInitialized = true;
  liveAdapter = adapter;
}

function currentAdapter(): PostHogAdapter | null {
  return testAdapter ?? liveAdapter;
}

export function isPostHogReady(): boolean {
  return currentAdapter() !== null;
}

export function isAnalyticsCaptureOptedOut(): boolean {
  return optedOut;
}

/**
 * Chapter opt-out must stop replay and analytics immediately. Identify still
 * runs so an opt-in does not need a second identity fetch.
 */
export function applyAnalyticsOptOut(next: boolean): void {
  optedOut = next;
  const adapter = currentAdapter();
  if (!adapter) return;
  if (next) {
    adapter.optOutCapturing();
    adapter.stopSessionRecording();
    return;
  }
  adapter.optInCapturing();
}

export function applyAnalyticsIdentity(
  identity: AnalyticsIdentity | null | undefined,
): void {
  const adapter = currentAdapter();
  if (!adapter) return;
  const distinct = validatedDistinctId(identity);
  if (!distinct) return;
  adapter.identify(distinct);
  const groupId = validatedChapterGroupId(identity);
  if (groupId) {
    adapter.group("chapter", groupId);
    return;
  }
  adapter.resetGroups();
}

/**
 * Identify + Sentry `user.id` from the same validated hex. Apps pass their
 * vendor `setUser` so this package never imports a Sentry SDK.
 */
export function applyObservabilityIdentity(
  identity: AnalyticsIdentity | null | undefined,
  setSentryUser: (user: { id: string } | null) => void,
): void {
  applyAnalyticsIdentity(identity);
  const distinctId = validatedDistinctId(identity);
  setSentryUser(distinctId ? { id: distinctId } : null);
}

export function resetPostHog(): void {
  currentAdapter()?.reset();
}

/**
 * Capture a product or page event on the bound adapter. Landing uses this
 * for path-only pageviews and CTA clicks so it does not fork the singleton.
 */
export function captureAnalyticsEvent(
  event: string,
  properties?: Record<string, unknown>,
): void {
  if (optedOut) return;
  currentAdapter()?.capture(event, properties);
}

export function getPostHogDistinctId(): string | undefined {
  const id = currentAdapter()?.getDistinctId();
  return id || undefined;
}

export function getPostHogSessionId(): string | undefined {
  return currentAdapter()?.getSessionId();
}

export function getPostHogReplayId(): string | undefined {
  if (optedOut) return undefined;
  return currentAdapter()?.getReplayId();
}

const MARKER_ALLOWLIST = new Set<string>(SENTRY_ERROR_CORRELATED_ALLOWLIST);

/**
 * Product-only. Do not call this from a permission check — `can()` in
 * `@repo/validation` is the authorization input.
 */
export function isProductFlagEnabled(flag: string): boolean {
  if (optedOut) return false;
  return Boolean(currentAdapter()?.isFeatureEnabled(flag));
}

/**
 * Content-free timeline marker. Drops unknown keys rather than forwarding
 * them — exception type, stack, message, body, and query string must never
 * ride along even if a caller passes them.
 */
export function captureSentryErrorCorrelated(
  properties: Record<string, unknown>,
): void {
  if (optedOut) return;
  const adapter = currentAdapter();
  if (!adapter) return;
  const sanitized: Record<string, string> = {};
  for (const [key, value] of Object.entries(properties)) {
    if (!MARKER_ALLOWLIST.has(key)) continue;
    if (typeof value !== "string" || value.length === 0) continue;
    sanitized[key] = value;
  }
  adapter.capture(SENTRY_ERROR_CORRELATED_EVENT, sanitized);
}
