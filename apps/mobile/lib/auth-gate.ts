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
 * - `custom_access_token_hook` is not enabled in production yet (#805 is open
 *   and `[human]`), so **no** token carries the claim today.
 * - `ChapterGuard.resolveChapterContext` (apps/api) treats that as normal: with
 *   neither claim nor `x-chapter-id` it auto-resolves a sole membership
 *   server-side, which is why single-chapter members work fine right now.
 * - `docs/internal/ops/DB_ROLLBACK_PLAYBOOK.md` makes *disabling* that hook the
 *   first mitigation for an auth incident, on the stated grounds that an absent
 *   claim is safe.
 *
 * Forcing the picker on claim-absence would therefore have bricked every member
 * in the current production configuration — and again during any incident that
 * followed the playbook — because activating a chapter cannot produce a claim
 * while the hook is off, so the picker could never satisfy its own gate.
 *
 * So the claim is treated as an optimization, not a requirement: when it is
 * absent the app proceeds and lets the API resolve context. The picker stays a
 * deliberate destination (reached from the More hub) rather than a forced one.
 * Once #805 lands, promoting it back to automatic is a small, safe change —
 * tracked as a follow-up.
 */
export type AuthGateDestination = "hold" | "sign-in" | "tabs";

export type AuthGateInput = {
  status: "hydrating" | "authenticated" | "unauthenticated";
  chapterId: string | null;
  isChapterResolving: boolean;
};

export function resolveAuthGate({
  status,
  chapterId,
  isChapterResolving,
}: AuthGateInput): AuthGateDestination {
  if (status === "hydrating") {
    return "hold";
  }

  if (status === "unauthenticated") {
    return "sign-in";
  }

  // A known chapter wins over an in-flight read, and the order matters. The
  // claim is re-read on every token change — the hourly auto-refresh, every
  // foreground, and every chapter switch — and `hold` renders nothing, so
  // holding whenever a read is in flight would unmount the entire tab navigator
  // roughly once an hour, dumping the member back on the Chat tab and losing
  // composer text and scroll position. Resolving only ever *confirms* or
  // *changes* a chapter we already have; it is not a reason to blank the app.
  if (chapterId) {
    return "tabs";
  }

  // Hold only on the very first read, so the app does not paint a frame of the
  // wrong thing before the claim lands.
  if (isChapterResolving) {
    return "hold";
  }

  // Resolved, and there is no claim. Proceed anyway — see the note above.
  return "tabs";
}
