import * as Location from "expo-location";
import { Platform } from "react-native";
import {
  readForegroundFix,
  requestForegroundPermission,
  type LocationFix,
} from "@/lib/location";

/**
 * Getting a check-in's location, and saying what stood in the way (2026-11-13).
 *
 * The first real QR check-in failed on both phones because no location went
 * with it: one phone had location off, and the scanner sent the check-in
 * without one after an 8-second wait, so the server refused it with a line
 * telling the member to go and fix their settings. This asks in context
 * instead, the moment the member's check-in needs a position:
 *
 * 1. **Location off for the whole phone.** Android can turn it on from inside
 *    the app (Google's "turn on location" dialog), so it is asked for there.
 *    iOS cannot; the screen offers Settings.
 * 2. **Permission.** The OS prompt the first time (While Using, never Always:
 *    `lib/location.ts`). Refused for good (iOS asks only once), the screen
 *    offers Settings, where the member can allow it and come straight back.
 * 3. **A fix.** A GPS fix, given longer than before (a cold fix indoors can
 *    take 10 to 20 seconds); then the phone's last known position if it is
 *    recent; then a coarser network fix. Only when all three come up empty is
 *    there no location.
 *
 * The caller still sends a check-in without a location when it has none: an
 * event nobody is hosting a code for, with no drawn zone, needs none, and only
 * the server knows that. When the server answers that it needed one, the
 * screen shows {@link LocationBlocker}'s fix for the reason recorded here.
 */

/** Why there is no location, which decides what the screen offers. */
export type LocationBlocker =
  /** Location Services are off for the whole phone. */
  | "services_off"
  /** The member refused, and the OS will not ask again. */
  | "denied"
  /** The member refused this time; the OS would ask again. */
  | "declined"
  /** Allowed and on, but no position came. */
  | "no_fix";

export type CheckInLocation =
  | { kind: "fix"; fix: LocationFix }
  | { kind: "none"; blocker: LocationBlocker };

/** How long the GPS fix gets before the fallbacks. */
export const CHECK_IN_GPS_TIMEOUT_MS = 15_000;
/** How long the coarse network fix gets, after the GPS one. */
export const CHECK_IN_COARSE_TIMEOUT_MS = 8_000;
/**
 * How old the phone's last known position may be. A member walks into the
 * meeting with the phone in their pocket; a position from two minutes ago is
 * still the building.
 */
export const LAST_KNOWN_MAX_AGE_MS = 120_000;
/** A last known position less sure than this is no better than none. */
export const LAST_KNOWN_MAX_ACCURACY_M = 200;

/**
 * Whether Location Services are on, after asking Android to turn them on when
 * they are off. True when the phone can't say (the read throwing): the
 * permission and fix steps below find out anyway.
 */
async function ensureServicesOn(): Promise<boolean> {
  let on: boolean;
  try {
    on = await Location.hasServicesEnabledAsync();
  } catch {
    return true;
  }
  if (on || Platform.OS !== "android") return on;
  try {
    // Google's own dialog, over the app: "For a better experience, turn on
    // device location". Resolves when the member accepts; rejects otherwise.
    await Location.enableNetworkProviderAsync();
    return true;
  } catch {
    return false;
  }
}

/** The phone's last known position, if recent and sure enough. */
async function lastKnownFix(): Promise<LocationFix | null> {
  try {
    const position = await Location.getLastKnownPositionAsync({
      maxAge: LAST_KNOWN_MAX_AGE_MS,
      requiredAccuracy: LAST_KNOWN_MAX_ACCURACY_M,
    });
    if (!position) return null;
    const accuracy = position.coords.accuracy;
    return typeof accuracy === "number" && Number.isFinite(accuracy) && accuracy > 0
      ? {
          lat: position.coords.latitude,
          lng: position.coords.longitude,
          accuracy_meters: accuracy,
        }
      : { lat: position.coords.latitude, lng: position.coords.longitude };
  } catch {
    return null;
  }
}

/**
 * A position for a check-in, prompting where the OS allows, or the reason
 * there isn't one. `warm` is a fix the screen already holds, used as is.
 */
export async function getCheckInLocation(
  warm: LocationFix | null = null,
): Promise<CheckInLocation> {
  if (warm) return { kind: "fix", fix: warm };

  if (!(await ensureServicesOn())) {
    return { kind: "none", blocker: "services_off" };
  }

  let permission;
  try {
    permission = await requestForegroundPermission();
  } catch {
    return { kind: "none", blocker: "no_fix" };
  }
  if (!permission.granted) {
    return {
      kind: "none",
      blocker: permission.canAskAgain ? "declined" : "denied",
    };
  }

  try {
    return {
      kind: "fix",
      fix: await readForegroundFix("high", CHECK_IN_GPS_TIMEOUT_MS),
    };
  } catch {
    // Fall through to the cheaper answers.
  }
  const last = await lastKnownFix();
  if (last) return { kind: "fix", fix: last };
  try {
    return {
      kind: "fix",
      fix: await readForegroundFix("balanced", CHECK_IN_COARSE_TIMEOUT_MS),
    };
  } catch {
    return { kind: "none", blocker: "no_fix" };
  }
}

/** What the screen says and offers for each blocker. */
export type LocationBlockerCopy = {
  title: string;
  body: string;
  /** The action the button takes: Android's dialog, Settings, or a retry. */
  action: "turn_on" | "settings" | "retry";
  actionLabel: string;
};

export function locationBlockerCopy(
  blocker: LocationBlocker,
  platform: typeof Platform.OS = Platform.OS,
): LocationBlockerCopy {
  switch (blocker) {
    case "services_off":
      return platform === "android"
        ? {
            title: "Turn on location",
            body: "This check-in needs to know you're at the event.",
            action: "turn_on",
            actionLabel: "Turn on location",
          }
        : {
            title: "Location is off",
            body: "Turn on Location Services in Settings > Privacy & Security, then come back here.",
            action: "settings",
            actionLabel: "Open Settings",
          };
    case "denied":
      return {
        title: "Allow location for Frapp",
        body:
          platform === "ios"
            ? "In Settings, tap Location and choose While Using the App. You'll be checked in when you come back."
            : "In Settings, tap Permissions > Location and choose Allow only while using the app. You'll be checked in when you come back.",
        action: "settings",
        actionLabel: "Open Settings",
      };
    case "declined":
      return {
        title: "Allow location to check in",
        body: "This check-in needs to know you're at the event. Frapp only reads it while you check in.",
        action: "retry",
        actionLabel: "Allow location",
      };
    case "no_fix":
      return {
        title: "Couldn't find your location",
        body: "Step near a window or outside for a moment, then try again.",
        action: "retry",
        actionLabel: "Try again",
      };
  }
}
