/**
 * The invite card funnel (#5663): how many people open an invite link, how
 * many start signing in from the card and with what, and how many end up in
 * the chapter, on web `/join` and the phone's join screen alike.
 *
 * The steps before sign-in have no account behind them, so they can't go
 * through `POST /v1/analytics/events`, and the PostHog SDKs stay opted out
 * until a chapter read proves the chapter allows analytics (#2957). Instead
 * each step posts to `POST /v1/invites/funnel` with the invite token, which
 * is the proof: the API finds the invite's chapter, applies that chapter's
 * opt-out, and records the step with no person attached, keyed by a random
 * visit id the card mints (`spec/behavior/observability.md` § Invite card
 * funnel). The card reports the join too, once the redeem has succeeded, so
 * a PostHog funnel from card viewed to joined counts visits, split by `app`.
 * The redeem itself carries nothing for analytics: an API rolled back to
 * before this would refuse a field it doesn't know, and the join must never
 * depend on analytics.
 */

/** The steps a card reports. Each is recorded as `invite-<step>`. */
export const INVITE_FUNNEL_STEPS = [
  "card-viewed",
  "sign-in-started",
  "email-code-sent",
  "email-code-verified",
  "joined",
  "join-failed",
  "new-link-asked",
] as const;
export type InviteFunnelStep = (typeof INVITE_FUNNEL_STEPS)[number];

/** The PostHog event name for a step the card reports. */
export function inviteFunnelEventName(step: InviteFunnelStep): string {
  return `invite-${step}`;
}

/** The ways in from the card, for `sign-in-started`. */
export const INVITE_SIGN_IN_METHODS = [
  "apple",
  "google",
  "email",
  "password",
] as const;
export type InviteSignInMethod = (typeof INVITE_SIGN_IN_METHODS)[number];

/** The card's link states, for `card-viewed` (the details endpoint's `state`). */
export const INVITE_CARD_STATES = [
  "live",
  "expired",
  "used",
  "off",
  "locked",
] as const;
export type InviteCardState = (typeof INVITE_CARD_STATES)[number];

/**
 * Why a join from the card failed, for `join-failed`, a closed set so no
 * error text reaches analytics: `gone` (410, the link died after the card
 * read it), `forbidden` (403), `rate_limited` (429), `offline` (no answer
 * while the device reads offline), `server` (5xx) and `other`.
 */
export const INVITE_JOIN_FAILURE_REASONS = [
  "gone",
  "forbidden",
  "rate_limited",
  "offline",
  "server",
  "other",
] as const;
export type InviteJoinFailureReason =
  (typeof INVITE_JOIN_FAILURE_REASONS)[number];

/** Map a failed redeem to its {@link InviteJoinFailureReason}. */
export function inviteJoinFailureReason(
  status: number | undefined,
  offline: boolean,
): InviteJoinFailureReason {
  if (status === 410) return "gone";
  if (status === 403) return "forbidden";
  if (status === 429) return "rate_limited";
  if (status !== undefined && status >= 500) return "server";
  if (status === undefined && offline) return "offline";
  return "other";
}

/** What a card sends with a step, beyond the token and visit id. */
export interface InviteFunnelStepInput {
  step: InviteFunnelStep;
  /** `sign-in-started` only. */
  method?: InviteSignInMethod;
  /** `card-viewed` only. */
  state?: InviteCardState;
  /** `card-viewed` only: whether the visitor already had an account session. */
  signed_in?: boolean;
  /** `join-failed` only. */
  reason?: InviteJoinFailureReason;
}

/**
 * The properties a step may carry, and only those: a field sent with the
 * wrong step is dropped, not recorded. The API applies this to what a client
 * sends, so the event's shape doesn't depend on the client getting it right.
 */
export function inviteFunnelProperties(
  input: InviteFunnelStepInput,
): Record<string, string | boolean> {
  switch (input.step) {
    case "card-viewed":
      return {
        ...(input.state ? { state: input.state } : {}),
        ...(typeof input.signed_in === "boolean"
          ? { signed_in: input.signed_in }
          : {}),
      };
    case "sign-in-started":
      return input.method ? { method: input.method } : {};
    case "join-failed":
      return input.reason ? { reason: input.reason } : {};
    default:
      return {};
  }
}
