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

export type LocationFix = { lat: number; lng: number };

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

/** One position fix. Assumes permission is already granted. */
export async function readForegroundFix(): Promise<LocationFix> {
  const position = await Location.getCurrentPositionAsync({
    accuracy: Location.Accuracy.Balanced,
  });
  return { lat: position.coords.latitude, lng: position.coords.longitude };
}

/**
 * Permission-then-fix, throwing the caller's own copy on refusal.
 *
 * The message is a parameter rather than a constant because the two callers owe
 * the member different explanations — `writing.md` §Errors asks for what failed,
 * why, and what to do next, and "why" is check-in for one and the zone check for
 * the other.
 */
export async function requireForegroundFix(
  deniedMessage: string,
): Promise<LocationFix> {
  const permission = await requestForegroundPermission();
  if (!permission.granted) throw new Error(deniedMessage);
  return readForegroundFix();
}
