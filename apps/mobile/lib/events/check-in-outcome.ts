import { errorCopy } from "@repo/hooks/error-copy";
import { serverMessageOf, statusOf } from "@repo/api-sdk";
import { isTransientCheckInFailure } from "@repo/hooks";
import {
  SUBSCRIPTION_REFUSAL_COPY,
  subscriptionRefusalOf,
} from "@/lib/subscription-refusal";
import { MODULE_REFUSAL_COPY, moduleRefusalOf } from "@/lib/module-refusal";

/**
 * What a member is told after a self check-in, on both surfaces that make one:
 * s18's scanner (`app/(app)/check-in.tsx`) and the chat event card
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
  | {
      kind: "error";
      message: string;
      /**
       * Whether the refusal was of this one attempt rather than of the member,
       * so it says nothing about the next code they send. `true` when the
       * code itself was refused (the server's
       * {@link CHECK_IN_CODE_REFUSED_MESSAGE} 403, or a 400 from the API's
       * validation of the scanned `token` field), and when the request may go
       * through if sent again (`@repo/hooks`' `isTransientCheckInFailure`:
       * no connection, a 5xx, an intermediary's 408/499/460, the rate
       * limit's 429). `false` for everything a typed code would meet as
       * well: where the member is (the zone, a missing or refused location),
       * the event's window, their eligibility, an event that doesn't exist,
       * and an environment with no check-in codes (the API's 503 for a
       * missing signing secret, which every check-in carrying a code meets,
       * typed or scanned). s18 clears an attempt-only line when the member
       * turns to typing a code, and keeps the rest.
       */
      attemptOnly: boolean;
    };

/** The scanner's own words when location access is refused. */
export const CHECK_IN_LOCATION_DENIED_COPY =
  "This event checks you in by location. Allow location access to check in.";

/**
 * The API's refusal of a scanned or typed code: stale, screenshotted, or
 * another event's. It carries no `code` (`@repo/api-sdk`'s `codeOf`), so the
 * message is what identifies it; a spec reads it from
 * `apps/api/src/application/services/attendance.service.ts` so the two can't
 * drift apart in silence.
 */
export const CHECK_IN_CODE_REFUSED_MESSAGE =
  "That check-in code is not valid for this event, or it has expired";

/**
 * The scanned code's field in the API's check-in body (`CheckInDto`). Its
 * validation refusals are class-validator's own messages, which start with
 * the property's name ("token must be shorter than or equal to 256
 * characters"); a spec reads the DTO to keep that true.
 */
export const CHECK_IN_TOKEN_FIELD = "token";

/** s18's success-panel title for a repeat scan (a 409): they are on the list. */
export const ALREADY_CHECKED_IN_TITLE = "You're already in";

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
 * Whether the server refused the code this attempt sent, rather than the
 * member: as stale, screenshotted or another event's (a 403), or as no code
 * at all (a 400 whose every validation line is about the scanned `token`).
 */
function refusesTheCode(error: unknown): boolean {
  const status = statusOf(error);
  if (status === 403) {
    return serverMessageOf(error) === CHECK_IN_CODE_REFUSED_MESSAGE;
  }
  if (status !== 400) return false;
  const { message } = (error ?? {}) as { message?: unknown };
  return (
    Array.isArray(message) &&
    message.length > 0 &&
    message.every(
      (line) =>
        typeof line === "string" && line.startsWith(`${CHECK_IN_TOKEN_FIELD} `),
    )
  );
}

/**
 * Whether a failure was of this attempt alone (see the `error` variant's
 * `attemptOnly`). A request with no HTTP status either never reached the
 * server, which `fetch` reports as a `TypeError`, or failed on the device
 * before it was sent, which is the location step: its refused-permission and
 * no-fix copy are `MemberFacingError`s, and those are
 * about the member's phone, so they stay. That is the one place this departs
 * from the shared rule, which counts every status-less failure as no answer.
 */
function isAttemptOnly(error: unknown): boolean {
  if (statusOf(error) === undefined) {
    return !(error instanceof Error) || error instanceof TypeError;
  }
  return refusesTheCode(error) || isTransientCheckInFailure(error);
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
    message: errorCopy(error, "Couldn't check you in."),
    attemptOnly: isAttemptOnly(error),
  };
}
