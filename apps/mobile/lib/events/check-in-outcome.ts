import { serverMessageOf, statusOf } from "@repo/api-sdk";
import {
  SUBSCRIPTION_REFUSAL_COPY,
  subscriptionRefusalOf,
} from "@/lib/subscription-refusal";
import { MODULE_REFUSAL_COPY, moduleRefusalOf } from "@/lib/module-refusal";

/**
 * What a member is told after a self check-in, on both surfaces that make one:
 * s18's scanner (`app/(tabs)/check-in.tsx`) and the chat event card
 * (`components/chat/event-card.tsx`). One copy, so the two can't drift into
 * telling the same member two different things about the same refusal.
 */
export type CheckInOutcome =
  /**
   * `message` is the one sentence a card line or a screen reader carries.
   * `title` and `pointsLabel` are the same words split into the lines s18's
   * success panel draws, so the panel can't restate them differently.
   */
  | {
      kind: "success";
      message: string;
      title: string;
      /** "+10 pts", or `null` for an event that awards none. */
      pointsLabel: string | null;
    }
  /** A 409: the member was already on the list. They are checked in. */
  | { kind: "already"; message: string }
  /**
   * The subscription gate (#2297) or the module gate (#2393) refused the
   * write. Terminal until an officer acts, so a caller offers no retry.
   */
  | { kind: "blocked"; message: string }
  | { kind: "error"; message: string };

/** The scanner's own words when location access is refused. */
export const CHECK_IN_LOCATION_DENIED_COPY =
  "This event checks you in by location. Allow location access to check in.";

export const ALREADY_CHECKED_IN_COPY =
  "You're already checked in for this event.";

const CHECKED_IN_TITLE = "You're checked in";

export function checkInSuccess(
  pointValue: number | null | undefined,
): Extract<CheckInOutcome, { kind: "success" }> {
  const pointsLabel = pointValue ? `+${pointValue} pts` : null;
  return {
    kind: "success",
    message: pointsLabel
      ? `${CHECKED_IN_TITLE}. ${pointsLabel}`
      : `${CHECKED_IN_TITLE}.`,
    title: CHECKED_IN_TITLE,
    pointsLabel,
  };
}

/**
 * Which outcome a failed check-in lands in.
 *
 * Neither gate refusal may fall through to the server string, which a 403
 * would otherwise relay verbatim. For an `incomplete` chapter that reads
 * "…complete checkout to use this feature.", a purchase instruction rendered
 * inside the iOS app, which the store declaration forbids. With `events`
 * switched off it reads "Re-enable it in Settings → Modules", an instruction a
 * member can't follow.
 *
 * Anything else relays the server's message, which is what explains a geofence
 * or window refusal, or the location copy a refused permission throws.
 */
export function checkInFailure(
  error: unknown,
): Exclude<CheckInOutcome, { kind: "success" }> {
  if (subscriptionRefusalOf(error)) {
    return { kind: "blocked", message: SUBSCRIPTION_REFUSAL_COPY.checkIn };
  }
  if (moduleRefusalOf(error)) {
    return { kind: "blocked", message: MODULE_REFUSAL_COPY.checkIn };
  }
  if (statusOf(error) === 409) {
    return { kind: "already", message: ALREADY_CHECKED_IN_COPY };
  }
  return {
    kind: "error",
    message: serverMessageOf(error) ?? "Couldn't check you in.",
  };
}
