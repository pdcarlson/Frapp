import { useCallback, useRef } from "react";
import { useFocusEffect } from "expo-router";
import { useQueryClient } from "@tanstack/react-query";
import { activityKeys, useActiveChapterId } from "@repo/hooks";

/**
 * Reads Activity again (`GET /v1/activity`), now and each time the screen
 * that calls this comes back into focus.
 *
 * `useActivity` is never served fresh from cache, but on web that rests on
 * the page mounting again each visit. On the phone a tab is never unmounted
 * and a pushed screen stays mounted under whatever it pushes, and none of
 * the records' own writers (a vote in chat, a task finished on the Tasks tab,
 * a check-in) knows about this read. So the two screens that show it, More
 * (the count) and Activity, read it again whenever the member returns to
 * them. Back to the app is already covered: the query client re-reads on an
 * AppState focus (`lib/connection/query-connectivity.ts`).
 *
 * The mount is skipped, since the query reads on mount by itself. Returns the
 * re-read, for a screen that also wants it after an action of its own. An
 * invalidation, not a `refetch`, so a read that is held (no chapter yet)
 * stays held.
 */
export function useActivityReread(): () => void {
  const chapterId = useActiveChapterId();
  const queryClient = useQueryClient();
  const reread = useCallback(() => {
    if (!chapterId) return;
    void queryClient.invalidateQueries({
      queryKey: activityKeys.chapter(chapterId),
      exact: true,
    });
  }, [chapterId, queryClient]);

  const mounted = useRef(false);
  useFocusEffect(
    useCallback(() => {
      if (mounted.current) reread();
      mounted.current = true;
      return undefined;
    }, [reread]),
  );
  return reread;
}
