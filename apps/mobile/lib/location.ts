import { MemberFacingError } from "@repo/hooks/error-copy";
import * as Location from "expo-location";

/**
 * Foreground-only location, in one place.
 *
 * Two surfaces need a position fix — s18 check-in and s10 study sessions — and
 * both are bound by the same hard rule: `spec/ui/design-system/README.md` §2
 * bans background location outright ("Never. Location is foreground-only") on
 * *every* surface, and `spec/ui/mobile/patterns.md` § Study sessions repeats it
 * as "a binding ban, not an optimization". So this module only ever reaches for
 * `requestForegroundPermissionsAsync`; the "Always" variant appears nowhere in
 * the app, and centralising the call is what keeps it that way.
 *
 * Accuracy is `Balanced` for the same reason at both call sites: the server
 * checks a building-scale polygon, so `High` buys precision nobody reads and
 * costs battery a five-minute heartbeat cannot afford.
 */

export type LocationFix = {
  lat: number;
  lng: number;
  /**
   * Device-reported GPS accuracy in meters. Present only when the provider
   * gave a usable reading. Heartbeat is the only study DTO that declares this
   * field; start, resume, and event check-in must send `latLngOf(fix)` because
   * the API ValidationPipe forbids undeclared keys.
   */
  accuracy_meters?: number;
};

/**
 * Coordinates only — for POSTs whose DTO does not declare `accuracy_meters`.
 *
 * Spreading a `LocationFix` into those bodies 400s once the device reports
 * accuracy (`forbidNonWhitelisted`).
 */
export function latLngOf(fix: LocationFix): { lat: number; lng: number } {
  return { lat: fix.lat, lng: fix.lng };
}

/**
 * Usable GPS accuracy in meters, or `undefined` when the provider did not
 * report one.
 *
 * Some Android providers return `null` (and occasionally `0`) for accuracy.
 * Sending `0` would look like a perfect fix and skip the optional-field
 * semantics the server documents: omit → skip the 100m floor; a number →
 * enforce it (`spec/behavior/study-sessions.md`).
 */
export function accuracyMetersOf(
  accuracy: number | null | undefined,
): number | undefined {
  if (
    typeof accuracy !== "number" ||
    !Number.isFinite(accuracy) ||
    accuracy <= 0
  ) {
    return undefined;
  }
  return accuracy;
}

export type ForegroundPermission = {
  granted: boolean;
  /**
   * False once the OS will no longer show its prompt — the member has to change
   * it in Settings. Callers need this to write honest recovery copy: "allow
   * location access" is a dead end when nothing will ask again.
   */
  canAskAgain: boolean;
};

/**
 * The current permission, **without** prompting.
 *
 * s10's primer has to know whether a prompt is even going to appear before it
 * decides to explain one (`patterns.md`: the primer is contextual, shown on the
 * first Start-session tap). Asking first and explaining afterwards is the exact
 * cold-prompt pattern that rule exists to prevent.
 */
export async function readForegroundPermission(): Promise<ForegroundPermission> {
  const permission = await Location.getForegroundPermissionsAsync();
  return { granted: permission.granted, canAskAgain: permission.canAskAgain };
}

/** Prompt for While-Using permission. Never the Always variant. */
export async function requestForegroundPermission(): Promise<ForegroundPermission> {
  const permission = await Location.requestForegroundPermissionsAsync();
  return { granted: permission.granted, canAskAgain: permission.canAskAgain };
}

/**
 * How hard to try for a fix. `balanced` is the default: the drawn-zone and
 * study checks are building-scale. `high` is for a check against another
 * phone's position (check-in near the QR screen, #4532): on iOS `Balanced`
 * means "within 100 m", which is the whole radius, so the screen and the
 * member each ask for one GPS fix instead.
 */
export type FixPrecision = "balanced" | "high";

/** One position fix. Assumes permission is already granted. */
export async function readForegroundFix(
  precision: FixPrecision = "balanced",
): Promise<LocationFix> {
  const position = await Location.getCurrentPositionAsync({
    accuracy:
      precision === "high"
        ? Location.Accuracy.High
        : Location.Accuracy.Balanced,
  });
  const accuracy_meters = accuracyMetersOf(position.coords.accuracy);
  return accuracy_meters === undefined
    ? { lat: position.coords.latitude, lng: position.coords.longitude }
    : {
        lat: position.coords.latitude,
        lng: position.coords.longitude,
        accuracy_meters,
      };
}

/**
 * Permission-then-fix, throwing the caller's own copy on refusal.
 *
 * The message is a parameter rather than a constant because the two callers owe
 * the member different explanations — `writing.md` §Errors asks for what failed,
 * why, and what to do next, and "why" is check-in for one and the zone check for
 * the other.
 */
export const LOCATION_UNAVAILABLE =
  "Couldn't find your location. Turn on location services and try again.";

export async function requireForegroundFix(
  deniedMessage: string,
  precision: FixPrecision = "balanced",
): Promise<LocationFix> {
  const permission = await requestForegroundPermission();
  if (!permission.granted) throw new MemberFacingError(deniedMessage);
  try {
    return await readForegroundFix(precision);
  } catch {
    // Location services off, or no fix in time: the platform's own error
    // names neither, and the member's fix is the same for both.
    throw new MemberFacingError(LOCATION_UNAVAILABLE);
  }
}

/**
 * A fix if the phone will give one, without insisting: prompts for While-Using
 * permission the first time, and resolves to `null` when it is refused or no
 * fix comes. For checks the server decides on its own (the QR screen's
 * distance check, #4532): the member's scan still goes, and the server says
 * whether a location was needed.
 */
export async function tryForegroundFix(
  precision: FixPrecision = "balanced",
): Promise<{ fix: LocationFix | null; permission: ForegroundPermission }> {
  let permission: ForegroundPermission;
  try {
    permission = await requestForegroundPermission();
  } catch {
    return { fix: null, permission: { granted: false, canAskAgain: false } };
  }
  if (!permission.granted) return { fix: null, permission };
  try {
    return { fix: await readForegroundFix(precision), permission };
  } catch {
    return { fix: null, permission };
  }
}
