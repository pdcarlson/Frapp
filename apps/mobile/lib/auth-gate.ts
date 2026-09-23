/**
 * The single decision behind both routing gates.
 *
 * `(auth)/_layout.tsx` and `(tabs)/_layout.tsx` have to agree exactly, because
 * each redirects into the other's territory: if both ever decide to redirect
 * for the same state, the app ping-pongs between them forever. Keeping the
 * conditionals inline in two files made that agreement a matter of remembering
 * to edit both, so the decision lives here once and each layout only chooses
 * how to render it.
 *
 * ## Why a missing chapter claim is NOT a destination
 *
 * An earlier draft routed a member with no `active_chapter_id` claim straight
 * to the chapter picker. That is wrong while the claim is optional, and it
 * would have been an outage rather than a bug:
 *
 * - The hook is enabled on both hosted projects (#805's dashboard toggle,
 *   verified 2026-09-07 via Management API). It still issues no claim when the user
 *   has no membership — production is in that state until the first onboard
 *   — and `docs/internal/ops/DB_ROLLBACK_PLAYBOOK.md` still disables the hook as the first
 *   auth-incident mitigation, which returns every token to claim-absence.
 * - `ChapterGuard.resolveChapterContext` (apps/api) treats that as normal: with
 *   neither claim nor `x-chapter-id` it auto-resolves a sole membership
 *   server-side, which is why single-chapter members work with or without the
 *   claim.
 *
 * Forcing the picker on claim-absence would therefore brick every member with
 * no chapter, and every member during an incident that followed the playbook,
 * because the picker could not satisfy its own gate until a later token
 * carried the claim.
 *
 * So the claim is treated as an optimization, not a requirement: when it is
 * absent the app proceeds and lets the API resolve context. The picker stays a
 * deliberate destination (reached from the More hub) rather than a forced one.
 *
 * ## First-run (s03) and join (s02)
 *
 * `has_completed_onboarding` on the member row is what sends a new member to
 * s03 rather than the tabs. That flag is not on the JWT — it comes from
 * `GET /v1/chapters`. A missing claim must still not be fatal, but an
 * *authenticated* session with zero memberships is join, and a membership whose
 * onboarding flag is false is welcome. See `lib/onboarding/membership.ts`.
 *
 * ## Terms (#2302)
 *
 * A member who hasn't accepted the Terms version the server enforces is asked
 * before anything else a member can reach, first-run included, because Apple
 * 1.2 expects the person posting to have agreed first. The server decides
 * (`GET /v1/users/me/legal-acceptance`), never a compiled-in version, so an
 * old binary can't disagree with it. A user with no membership isn't sent
 * here: the join screen and the create-chapter wizard carry the checkbox
 * themselves. Like memberships, a failed read fails open to tabs, so an
 * outage of that endpoint can't lock every member out of the app.
 */
import { needsFirstRun } from "./onboarding/membership";

export type AuthGateDestination =
  | "hold"
  | "sign-in"
  | "join"
  | "terms"
  | "welcome"
  | "tabs";

export type AuthGateMembership = {
  chapter_id: string;
  has_completed_onboarding: boolean;
};

export type AuthGateInput = {
  status: "hydrating" | "authenticated" | "unauthenticated";
  chapterId: string | null;
  isChapterResolving: boolean;
  /**
   * Optional because `(tabs)/_layout.tsx` is frozen and still calls this with
   * only the session. Missing values behave as `idle` / `[]` — fail *open* to
   * tabs — so that layout never blanks. `AppRuntime` is what walks a member
   * *out* of the tabs onto join/welcome once `GET /v1/chapters` is in.
   *
   * `pending` is only for the first authenticated chapters read. A failed read
   * fails open to tabs so an outage of `/v1/chapters` cannot trap every member
   * on join.
   */
  membershipsStatus?: "idle" | "pending" | "success" | "error";
  memberships?: AuthGateMembership[];
  /**
   * The `GET /v1/users/me/legal-acceptance` read, with the same fail-open
   * contract as `membershipsStatus`: missing is `idle`, which never asks.
   */
  legalAcceptanceStatus?: "idle" | "pending" | "success" | "error";
  /** The server's `required`. Read only when the status is `success`. */
  legalAcceptanceRequired?: boolean;
};

/**
 * The legal-acceptance read as the gate sees it (#2302).
 *
 * An answer, once in, stands until a newer one replaces it. TanStack keeps a
 * query's `data` when a background refetch fails but flips it to `isError`,
 * so reading `isError` first would throw away a known `required: true` and
 * walk the member past the prompt. Only a first read that failed has nothing
 * to go on, and that one fails open like the memberships read.
 */
export function legalReadStatus(read: {
  authenticated: boolean;
  hasAnswer: boolean;
  isError: boolean;
}): NonNullable<AuthGateInput["legalAcceptanceStatus"]> {
  if (!read.authenticated) return "idle";
  if (read.hasAnswer) return "success";
  return read.isError ? "error" : "pending";
}

export function resolveAuthGate({
  status,
  chapterId,
  isChapterResolving,
  membershipsStatus = "idle",
  memberships = [],
  legalAcceptanceStatus = "idle",
  legalAcceptanceRequired = false,
}: AuthGateInput): AuthGateDestination {
  if (status === "hydrating") {
    return "hold";
  }

  if (status === "unauthenticated") {
    return "sign-in";
  }

  // A known chapter wins over an in-flight *claim* read, and the order matters.
  // The claim is re-read on every token change — the hourly auto-refresh, every
  // foreground, and every chapter switch — and `hold` renders nothing, so
  // holding whenever a read is in flight would unmount the entire tab navigator
  // roughly once an hour, dumping the member back on the Chat tab and losing
  // composer text and scroll position. Resolving only ever *confirms* or
  // *changes* a chapter we already have; it is not a reason to blank the app.
  if (!chapterId && isChapterResolving) {
    return "hold";
  }

  if (membershipsStatus === "pending") {
    return "hold";
  }

  if (membershipsStatus === "success") {
    if (memberships.length === 0) {
      return "join";
    }
    // Only a member is held for the Terms read, and only for its first
    // answer. Join and the wizard don't need it, and a later refetch keeps
    // its last answer, failed or not (`legalReadStatus`), so the hourly token
    // refresh can't blank the app and a failed refetch can't skip the prompt.
    if (legalAcceptanceStatus === "pending") {
      return "hold";
    }
    if (legalAcceptanceStatus === "success" && legalAcceptanceRequired) {
      return "terms";
    }
    if (needsFirstRun(memberships, chapterId)) {
      return "welcome";
    }
  }

  // Resolved, and either there is a membership that has finished onboarding,
  // the chapters read failed (fail open), or it has not been asked yet.
  return "tabs";
}
