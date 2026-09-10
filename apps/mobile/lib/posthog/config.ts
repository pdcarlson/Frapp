import {
  POSTHOG_EXCEPTION_AUTOCAPTURE,
  shouldEnablePostHogReplay,
} from "@repo/observability";
import type { PostHogOptions, PostHogSessionReplayConfig } from "posthog-react-native";

/**
 * Write-only PostHog project token (`phc_…`). Public by design, like a Sentry
 * DSN — it authorizes ingest, not read. The salt and any personal API key stay
 * out of this bundle.
 *
 * Direct `process.env.EXPO_PUBLIC_*` member access so Expo inlines it at build
 * time. A dynamic lookup would stay `undefined` in a built app.
 *
 * **Not an Infisical entry**: there is no Infisical→EAS sync, so this is set
 * by hand in the EAS dashboard per build profile, the same way
 * `EXPO_PUBLIC_SENTRY_DSN` is.
 */
export function mobilePostHogKey(): string | undefined {
  return process.env.EXPO_PUBLIC_POSTHOG_KEY || undefined;
}

export function mobilePostHogHost(): string {
  return process.env.EXPO_PUBLIC_POSTHOG_HOST || "https://us.i.posthog.com";
}

export function isPostHogConfigured(): boolean {
  return Boolean(mobilePostHogKey());
}

export type MobilePostHogInitOptions = Pick<
  PostHogOptions,
  | "host"
  | "personProfiles"
  | "captureAppLifecycleEvents"
  | "enableSessionReplay"
  | "sessionReplayConfig"
  | "errorTracking"
  | "disableSurveys"
  | "capturePushNotificationSubscriptions"
  | "capturePushNotificationOpened"
  | "disableGeoip"
>;

/**
 * Masked replay config the app ships even while recording is off, so a later
 * flip is gated rather than inventing the mask at the same time as the sample
 * rate. `posthog-react-native-session-replay` is not a dependency.
 */
export function mobileSessionReplayConfig(): PostHogSessionReplayConfig {
  return {
    maskAllTextInputs: true,
    maskAllImages: true,
    maskAllSandboxedViews: true,
    captureLog: false,
    captureNetworkTelemetry: false,
    sampleRate: 0,
  };
}

/**
 * Options the app actually passes to `new PostHog`. Specs assert against this
 * object rather than a copy of the literals.
 */
export function buildMobilePostHogInitOptions(opts?: {
  environment?: string;
}): MobilePostHogInitOptions {
  const environment =
    opts?.environment ??
    process.env.EXPO_PUBLIC_SENTRY_ENVIRONMENT ??
    "development";
  const replayOn = shouldEnablePostHogReplay({ environment });

  return {
    host: mobilePostHogHost(),
    personProfiles: "identified_only",
    captureAppLifecycleEvents: false,
    enableSessionReplay: replayOn,
    sessionReplayConfig: mobileSessionReplayConfig(),
    errorTracking: {
      autocapture: POSTHOG_EXCEPTION_AUTOCAPTURE,
      exceptionSteps: { enabled: false },
    },
    disableSurveys: true,
    capturePushNotificationSubscriptions: false,
    capturePushNotificationOpened: false,
    disableGeoip: true,
  };
}
