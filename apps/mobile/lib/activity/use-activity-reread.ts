import { useCallback, useEffect, useRef } from "react";
import { useFocusEffect } from "expo-router";
import { useQueryClient } from "@tanstack/react-query";
import {
  activityKeys,
  activityStandingKeys,
  useActiveChapterId,
} from "@repo/hooks";

/**
 * Reads Activity again (`GET /v1/activity`), now and each time the screen
 * that calls this comes back into focus.
 *
 * `useActivity` is never served fresh from cache, but on web that rests on
 * the page mounting again each visit. On the phone a tab is never unmounted
 * and a pushed screen stays mounted under whatever it pushes, and none of
 * the records' own writers (a vote in chat, a task finished on the task
 * board, a check-in) knows about this read. So the Activity screen reads it
 * again whenever the member returns to it, and the tab bar, which carries the
 * count on Activity's tab (#4610), on every change of tab
 * (`useActivityRereadOnTab`). Back to the app is already covered: the query client re-reads on an
 * AppState focus (`lib/connection/query-connectivity.ts`).
 *
 * The mount is skipped, since the query reads on mount by itself. Returns the
 * re-read, for a screen that also wants it after an action of its own. An
 * invalidation, not a `refetch`, so a read that is held (no chapter yet)
 * stays held.
 *
 * `standing` also re-reads the "This semester" block
 * (`GET /v1/activity/standing`), for the Activity screen that draws it: a
 * check-in on its own rows moves those numbers too.
 */
export function useActivityReread(
  options: { standing?: boolean } = {},
): () => void {
  const chapterId = useActiveChapterId();
  const queryClient = useQueryClient();
  const withStanding = options.standing ?? false;
  const reread = useCallback(() => {
    if (!chapterId) return;
    void queryClient.invalidateQueries({
      queryKey: activityKeys.chapter(chapterId),
      exact: true,
    });
    if (withStanding) {
      void queryClient.invalidateQueries({
        queryKey: activityStandingKeys.chapter(chapterId),
        exact: true,
      });
    }
  }, [chapterId, queryClient, withStanding]);

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

/**
 * Reads Activity again each time `tabKey` changes: the tab bar's hold on the
 * count. The bar is drawn once and never refocuses, so it can't use a focus
 * effect; a change of tab is the moment the member may have done something
 * on the tab they left (a vote in chat). The first value is skipped, since
 * the query reads on mount by itself.
 */
export function useActivityRereadOnTab(tabKey: string): void {
  const chapterId = useActiveChapterId();
  const queryClient = useQueryClient();
  const seen = useRef(tabKey);
  useEffect(() => {
    if (seen.current === tabKey) return;
    seen.current = tabKey;
    if (!chapterId) return;
    void queryClient.invalidateQueries({
      queryKey: activityKeys.chapter(chapterId),
      exact: true,
    });
  }, [chapterId, queryClient, tabKey]);
}
