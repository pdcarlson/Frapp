import { serverMessageOf, statusOf } from "@repo/api-sdk";
import { errorCopy } from "@repo/hooks";
import type { NativePlatform } from "@repo/validation";

/**
 * Where the browser put this person, or why it couldn't say.
 *
 * `denied` is the person (or the browser's site setting) saying no; it stays
 * no until they change the setting, so the page tells them where. Anything
 * else (no fix in time, no geolocation at all, an insecure page) is
 * `unavailable`.
 */
export type BrowserFix =
  | { kind: "fix"; lat: number; lng: number; accuracy?: number }
  | { kind: "denied" }
  | { kind: "unavailable" };

/** The options the check-in asks the browser with: one fresh, precise fix. */
export const CHECK_IN_GEOLOCATION_OPTIONS: PositionOptions = {
  enableHighAccuracy: true,
  timeout: 15_000,
  maximumAge: 60_000,
};

/**
 * One location read. Never rejects: a refusal or a missing API is an answer,
 * because the check-in still goes out without coordinates and the server says
 * whether this event needed them.
 */
export function readBrowserLocation(): Promise<BrowserFix> {
  const geolocation =
    typeof navigator !== "undefined" ? navigator.geolocation : undefined;
  if (!geolocation) return Promise.resolve({ kind: "unavailable" });
  return new Promise((resolve) => {
    try {
      geolocation.getCurrentPosition(
        (position) => {
          const { latitude, longitude, accuracy } = position.coords;
          if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) {
            resolve({ kind: "unavailable" });
            return;
          }
          resolve({
            kind: "fix",
            lat: latitude,
            lng: longitude,
            accuracy:
              Number.isFinite(accuracy) && accuracy > 0 ? accuracy : undefined,
          });
        },
        (error) =>
          resolve({
            // 1 is PERMISSION_DENIED; the constant isn't on every runtime.
            kind: error?.code === 1 ? "denied" : "unavailable",
          }),
        CHECK_IN_GEOLOCATION_OPTIONS,
      );
    } catch {
      resolve({ kind: "unavailable" });
    }
  });
}

/** The API's refusal for a code that rotated out (`AttendanceService.checkIn`). */
export const EXPIRED_CODE_SERVER_MESSAGE =
  "That check-in code is not valid for this event, or it has expired";

export const EXPIRED_CODE_COPY =
  "That code has changed since you scanned it. Point your camera at the screen again.";

/** What a refused check-in leaves the page saying. */
export type CheckInFailure =
  /** The code rotated out while they signed in, or was never this event's. */
  | { kind: "expired" }
  /** The event checks location and none went with the request. */
  | { kind: "needs-location"; fix: "denied" | "unavailable" }
  | { kind: "other"; message: string };

/**
 * The server's 400 for a check-in that needed coordinates: the drawn zone's
 * ("This event checks you in by location…") and the located screen's ("This
 * check-in needs your location…"). Read by status and the word, so a reworded
 * sentence still lands here rather than on a generic failure.
 */
function isLocationRefusal(error: unknown): boolean {
  if (statusOf(error) !== 400) return false;
  return /\blocation\b/i.test(serverMessageOf(error) ?? "");
}

export function checkInFailure(
  error: unknown,
  fix: BrowserFix["kind"],
): CheckInFailure {
  const status = statusOf(error);
  if (
    status === 403 &&
    serverMessageOf(error)?.trim() === EXPIRED_CODE_SERVER_MESSAGE
  ) {
    return { kind: "expired" };
  }
  if (isLocationRefusal(error)) {
    return {
      kind: "needs-location",
      fix: fix === "denied" ? "denied" : "unavailable",
    };
  }
  return {
    kind: "other",
    message: errorCopy(error, "Couldn't check you in. Try again in a moment."),
  };
}

/**
 * Where to turn location back on for this site, in the browser this phone
 * most likely runs: Safari on an iPhone, Chrome everywhere else.
 */
export function allowLocationSteps(platform: NativePlatform | null): string {
  if (platform === "ios") {
    return "In Safari, tap aA in the address bar, then Website Settings, and set Location to Allow.";
  }
  return "In Chrome, tap the lock icon next to the address, then Permissions, and turn on Location.";
}

export function locationHelpCopy(
  fix: "denied" | "unavailable",
  platform: NativePlatform | null,
): string {
  if (fix === "denied") {
    return `This check-in needs your location. ${allowLocationSteps(platform)}`;
  }
  return platform === "ios"
    ? "This check-in needs your location, and your phone couldn't find it. Check that Location Services is on in Settings, then try again."
    : "This check-in needs your location, and your phone couldn't find it. Check that location is on, then try again.";
}
