import {
  pickSentryErrorCorrelatedProperties,
  SENTRY_ERROR_CORRELATED_EVENT,
} from "./policy";
import { isPseudonymHex, type AnalyticsIdentity } from "./correlation";
import { validatedChapterGroupId, validatedDistinctId } from "./identity";
import { analyticsRouteTemplate } from "./analytics-path";

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
  /**
   * Record that a page or screen was opened, as the platform's own view event:
   * `$pageview` on web, `$screen` on mobile. `path` is already a route
   * template ({@link captureRouteView}).
   */
  routeView(path: string): void;
  getSessionId(): string | undefined;
  getReplayId(): string | undefined;
  getDistinctId(): string | undefined;
  isFeatureEnabled(flag: string): boolean | undefined;
  /**
   * Refetch flags for the current distinct id / groups. Memory no-ops
   * (records the call). Vendor wrappers call the SDK so a hex identify
   * does not keep anonymous-UUID flag values.
   */
  reloadFeatureFlags(): void;
}

export type MemoryPostHogCall =
  | { type: "identify"; distinctId: string }
  | { type: "reset" }
  | { type: "group"; groupType: string; groupKey: string }
  | { type: "resetGroups" }
  | { type: "optOut" }
  | { type: "optIn" }
  | { type: "stopSessionRecording" }
  | { type: "reloadFeatureFlags" }
  | { type: "capture"; event: string; properties?: Record<string, unknown> }
  | { type: "routeView"; path: string };

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
    routeView(path) {
      calls.push({ type: "routeView", path });
    },
    getSessionId: () => sessionId,
    getReplayId: () => (recording ? sessionId : undefined),
    getDistinctId: () => distinctId,
    isFeatureEnabled: () => false,
    reloadFeatureFlags() {
      calls.push({ type: "reloadFeatureFlags" });
    },
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

/**
 * A page or screen view (#3382), sent straight from the SDK like `$identify`.
 * Nothing while the chapter is opted out, and the path goes as a route
 * template ({@link analyticsRouteTemplate}): no query, no host, no record id.
 * Each `AnalyticsProvider` calls it on every route change, and again when the
 * opt-out lifts, so the screen a member is on when the chapter read answers
 * is counted.
 */
export function captureRouteView(path: string): void {
  if (optedOut) return;
  const template = analyticsRouteTemplate(path);
  if (!template) return;
  currentAdapter()?.routeView(template);
}

/**
 * One route view per visit (#3382). Call the returned function with the
 * current pathname whenever the pathname or the chapter's opt-out changes:
 * it records a visit once, as soon as capture is on, so the first route is
 * recorded when the chapter read opts in, and a gate that flips while the
 * member stays put (a chapter switch reloads the chapter read) records
 * nothing more. A route reached while opted out is still recorded if the
 * member is on it when capture turns on.
 */
export function createRouteViewRecorder(): (
  path: string | null | undefined,
) => void {
  let visit: { path: string; recorded: boolean } | null = null;
  return (path) => {
    if (!path) return;
    if (visit?.path !== path) visit = { path, recorded: false };
    if (optedOut || visit.recorded) return;
    visit.recorded = true;
    captureRouteView(path);
  };
}

/**
 * `reset()` clears the SDK's stored consent along with the identity. posthog-js
 * removes it (`consent.reset()`), PostHog core nulls its persisted `OptedOut`,
 * and both then fall back to capturing. A reset runs whenever identity is
 * missing, including while the identity read is still loading, so without this
 * it would quietly undo a chapter opt-out applied a moment earlier (#2957).
 */
function resetKeepingOptOut(adapter: PostHogAdapter): void {
  adapter.reset();
  if (optedOut) adapter.optOutCapturing();
}

export function applyAnalyticsIdentity(
  identity: AnalyticsIdentity | null | undefined,
): void {
  const adapter = currentAdapter();
  if (!adapter) return;
  const distinct = validatedDistinctId(identity);
  if (!distinct) {
    // Missing/invalid hex must not keep a prior identify (magic-link swap
    // whose next GET fails, or a settled `enabled: false` payload).
    resetKeepingOptOut(adapter);
    return;
  }
  adapter.identify(distinct);
  const groupId = validatedChapterGroupId(identity);
  if (groupId) {
    adapter.group("chapter", groupId);
  } else {
    adapter.resetGroups();
  }
  // Hex identify is not enough: the SDK still holds anonymous-UUID flags
  // until this refetch. Evaluation is settled only after this returns.
  adapter.reloadFeatureFlags();
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

/**
 * Apply the identity query result. `undefined` is still loading or a failed
 * `retry: false` fetch: treat it as empty so a same-device account swap
 * cannot keep the previous member's hex. `null` is a fetched empty payload.
 * Invalid hex also clears (via `applyAnalyticsIdentity`).
 */
export function applyFetchedObservabilityIdentity(
  fetchEnabled: boolean,
  identity: AnalyticsIdentity | null | undefined,
  setSentryUser: (user: { id: string } | null) => void,
): void {
  if (!fetchEnabled) return;
  applyObservabilityIdentity(identity ?? null, setSentryUser);
}

/**
 * Same scalar map as `TrackEventDto.properties` / `AnalyticsProperties`.
 * `unknown` is not assignable to the generated SDK body (mobile `tsc` and
 * `next build` both reject it).
 */
export type NamedAnalyticsEventProperties = {
  [key: string]: string | number | boolean | null;
};

/** The app a client names itself as; `TrackEventDto.app`. */
export type NamedAnalyticsEventApp = "web" | "mobile";

export type NamedAnalyticsEventBody = {
  name: string;
  app: NamedAnalyticsEventApp;
  chapter_id?: string;
  properties?: NamedAnalyticsEventProperties;
};

/**
 * Body for `POST /v1/analytics/events`. Named product events never go to the
 * vendor SDK. Returns `null` when a chapter id is required and missing.
 *
 * `app` is required so neither client can forget it: the API stamps it on the
 * event, which is how usage splits by platform
 * (`spec/behavior/observability.md` § Correlation schema).
 */
export function namedAnalyticsEventBody(input: {
  name: string;
  app: NamedAnalyticsEventApp;
  chapterId?: string | null;
  properties?: NamedAnalyticsEventProperties;
  requireChapter?: boolean;
}): NamedAnalyticsEventBody | null {
  if (input.requireChapter && !input.chapterId) return null;
  return {
    name: input.name,
    app: input.app,
    ...(input.chapterId ? { chapter_id: input.chapterId } : {}),
    ...(input.properties == undefined ? {} : { properties: input.properties }),
  };
}

export function resetPostHog(): void {
  const adapter = currentAdapter();
  if (adapter) resetKeepingOptOut(adapter);
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

/**
 * Product-only. Do not call this from a permission check — `can()` in
 * `@repo/validation` is the authorization input.
 *
 * Fail closed unless the bound adapter's distinct id is 64-char lowercase
 * hex — the same bar as identify. A UUID, email, or missing id must not
 * call through as enabled even if the vendor would return true.
 */
export function isProductFlagEnabled(flag: string): boolean {
  if (optedOut) return false;
  const adapter = currentAdapter();
  if (!adapter) return false;
  if (!isPseudonymHex(adapter.getDistinctId())) return false;
  return adapter.isFeatureEnabled(flag) === true;
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
  adapter.capture(
    SENTRY_ERROR_CORRELATED_EVENT,
    pickSentryErrorCorrelatedProperties(properties),
  );
}
