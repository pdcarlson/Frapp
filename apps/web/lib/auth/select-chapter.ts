"use client";

import { useCallback } from "react";
import { useActivateChapter } from "@repo/hooks";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";
import { useChapterStore } from "@/lib/stores/chapter-store";

/**
 * Single entry point for changing the caller's active chapter.
 *
 * Three things have to happen together, and skipping any one of them leaves the
 * client and the API disagreeing about which chapter the user is in:
 *
 * 1. Persist the selection server-side, so `custom_access_token_hook` can stamp
 *    it into issued tokens as the authoritative `active_chapter_id` claim.
 * 2. Refresh the Supabase session. The claim is baked in at issuance, so
 *    without this the *previous* chapter stays authoritative for up to
 *    `jwt_expiry` (3600s) and `ChapterGuard` rejects the mismatched
 *    `x-chapter-id` header with `chapter.context.mismatch`.
 * 3. Update the local store, which drives the `x-chapter-id` fallback header
 *    and every React Query cache key.
 *
 * See spec/behavior/multi-tenancy.md.
 */
export function useSelectChapter() {
  const activateChapter = useActivateChapter();
  const setActiveChapterId = useChapterStore((s) => s.setActiveChapterId);

  return useCallback(
    async (chapterId: string) => {
      await activateChapter.mutateAsync(chapterId);

      const supabase = createSupabaseBrowserClient();
      await supabase.auth.refreshSession();

      setActiveChapterId(chapterId);
    },
    [activateChapter, setActiveChapterId],
  );
}
