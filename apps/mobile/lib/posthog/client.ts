import PostHog from "posthog-react-native";
import * as Updates from "expo-updates";
import {
  applyAnalyticsOptOut,
  canStartLivePostHogInit,
  isAnalyticsCaptureOptedOut,
  setLivePostHogAdapter,
} from "@repo/observability/identified-posthog";
import { runningUpdateProperties } from "@/lib/updates/running-update";
import { buildMobilePostHogInitOptions, mobilePostHogKey } from "./config";

/**
 * The React Native SDK has no `resetGroups()`. JS `resetGroups` is
 * `register({ $groups: {} })` plus flag-group reset; this is that pair.
 */
function resetLiveGroups(client: PostHog): void {
  void client.register({ $groups: {} });
  client.resetGroupPropertiesForFlags();
}

/**
 * Every event says which JavaScript this launch runs: the store build or an
 * over-the-air update, and which (`lib/updates/running-update.ts`). Super
 * properties persist, and `reset()` clears them, so this runs at init and
 * after every reset.
 */
function registerRunningUpdate(client: PostHog): void {
  void client.register({
    ...runningUpdateProperties({
      isEnabled: Updates.isEnabled,
      isEmbeddedLaunch: Updates.isEmbeddedLaunch,
      isEmergencyLaunch: Updates.isEmergencyLaunch,
      updateId: Updates.updateId,
      channel: Updates.channel,
      runtimeVersion: Updates.runtimeVersion,
      createdAt: Updates.createdAt,
    }),
  });
}

/**
 * Init exactly once. No-op without `EXPO_PUBLIC_POSTHOG_KEY`. Tests bind a
 * memory adapter (or mock `posthog-react-native`) so they never open a
 * transport. Identify / groups / opt-out / the marker live in
 * `@repo/observability/identified-posthog`.
 */
export function initMobilePostHog(): void {
  if (!canStartLivePostHogInit()) return;
  const key = mobilePostHogKey();
  if (!key) return;
  const client = new PostHog(key, buildMobilePostHogInitOptions());
  registerRunningUpdate(client);
  setLivePostHogAdapter({
    identify(distinctId) {
      client.identify(distinctId);
    },
    reset() {
      client.reset();
      registerRunningUpdate(client);
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
      if (isAnalyticsCaptureOptedOut()) return;
      client.capture(
        event,
        properties as Parameters<PostHog["capture"]>[1],
      );
    },
    routeView(path) {
      if (isAnalyticsCaptureOptedOut()) return;
      // `path` is already a route template (#3382). `screen()` also
      // registers it as `$screen_name` for the session, so later events
      // carry the template, never a raw id.
      void client.screen(path);
    },
    getSessionId: () => client.getSessionId() || undefined,
    getReplayId: () => undefined,
    getDistinctId: () => client.getDistinctId() || undefined,
    isFeatureEnabled: (flag) => client.isFeatureEnabled(flag) ?? undefined,
    reloadFeatureFlags: () => {
      client.reloadFeatureFlags();
    },
  });
  // Opted out from the start, until `AnalyticsProvider` has the chapter's
  // answer (#3101). Init runs at module scope, before the first commit mounts
  // the provider, and the SDK otherwise starts from whatever consent the last
  // session persisted, so a chapter that opted out since could still send the
  // `sentry-error-correlated` marker in that window.
  applyAnalyticsOptOut(true);
}
