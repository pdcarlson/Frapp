/**
 * The "near the QR screen" check-in rule (#4532, `spec/behavior/events.md`
 * § Check-In).
 *
 * The officer's phone showing the rotating code reports where it is, and a
 * member's check-in passes when their phone is within {@link
 * CHECK_IN_SCREEN_RADIUS_M} of it, plus each phone's reported accuracy up to
 * {@link CHECK_IN_ACCURACY_ALLOWANCE_CAP_M}. So the furthest a check-in can be
 * from the screen is 91 + 50 + 50 = 191 m (about 210 yards); a member 300
 * yards away with a fresh code fails.
 *
 * The accuracy allowance is what keeps an honest member indoors from being
 * refused: phones drift 15 to 50 m inside buildings, and both phones drift.
 * The cap is what keeps a member whose phone reports a 2 km circle from
 * passing on that circle alone.
 *
 * Distance is the great-circle helper study zones use too
 * (`distanceMeters` in `@repo/validation`).
 */

import { distanceMeters } from '@repo/validation';

/** 100 yards. Paul, 2026-11-12: "within 100 yards of the person with the QR
 * code device". */
export const CHECK_IN_SCREEN_RADIUS_M = 91.44;

/**
 * A screen less precise than this can't anchor the room: a laptop or a phone
 * on Wi-Fi location is often hundreds of meters off, and anchoring there
 * would refuse members standing in front of it. Such a screen still requires
 * the code, and the officer is told distance isn't being checked.
 */
export const CHECK_IN_SCREEN_MAX_ACCURACY_M = 100;

/** The most either phone's reported accuracy adds to the radius. */
export const CHECK_IN_ACCURACY_ALLOWANCE_CAP_M = 50;

/** A reported accuracy the rule can use: a positive, finite number. */
export function usableAccuracy(
  value: number | null | undefined,
): number | null {
  return typeof value === 'number' && Number.isFinite(value) && value > 0
    ? value
    : null;
}

/**
 * Whether a screen's fix is precise enough to anchor the room. A fix with no
 * accuracy is not: nothing says how far off it is.
 */
export function canAnchorCheckIn(
  accuracyM: number | null | undefined,
): boolean {
  const accuracy = usableAccuracy(accuracyM);
  return accuracy !== null && accuracy <= CHECK_IN_SCREEN_MAX_ACCURACY_M;
}

/**
 * How check-in is guarding presence for an event, as the host screen (s22)
 * is told after each report:
 *
 * - `zone`: the event has a drawn zone, and that is the check.
 * - `screen`: this screen knows where it is, and members must be near it (or
 *   near another officer's located screen).
 * - `other_screen`: this screen can't tell where it is, but another
 *   officer's screen can, so members must be near that one.
 * - `no_location`: no screen could tell where it is, so the code is required
 *   but distance isn't checked. The host screen tells the officer once.
 * - `not_open` / `closed`: outside the check-in window; nothing is stored.
 */
export const CHECK_IN_SCREEN_CHECKS = [
  'zone',
  'screen',
  'other_screen',
  'no_location',
  'not_open',
  'closed',
] as const;
export type CheckInScreenCheck = (typeof CHECK_IN_SCREEN_CHECKS)[number];

/** A screen row that knows where it is. */
export type LocatedScreen = { lat: number; lng: number; accuracy_m: number };

/**
 * Whether a screen row has a location to anchor the room. The table stores
 * the four location fields all set or all null.
 */
export function isLocatedScreen<
  T extends {
    lat: number | null;
    lng: number | null;
    accuracy_m: number | null;
  },
>(screen: T): screen is T & LocatedScreen {
  return (
    screen.lat !== null && screen.lng !== null && screen.accuracy_m !== null
  );
}

/**
 * Whether a member's position is near enough to the screen's. A member fix
 * that reports no accuracy adds nothing to the radius.
 */
export function isNearCheckInScreen(
  screen: LocatedScreen,
  member: { lat: number; lng: number; accuracy_m?: number | null },
): boolean {
  const allowance =
    CHECK_IN_SCREEN_RADIUS_M +
    Math.min(
      usableAccuracy(screen.accuracy_m) ?? 0,
      CHECK_IN_ACCURACY_ALLOWANCE_CAP_M,
    ) +
    Math.min(
      usableAccuracy(member.accuracy_m) ?? 0,
      CHECK_IN_ACCURACY_ALLOWANCE_CAP_M,
    );
  return distanceMeters(screen, member) <= allowance;
}
