/**
 * Which JavaScript this launch is running, as PostHog super properties, so
 * every event says whether the member is on the store build or an
 * over-the-air update, and which one (docs/ops/deployment/mobile.md § 6.7,
 * "Watching an update spread").
 *
 * Sentry needs none of this: `@sentry/react-native`'s `expoContextIntegration`
 * already tags every event with `expo.updates.update_id`, the channel and the
 * runtime version, and reports an emergency launch (an update that failed to
 * start, so expo-updates fell back) as a warning.
 *
 * Pure over the values it is handed, so it is tested without a phone; the
 * caller reads them from `expo-updates`.
 */

export interface RunningUpdateSource {
  isEnabled: boolean;
  isEmbeddedLaunch: boolean;
  isEmergencyLaunch: boolean;
  updateId: string | null;
  channel: string | null;
  runtimeVersion: string | null;
  createdAt: Date | null;
}

export type AppLaunchKind =
  "store_build" | "update" | "emergency" | "development";

export interface RunningUpdateProperties {
  /** `store_build`: the JS inside the binary. `update`: an OTA update. */
  app_launch: AppLaunchKind;
  /** The update group's update id, lower-case; null on a store-build launch. */
  app_update_id: string | null;
  /** When EAS published the running update (ISO); null on a store-build launch. */
  app_update_published_at: string | null;
  app_update_channel: string | null;
  /** The runtime the binary accepts updates for (`expo.version`). */
  app_runtime_version: string | null;
}

export function runningUpdateProperties(
  source: RunningUpdateSource,
): RunningUpdateProperties {
  const launch: AppLaunchKind = !source.isEnabled
    ? "development"
    : source.isEmergencyLaunch
      ? "emergency"
      : source.isEmbeddedLaunch
        ? "store_build"
        : "update";
  const fromUpdate = launch === "update";
  return {
    app_launch: launch,
    app_update_id:
      fromUpdate && source.updateId ? source.updateId.toLowerCase() : null,
    app_update_published_at:
      fromUpdate && source.createdAt ? source.createdAt.toISOString() : null,
    app_update_channel: source.channel || null,
    app_runtime_version: source.runtimeVersion || null,
  };
}
