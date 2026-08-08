"use client";

import { useCallback } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useActivateChapter } from "@repo/hooks";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";
import { useChapterStore } from "@/lib/stores/chapter-store";

/**
 * Single entry point for changing the caller's active chapter.
 *
 * Four things have to happen together, and skipping any one of them leaves the
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
 * 4. Drop the query cache, so the outgoing chapter's rows cannot be rendered
 *    under the incoming chapter's context. Only about half the chapter-scoped
 *    query keys carry `chapterId` (`["members", chapterId]` does;
 *    `["channels"]`, `["documents", folder]`, `["tasks", assigneeId]` and
 *    friends do not), so switching without this leaves the unscoped ones
 *    serving the previous chapter's data until they go stale.
 *
 *    Dropping wholesale rather than enumerating keys is deliberate: the
 *    enumeration is exactly the list that is already incomplete, and a chapter
 *    switch invalidates the entire view of the app anyway.
 *
 * See spec/behavior/multi-tenancy.md.
 */
export function useSelectChapter() {
  const activateChapter = useActivateChapter();
  const queryClient = useQueryClient();
  const setActiveChapterId = useChapterStore((s) => s.setActiveChapterId);

  return useCallback(
    async (chapterId: string): Promise<boolean> => {
      try {
        await activateChapter.mutateAsync(chapterId);

        const supabase = createSupabaseBrowserClient();
        await supabase.auth.refreshSession();
      } catch {
        // Best-effort by design. Callers reach here *after* the action that
        // matters has already succeeded (invite redeemed, chapter created), so
        // throwing would roll back a success in the UI only — the user would be
        // told their invite failed and would retry into "already used".
        //
        // The local store is deliberately left untouched on failure. Writing it
        // here would point `x-chapter-id` at a chapter the un-refreshed token
        // still disagrees with, and ChapterGuard rejects that disagreement with
        // chapter.context.mismatch on *every* subsequent request — a far worse
        // outcome than no selection. The next token issuance re-resolves it
        // (single-chapter users auto-resolve server-side).
        return false;
      }

      setActiveChapterId(chapterId);

      // After the store, so any refetch this triggers resolves against the
      // incoming chapter. A refetch that still races the provider's re-memo
      // fails closed rather than leaking: the session was already refreshed
      // above, so a stale `x-chapter-id` now disagrees with the new claim and
      // ChapterGuard rejects it with chapter.context.mismatch (403). No
      // outgoing-chapter data can reach the screen either way.
      queryClient.clear();
      return true;
    },
    [activateChapter, queryClient, setActiveChapterId],
  );
}
