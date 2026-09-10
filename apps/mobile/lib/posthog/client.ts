import PostHog from "posthog-react-native";
import {
  canStartLivePostHogInit,
  isAnalyticsCaptureOptedOut,
  setLivePostHogAdapter,
} from "@repo/observability";
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
 * Init exactly once. No-op without `EXPO_PUBLIC_POSTHOG_KEY`. Tests bind a
 * memory adapter (or mock `posthog-react-native`) so they never open a
 * transport. Identify / groups / opt-out / the marker live in
 * `@repo/observability`.
 */
export function initMobilePostHog(): void {
  if (!canStartLivePostHogInit()) return;
  const key = mobilePostHogKey();
  if (!key) return;
  const client = new PostHog(key, buildMobilePostHogInitOptions());
  setLivePostHogAdapter({
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
      if (isAnalyticsCaptureOptedOut()) return;
      client.capture(
        event,
        properties as Parameters<PostHog["capture"]>[1],
      );
    },
    getSessionId: () => client.getSessionId() || undefined,
    getReplayId: () => undefined,
    getDistinctId: () => client.getDistinctId() || undefined,
    isFeatureEnabled: (flag) => client.isFeatureEnabled(flag) ?? undefined,
  });
}
