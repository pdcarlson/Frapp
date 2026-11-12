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
 * The tab bar's hold on the count it draws on Activity's tab (#4610). The bar
 * is drawn once and never remounts, so it reads Activity again when the
 * member may have changed what it counts: on each change of tab (`tabKey`,
 * a vote in chat, then over to Calendar), and each time the tabs come back
 * into focus from a screen pushed over them (a task finished on the board,
 * then back to Chat). The first draw is skipped, since the query reads on
 * mount by itself.
 *
 * While Activity is the tab in front (`activityInFront`) the screen's own
 * `useActivityReread` reads on both of those, so this one stays out of it
 * rather than send the same read twice.
 */
export function useActivityRereadOnTab(
  tabKey: string,
  activityInFront: boolean,
): void {
  const chapterId = useActiveChapterId();
  const queryClient = useQueryClient();
  // Kept current in an effect declared before the tab effect below, so that
  // effect reads the value of the same commit.
  const skip = useRef(activityInFront);
  useEffect(() => {
    skip.current = activityInFront;
  }, [activityInFront]);
  const reread = useCallback(() => {
    if (!chapterId || skip.current) return;
    void queryClient.invalidateQueries({
      queryKey: activityKeys.chapter(chapterId),
      exact: true,
    });
  }, [chapterId, queryClient]);

  const seen = useRef(tabKey);
  useEffect(() => {
    if (seen.current === tabKey) return;
    seen.current = tabKey;
    reread();
  }, [reread, tabKey]);

  const mounted = useRef(false);
  useFocusEffect(
    useCallback(() => {
      if (mounted.current) reread();
      mounted.current = true;
      return undefined;
    }, [reread]),
  );
}
