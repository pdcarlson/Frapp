import { useEffect } from "react";
import { AppState, Linking } from "react-native";
import * as Sentry from "@sentry/react-native";
import { onlineManager } from "@tanstack/react-query";
import * as Updates from "expo-updates";
import {
  LAUNCH_BACKGROUND,
  reloadScreenEmblem,
} from "@/lib/launch/launch-look";
import { isMeetingRecorderBusy } from "@/lib/minutes/recorder/session";
import { addNotificationResponseListener } from "@/lib/notifications/push";
import { createResumeUpdates, type UpdatesPort } from "./resume-updates";

/**
 * The screen a reload shows until the app draws again: the launch logo's
 * emblem on its background, with no spinner, so an update reload reads as the
 * app opening, and the launch logo the new code draws first takes over from
 * it with nothing to see (#5449, `lib/launch/launch-look.ts`). It was the
 * app's bare surface token until then (#4392); it matches the native splash
 * now, and both follow the splash when the next `expo.version` bump moves it
 * to the token.
 */
function reloadScreen() {
  const image = reloadScreenEmblem();
  return {
    backgroundColor: LAUNCH_BACKGROUND,
    ...(image ? { image, imageResizeMode: "contain" as const } : {}),
    spinner: { enabled: false },
    fade: true,
  };
}

/** expo-updates as {@link createResumeUpdates} needs it. */
export function expoUpdatesPort(): UpdatesPort {
  return {
    enabled: Updates.isEnabled && !Updates.isEmergencyLaunch,
    isUpdatePending: () => Updates.latestContext.isUpdatePending,
    // A roll-back-to-embedded directive (the "Roll back the app update"
    // workflow) reports `isAvailable: false`, and is fetched like an update.
    async checkAndFetch() {
      const check = await Updates.checkForUpdateAsync();
      if (check.isAvailable || check.isRollBackToEmbedded) {
        await Updates.fetchUpdateAsync();
      }
    },
    reload: () => Updates.reloadAsync({ reloadScreenOptions: reloadScreen() }),
  };
}

/**
 * Checks for an over-the-air update when the app comes back to the
 * foreground, and runs a downloaded one when the member returns after a real
 * absence, unless a link or a notification tap brought them back
 * (`resume-updates.ts` has the rule). Mounted once, in `AppRuntime`.
 *
 * A failed check while offline is the member's network and is not reported;
 * any other failure reaches Sentry as a warning, grouped per step.
 */
export function useResumeUpdates(): void {
  useEffect(() => {
    const resume = createResumeUpdates({
      updates: expoUpdatesPort(),
      busy: isMeetingRecorderBusy,
      now: Date.now,
      schedule(fn, ms) {
        const timer = setTimeout(fn, ms);
        return () => clearTimeout(timer);
      },
      report(error, step) {
        if (step === "check" && !onlineManager.isOnline()) return;
        Sentry.captureException(error, {
          level: "warning",
          fingerprint: ["expo-updates", step],
          tags: { "expo.updates.step": step },
        });
      },
    });
    const appState = AppState.addEventListener("change", (next) =>
      resume.onAppStateChange(next),
    );
    // A link or a notification tap that opens the app is the old bundle's to
    // handle; that return never reloads.
    const link = Linking.addEventListener("url", () => resume.onNavigated());
    const tap = addNotificationResponseListener(() => resume.onNavigated());
    return () => {
      appState.remove();
      link.remove();
      tap?.remove();
    };
  }, []);
}
