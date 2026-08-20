/**
 * Client-side mirror of `ChapterGuard.enforceSubscription`
 * (`apps/api/src/interface/guards/chapter.guard.ts`).
 *
 * **Shared, deliberately.** This lived in `apps/web/lib/subscription.ts` and
 * moved here as the third client gate alongside `can` and `isModuleEnabled`.
 * `spec/ui/design-system/README.md` §5 requires every server gate to have a
 * client counterpart at the control that starts the flow. Permissions have
 * `<Can>` and modules have `isModuleEnabled`; subscription state had nothing,
 * so every subscription-gated action failed late by default (#858).
 *
 * Two properties this file deliberately keeps:
 *
 * - **Writes only.** The guard returns early for `GET/HEAD/OPTIONS`
 *   (`chapter.guard.ts:207`), so a lapsed chapter can still read everything.
 *   Callers gate write affordances; read surfaces stay untouched.
 * - **Never a security boundary.** §5 rule 5 — a direct API call bypasses all
 *   of this, and the server gate stays regardless. This exists so the user is
 *   not invited to do work that is already doomed.
 *
 * The returned `code` values are the guard's own structured codes, so client
 * and server can be diffed by grepping one string.
 */

/**
 * Same four values as `CurrentChapterPayload["subscription_status"]` /
 * `subscriptionStatusEnum` in `index.ts`. Derived from this tuple so this
 * file does not import the barrel it is re-exported from.
 */
const SUBSCRIPTION_STATUSES = [
  "incomplete",
  "active",
  "past_due",
  "canceled",
] as const;

export type SubscriptionStatus = (typeof SUBSCRIPTION_STATUSES)[number];

/**
 * Narrows an unknown value off the wire to a `SubscriptionStatus`.
 *
 * `CurrentChapterPayloadSchema` is `.passthrough()` and callers often read the
 * raw record, so the status arrives untyped. An unrecognised value means the
 * server grew a state this client does not model — treat that as "not
 * blocked", so a deploy skew never locks a chapter out of its own UI.
 */
export function isSubscriptionStatus(
  value: unknown,
): value is SubscriptionStatus {
  return (
    typeof value === "string" &&
    (SUBSCRIPTION_STATUSES as readonly string[]).includes(value)
  );
}

export type SubscriptionBlockCode =
  | "chapter.subscription.canceled"
  | "chapter.subscription.write_locked"
  | "chapter.subscription.invite_blocked"
  | "chapter.subscription.required";

/**
 * Which server-side wedge the route behind this control sits in — the client
 * half of the `@FreeTier` / `@GraceBlocked` decorators.
 *
 * - `paid` — the default. No decorator on the route, so it is paid-ops and
 *   locks on any non-`active` status.
 * - `free-tier` — `@FreeTier`. Keeps working while `incomplete`, and during
 *   the `past_due` grace window.
 * - `grace-blocked` — `@FreeTier` + `@GraceBlocked` (invite/create). Free-tier
 *   everywhere except inside the grace window, where it is blocked by name.
 */
export type SubscriptionWriteClass = "paid" | "free-tier" | "grace-blocked";

export type SubscriptionWriteState =
  | { allowed: true }
  | {
      allowed: false;
      code: SubscriptionBlockCode;
      /** The blocker, in the API's own words — §5 rule 2 names it source copy. */
      reason: string;
      /**
       * Whether the user can clear this themselves by paying. `canceled` is the
       * one state they cannot, so it gets support copy instead of a checkout
       * link that would not help.
       */
      recoverable: boolean;
    };

/**
 * A chapter that lapses to `past_due` gets a 3-day grace window before the hard
 * read-only lock (`spec/behavior/billing.md`, `spec/product/onboarding.md`).
 * Mirrors `GRACE_PERIOD_MS` in `ChapterGuard`; the two must move together.
 */
export const SUBSCRIPTION_GRACE_PERIOD_MS = 3 * 24 * 60 * 60 * 1000;

/**
 * Mirrors the guard's `isWithinGrace`, including its fail-open on a missing or
 * unparseable timestamp: an unknown lapse start is treated as "grace just
 * began", so a bad clock or a null column never hard-locks a chapter early.
 */
export function isWithinSubscriptionGrace(
  pastDueSince: string | null | undefined,
  now: number = Date.now(),
): boolean {
  if (!pastDueSince) return true;
  const lapsedAt = Date.parse(pastDueSince);
  if (Number.isNaN(lapsedAt)) return true;
  return now - lapsedAt <= SUBSCRIPTION_GRACE_PERIOD_MS;
}

const CANCELED: SubscriptionWriteState = {
  allowed: false,
  code: "chapter.subscription.canceled",
  reason: "Chapter subscription is canceled; this chapter is read-only.",
  recoverable: false,
};

const WRITE_LOCKED: SubscriptionWriteState = {
  allowed: false,
  code: "chapter.subscription.write_locked",
  reason:
    "Chapter subscription is past due; write actions are blocked until payment is resolved.",
  recoverable: true,
};

const INVITE_BLOCKED: SubscriptionWriteState = {
  allowed: false,
  code: "chapter.subscription.invite_blocked",
  reason:
    "Chapter subscription is past due; new invites are blocked until payment is resolved.",
  recoverable: true,
};

const REQUIRED: SubscriptionWriteState = {
  allowed: false,
  code: "chapter.subscription.required",
  reason:
    "Chapter subscription is not active; complete checkout to use this feature.",
  recoverable: true,
};

const ALLOWED: SubscriptionWriteState = { allowed: true };

/**
 * Would a write to a route in `writeClass` be rejected by `ChapterGuard` right
 * now? Branch-for-branch the same order as `enforceSubscription`, because the
 * two only stay in step if they are read side by side.
 *
 * Routes marked `@SubscriptionExempt()` never reach this — the caller simply
 * does not gate them. `POST /v1/invoices/:id/payment-intent` is the live
 * example: paying an existing invoice stays available while `incomplete`.
 */
export function subscriptionWriteState(input: {
  status: SubscriptionStatus;
  pastDueSince?: string | null;
  writeClass?: SubscriptionWriteClass;
  now?: number;
}): SubscriptionWriteState {
  const { status, pastDueSince = null, writeClass = "paid", now } = input;

  if (status === "canceled") return CANCELED;
  if (status === "active") return ALLOWED;

  const isFreeTier = writeClass === "free-tier" || writeClass === "grace-blocked";

  // past_due is grace-aware, and the window is evaluated before the free-tier
  // check so invite/create stays blocked during grace and every write stops
  // after it.
  if (status === "past_due") {
    if (isWithinSubscriptionGrace(pastDueSince, now)) {
      if (writeClass === "grace-blocked") return INVITE_BLOCKED;
      if (isFreeTier) return ALLOWED;
    }
    return WRITE_LOCKED;
  }

  if (isFreeTier) return ALLOWED;
  if (status === "incomplete") return REQUIRED;

  return ALLOWED;
}
