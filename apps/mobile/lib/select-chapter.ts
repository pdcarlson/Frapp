import { useCallback } from "react";
import { useActivateChapter } from "@repo/hooks";
import { statusOf } from "@repo/api-sdk";
import { getSupabaseClient } from "./supabase";

export interface SelectChapterOptions {
  /**
   * Called once step 1's answer has come back, before the refresh: from here
   * the server holds `chapterId` whatever the result says. So a `false` result
   * after this call means the server moved and the token in hand didn't. A
   * `false` with no call means the activate wasn't confirmed: almost always
   * nothing changed, but an activate the server applied whose answer was lost
   * on the way back looks the same, and nothing here can tell them apart. Only
   * the chapter picker needs the difference (`app/(auth)/chapter-picker.tsx`);
   * join and chapter setup call with the id alone. Keep it to bookkeeping: it
   * runs inside a selection that otherwise never throws.
   */
  onActivated?: () => void;
  /**
   * Called when the server answers step 1 with a refusal (403: the caller
   * isn't a member of `chapterId`, `ChapterService.setActiveChapter`), before
   * the `false` comes back. Nothing moved, and a retry can't succeed, which is
   * what tells it apart from a `false` for being offline. The same rules as
   * `onActivated`: only the picker passes it, and it is bookkeeping.
   */
  onRefused?: () => void;
}

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
    async (
      chapterId: string,
      options?: SelectChapterOptions,
    ): Promise<boolean> => {
      const supabase = getSupabaseClient();
      if (!supabase) return false;

      try {
        await activateChapter.mutateAsync(chapterId);
      } catch (caught) {
        // Nothing happened server-side, so the member is exactly where they
        // started and a retry is safe. (Short of an answer lost on the way
        // back after the server applied it, which nothing here can see.) A
        // 403 is the server saying no, which a retry won't change.
        if (statusOf(caught) === 403) options?.onRefused?.();
        return false;
      }
      options?.onActivated?.();

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
        // disagrees with the token and no request 403s in the meantime. A
        // caller that has to tell this apart from a refused activate passes
        // `onActivated`, which has already run by now.
        return false;
      }

      return true;
    },
    [activateChapter],
  );
}
