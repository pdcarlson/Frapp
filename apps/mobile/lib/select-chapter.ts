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

      // `refreshSession` reports failure BOTH ways, so both have to be handled.
      //
      // It RESOLVES with `{ error }` for auth and network failures — the common
      // case, and the one a bare `await` silently reports as success. But it
      // also *throws* for anything that is not an `AuthError`: notably the
      // 5s storage-lock acquire timeout, which is raised outside
      // `_refreshSession`'s own try and so is never converted. Left unhandled
      // that escapes to an unhandled rejection, and the tap looks like it did
      // nothing at all.
      // Declared without an initializer on purpose: both the `try` and the
      // `catch` assign it, so a `= null` here would be dead — which is what
      // ESLint 10's `no-useless-assignment` reports, under `--max-warnings 0`.
      let error: { message: string } | null;
      try {
        ({ error } = await supabase.auth.refreshSession());
      } catch (thrown) {
        error =
          thrown instanceof Error ? thrown : { message: "Session refresh failed" };
      }

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
