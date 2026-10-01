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
  const options = buildWebPostHogInitOptions();
  posthog.init(key, options);
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
      // Opting out stops replay with `stopSessionRecording()`, which sets
      // `disable_session_recording: true` for good: `opt_in_capturing()` never
      // clears it. Web is opted out on every load until the chapter read
      // answers (#2957), so restore the init-time setting first, or replay
      // would never run once it is enabled.
      posthog.set_config({
        disable_session_recording: options.disable_session_recording,
      });
      // No `$opt_in` event. An opt-in follows a settled chapter read, not a
      // person's choice, so the event would record nothing.
      posthog.opt_in_capturing({ captureEventName: false });
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
    reloadFeatureFlags: () => {
      posthog.reloadFeatureFlags();
    },
  });
}
