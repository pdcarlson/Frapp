import { useCallback } from "react";
import { useActivateChapter } from "@repo/hooks";
import { getSupabaseClient } from "./supabase";

/**
 * Single entry point for choosing the caller's active chapter on mobile.
 *
 * This is the port of `apps/web/lib/auth/select-chapter.ts`, and it is
 * deliberately **two** steps where web has three:
 *
 * 1. Persist the selection server-side, so `custom_access_token_hook` stamps it
 *    into issued tokens as the authoritative `active_chapter_id` claim.
 * 2. Refresh the Supabase session. The claim is baked in at issuance, so
 *    without this the *previous* claim stands until the current token expires
 *    (`jwt_expiry`, 3600s) and `ChapterGuard` rejects the mismatched
 *    `x-chapter-id` header with `chapter.context.mismatch`.
 *
 * Web's third step — write the chosen id into a local store — has no analogue
 * here, and adding one would be a defect rather than parity. `lib/auth-session`
 * derives `chapterId` from the token claim and nothing else, precisely so the
 * header and the token cannot disagree ("Reading the claim makes disagreement
 * impossible by construction"). A local override would reintroduce the exact
 * mismatch that design rules out. The refresh in step 2 changes `accessToken`,
 * which re-runs the claim effect, which updates `chapterId` — so the local
 * value lands on its own, from the authoritative source.
 *
 * The selection still survives an app restart, because it is persisted
 * server-side and re-resolved into every subsequently issued token.
 *
 * See spec/behavior/multi-tenancy.md.
 */
export function useSelectChapter() {
  const activateChapter = useActivateChapter();

  return useCallback(
    async (chapterId: string): Promise<boolean> => {
      const supabase = getSupabaseClient();
      if (!supabase) return false;

      try {
        await activateChapter.mutateAsync(chapterId);
        await supabase.auth.refreshSession();
      } catch {
        // Best-effort, matching web. Returning false lets the caller surface a
        // retry without unwinding anything: nothing local was written, so a
        // failed attempt leaves the member exactly where they started rather
        // than pointing `x-chapter-id` at a chapter the un-refreshed token
        // still disagrees with — which would 403 every subsequent request.
        return false;
      }

      return true;
    },
    [activateChapter],
  );
}
