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
      } catch {
        // Nothing happened server-side, so the member is exactly where they
        // started and a retry is safe.
        return false;
      }

      // `refreshSession` RESOLVES with `{ error }` on auth and network failures
      // rather than rejecting — only non-auth errors throw. A bare `await`
      // inside the try above therefore reports success for a refresh that
      // failed, which is worse than it sounds: the caller would stop showing a
      // spinner only when the screen changed, and the screen only changes when
      // the claim arrives, which it never would.
      const { error } = await supabase.auth.refreshSession();

      if (error) {
        // Note the asymmetry with the branch above: activation already
        // succeeded, so the server's idea of the active chapter HAS changed
        // while we report failure. That is the honest answer for right now —
        // the token in hand still carries the old claim, so the switch has not
        // taken effect — but the next token issuance will pick the new chapter
        // up. Nothing local was written either way, so `x-chapter-id` never
        // disagrees with the token and no request 403s in the meantime.
        return false;
      }

      return true;
    },
    [activateChapter],
  );
}
