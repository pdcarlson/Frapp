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
 * The states are ordered by what is knowable: session first (nothing else is
 * meaningful without it), then whether the chapter claim has finished
 * resolving, then the claim itself.
 */
export type AuthGateDestination = "hold" | "sign-in" | "picker" | "tabs";

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

  // `chapterId` reads null both before the claim resolves and after it resolves
  // to "no chapter". Deciding during the first would send every member through
  // the picker on each cold start, so hold until the read lands.
  if (isChapterResolving) {
    return "hold";
  }

  // No claim means a multi-chapter member has never chosen: nothing inside the
  // tab group can address a chapter, so the picker is the only way forward
  // (#764). A single-chapter member never reaches here — the access-token hook
  // resolves a sole membership server-side, so their claim is always present.
  if (!chapterId) {
    return "picker";
  }

  return "tabs";
}
