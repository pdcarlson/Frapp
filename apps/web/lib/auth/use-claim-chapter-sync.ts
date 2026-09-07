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
 * before it writes the same value itself. No claim (no membership, or several
 * without a live persisted choice) leaves the store alone: that is what the
 * switcher's picker is for.
 */
export function useClaimChapterSync(): void {
  useEffect(() => {
    const supabase = createSupabaseBrowserClient();
    const apply = (token: string | null | undefined) => {
      const claim = readActiveChapterClaim(token);
      if (!claim) return;
      const store = useChapterStore.getState();
      if (store.activeChapterId !== claim) store.setActiveChapterId(claim);
    };
    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((event, session) => {
      if (
        event === "INITIAL_SESSION" ||
        event === "SIGNED_IN" ||
        event === "TOKEN_REFRESHED" ||
        event === "USER_UPDATED"
      ) {
        apply(session?.access_token);
      }
    });
    return () => subscription.unsubscribe();
  }, []);
}
