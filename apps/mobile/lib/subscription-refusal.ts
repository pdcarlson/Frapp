/**
 * Subscription refusals, told to a member rather than to an officer.
 *
 * WHY THIS EXISTS (#2297). Chapter creation is open to any authenticated user
 * and a fresh chapter is `subscription_status 'incomplete'`, so a founder can
 * reach every screen and then fail every write. `ChapterGuard.enforceSubscription`
 * refuses those writes permanently, and until this module existed the three
 * write surfaces rendered the refusal as an ordinary save failure and invited a
 * retry that can never succeed. That is the Guideline 2.1 finding: the app
 * blamed the save instead of explaining the state.
 *
 * WHAT THE COPY MAY NOT SAY. `apps/mobile/store/README.md:32` and `:179` are
 * the submitted App Store Connect answers: the app has **no in-app purchases**
 * and chapter subscriptions "are bought on the web dashboard and are not
 * offered, linked or mentioned in the app". So none of this copy names a price,
 * a plan, a purchase path or a link — it points at a chapter officer, who is
 * the actor who can actually resolve it. Adding a Subscribe button or a
 * deep link here trades a 2.1 finding for a 3.1.1 one.
 *
 * This also *removes* purchase-path copy that shipped before: `check-in.tsx`
 * and `lib/study/errors.ts` relayed the server's own message on their 403
 * arms, which for an `incomplete` chapter reads "…complete checkout to use
 * this feature."
 *
 * THE GATE IS WRITES-ONLY. `chapter.guard.ts:211` returns early for
 * `GET/HEAD/OPTIONS`, so reads are never refused and no read surface needs a
 * branch here. A gate state rendered on a *read* error would be dead code for
 * this issue and actively harmful — the 403s that do reach reads are
 * `PermissionsGuard` denials and the `chapter.context.*` family, which recover
 * on their own and must keep their retry.
 */

import { serverMessageOf, statusOf } from "@repo/api-sdk";
import {
  subscriptionRefusalFromServerMessage,
  type SubscriptionRefusal,
} from "@repo/validation";

/**
 * Is this failure the subscription gate refusing a write?
 *
 * Two conditions, and neither alone is sufficient:
 *
 * - **403.** The guard throws `ForbiddenException`. This narrows the field
 *   cheaply, but it is emphatically *not* the discriminator on its own —
 *   these same write routes 403 for `PermissionsGuard` denials (`No roles
 *   assigned`, a custom role missing `members:view`; both controllers carry a
 *   **class-level** `@RequirePermissions`) and for the `chapter.context.*`
 *   family, which a stale `active_chapter_id` produces for up to the 3600s
 *   JWT lifetime. Every one of those recovers by itself, so treating a bare
 *   403 as a permanent gate would delete the retry from faults that fix
 *   themselves.
 * - **An exact server message.** `AllExceptionsFilter` serialises only
 *   `{statusCode, error, message, requestId}`, so `codeOf` is `null` on every
 *   real response (#1020) and the message is all that reaches us. The match
 *   lives in `@repo/validation` against the four strings the guard throws, and
 *   a parity test keeps those in step with the guard source.
 *
 * Returns the refusal (carrying the guard's `code` and its `recoverable`
 * flag) so a caller can tell `canceled` from the recoverable states, or
 * `null` for every other failure.
 */
export function subscriptionRefusalOf(
  error: unknown,
): SubscriptionRefusal | null {
  if (statusOf(error) !== 403) return null;
  return subscriptionRefusalFromServerMessage(serverMessageOf(error));
}

/**
 * Per-surface member copy.
 *
 * `writing.md` §3 (Error copy pattern) wants each message to name what failed, why, and what
 * to do next. The "what next" is always the same actor — an officer — because
 * it is the only one a member has. Deliberately one sentence per surface
 * rather than one shared string: naming the actual blocked action is the
 * difference between an explanation and a shrug.
 */
export const SUBSCRIPTION_REFUSAL_COPY = {
  task: "Your chapter's subscription isn't active, so new tasks can't be saved. An officer can sort this out for the chapter.",
  checkIn:
    "Your chapter's subscription isn't active, so check-in isn't available. An officer can sort this out for the chapter.",
  study:
    "Your chapter's subscription isn't active, so study sessions can't be recorded. An officer can sort this out for the chapter.",
  /**
   * Pause, resume, heartbeat and stop — a session that is ALREADY RUNNING.
   *
   * Deliberately different from `study`, and the wording has been wrong in
   * both directions, so the reasoning is worth keeping.
   *
   * It must not say study "can't be recorded": the session is still active
   * server-side, and if an officer resolves the billing quickly the member's
   * time is credited in full. A member who reads "nothing was recorded" and
   * walks away loses time they would otherwise have kept.
   *
   * It must not promise the time is safe either, which is what this string
   * said first. `stop` is paid-ops on the same controller, so the member
   * cannot end the session to bank it; meanwhile every refused heartbeat
   * leaves `last_heartbeat_at` behind, and `StudyService` closes a session
   * stale by more than `HEARTBEAT_STALE_MINUTES` (10) as **EXPIRED**, which
   * `spec/behavior/study-sessions.md` says awards nothing. So "its time is
   * safe" is true for about ten minutes and false afterwards, and there is
   * nothing the member can do either way.
   *
   * What is left is the honest middle: name the state, name the actor, and
   * say the credit is at risk without implying the member can rescue it.
   *
   * It also avoids "until an officer fixes it", which would be a third wrong
   * claim: past the stale window nothing an officer does credits the session,
   * and a session that was already `paused_at` is settled `PAUSED_EXPIRED`
   * **with** points by a plain GET, so there the officer is irrelevant. "May
   * not be credited" is true in all three cases, which is why it hedges.
   */
  studySession:
    "Your chapter's subscription isn't active, so that didn't save. An officer needs to sort it out — study time tracked now may not be credited.",
} as const;
