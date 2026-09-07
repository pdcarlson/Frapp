"use client";

import { useEffect } from "react";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";
import { useChapterStore } from "@/lib/stores/chapter-store";
import { readActiveChapterClaim } from "@/lib/auth/active-chapter-claim";

/**
 * Keeps the browser's chapter selection in step with the token's
 * `active_chapter_id` claim.
 *
 * The web persisted the selected chapter only when something wrote it —
 * `useSelectChapter` from the switcher, the onboarding wizard, `/join`. On any
 * browser where none of those ran (a second device, a cleared profile, a
 * magic-link sign-in) the store was `null`, so a member with one chapter saw
 * "No chapter selected — pick a chapter to continue" while the API served
 * their data from the claim, and every chapter-scoped feature the shell gates
 * on the store — presence, the subscription panel, the chapter theme — stayed
 * off until they clicked their only chapter. A store holding a chapter the
 * member no longer has (item 26) earned a `chapter.context.mismatch` 403 on
 * every request instead.
 *
 * The claim is the authority (spec/behavior/multi-tenancy.md: it outranks the
 * `x-chapter-id` header; mobile derives its chapter from it directly), so the
 * store follows it. Reacting to auth events rather than to `hasHydrated`
 * because that flag has three documented ways to stick at `false`
 * (spec/ui/web-dashboard/README.md) — `INITIAL_SESSION` fires once the session
 * is recovered, by which point the synchronous localStorage rehydration has
 * long completed; `TOKEN_REFRESHED` covers a switch made in another tab, and
 * `useSelectChapter`'s own `refreshSession()` lands here as well, one tick
 * before it writes the same value itself.
 *
 * A token with no claim means "no live selection" — no membership, or several
 * memberships without a persisted choice — and that is what the switcher's
 * picker is for, so on the steady-state events (`INITIAL_SESSION`,
 * `TOKEN_REFRESHED`, `USER_UPDATED`) it leaves the store alone rather than
 * fight a picker the member is about to use. The two account-boundary events
 * are different: `SIGNED_OUT` clears the store, and a `SIGNED_IN` whose token
 * carries no claim clears it too, so the previous account's chapter id never
 * survives in this browser's storage into the next account's session (and the
 * `FrappProvider` cache drop that keys on the store change runs). Clearing
 * only at the boundary, not on every claim-less refresh, is deliberate: if the
 * access-token hook were ever switched off (it is a dashboard toggle the
 * conformance job watches), every token would lack the claim and a
 * clear-on-refresh would undo each selection the moment `useSelectChapter`
 * refreshed the session.
 */
export function useClaimChapterSync(): void {
  useEffect(() => {
    const supabase = createSupabaseBrowserClient();
    const write = (next: string | null) => {
      const store = useChapterStore.getState();
      if (store.activeChapterId !== next) store.setActiveChapterId(next);
    };
    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((event, session) => {
      if (event === "SIGNED_OUT") {
        write(null);
        return;
      }
      if (
        event !== "INITIAL_SESSION" &&
        event !== "SIGNED_IN" &&
        event !== "TOKEN_REFRESHED" &&
        event !== "USER_UPDATED"
      ) {
        return;
      }
      if (!session) return;
      const claim = readActiveChapterClaim(session.access_token);
      if (claim) {
        write(claim);
      } else if (event === "SIGNED_IN") {
        write(null);
      }
    });
    return () => subscription.unsubscribe();
  }, []);
}
