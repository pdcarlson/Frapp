import PostHog from "posthog-react-native";
import {
  SENTRY_ERROR_CORRELATED_EVENT,
  type AnalyticsIdentity,
} from "@repo/observability";
import { validatedChapterGroupId, validatedDistinctId } from "./identity";
import { buildMobilePostHogInitOptions, mobilePostHogKey } from "./config";

/**
 * The surface tests fake and production wraps. Specs bind a memory adapter
 * so they never open a network transport.
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

export function resetPostHog(): void {
  currentAdapter()?.reset();
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

const MARKER_ALLOWLIST = new Set([
  "sentry_event_id",
  "trace_id",
  "request_id",
  "route",
  "status_class",
  "release",
]);

/**
 * Product-only. Do not call this from a permission check — see `flags.ts`.
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

/**
 * The React Native SDK has no `resetGroups()`. JS `resetGroups` is
 * `register({ $groups: {} })` plus flag-group reset; this is that pair.
 */
function resetLiveGroups(client: PostHog): void {
  void client.register({ $groups: {} });
  client.resetGroupPropertiesForFlags();
}

/**
 * Init exactly once. No-op without `EXPO_PUBLIC_POSTHOG_KEY`. Tests bind a
 * memory adapter (or mock `posthog-react-native`) so they never open a
 * transport.
 */
export function initMobilePostHog(): void {
  if (testAdapter) return;
  if (liveInitialized) return;
  const key = mobilePostHogKey();
  if (!key) return;
  liveInitialized = true;
  const client = new PostHog(key, buildMobilePostHogInitOptions());
  liveAdapter = {
    identify(distinctId) {
      client.identify(distinctId);
    },
    reset() {
      client.reset();
    },
    group(groupType, groupKey) {
      client.group(groupType, groupKey);
    },
    resetGroups() {
      resetLiveGroups(client);
    },
    optOutCapturing() {
      void client.optOut();
    },
    optInCapturing() {
      void client.optIn();
    },
    stopSessionRecording() {
      void client.stopSessionRecording();
    },
    capture(event, properties) {
      if (optedOut) return;
      client.capture(
        event,
        properties as Parameters<PostHog["capture"]>[1],
      );
    },
    getSessionId: () => client.getSessionId() || undefined,
    getReplayId: () => undefined,
    getDistinctId: () => client.getDistinctId() || undefined,
    isFeatureEnabled: (flag) => client.isFeatureEnabled(flag) ?? undefined,
  };
}
