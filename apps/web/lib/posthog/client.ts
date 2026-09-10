import posthog from "posthog-js";
import {
  canStartLivePostHogInit,
  isAnalyticsCaptureOptedOut,
  setLivePostHogAdapter,
} from "@repo/observability/identified-posthog";
import { buildWebPostHogInitOptions, webPostHogKey } from "./config";

/**
 * Init exactly once. No-op without `NEXT_PUBLIC_POSTHOG_KEY`. Tests bind a
 * memory adapter (or mock `posthog-js`) so they never open a transport.
 *
 * Synchronous on purpose: `instrumentation-client.ts` must finish before
 * React hydration, the same reason Sentry.init is not dynamically imported.
 * Identify / groups / opt-out / the marker live in
 * `@repo/observability/identified-posthog`.
 */
export function initWebPostHog(): void {
  if (!canStartLivePostHogInit()) return;
  const key = webPostHogKey();
  if (!key) return;
  if (typeof window === "undefined") return;
  posthog.init(key, buildWebPostHogInitOptions());
  setLivePostHogAdapter({
    identify(distinctId) {
      posthog.identify(distinctId);
    },
    reset() {
      posthog.reset();
    },
    group(groupType, groupKey) {
      posthog.group(groupType, groupKey);
    },
    resetGroups() {
      posthog.resetGroups();
    },
    optOutCapturing() {
      posthog.opt_out_capturing();
    },
    optInCapturing() {
      posthog.opt_in_capturing();
    },
    stopSessionRecording() {
      posthog.stopSessionRecording();
    },
    capture(event, properties) {
      if (isAnalyticsCaptureOptedOut()) return;
      posthog.capture(event, properties);
    },
    getSessionId: () => posthog.get_session_id() || undefined,
    getReplayId: () =>
      posthog.sessionRecordingStarted()
        ? posthog.get_session_id() || undefined
        : undefined,
    getDistinctId: () => posthog.get_distinct_id() || undefined,
    isFeatureEnabled: (flag) => posthog.isFeatureEnabled(flag) ?? undefined,
  });
}
