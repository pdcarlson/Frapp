"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  activityLayoutBody,
  type ActivityCardArrangement,
  type ActivityLayoutRead,
} from "./activity-cards";
import { createChapterQueryKeys } from "./chapter-query-keys";
import { useActiveChapterId, useFrappClient } from "./use-frapp-client";

const activityLayoutKeys = createChapterQueryKeys("activity-layout");

/**
 * How the member arranged their Activity cards in this chapter
 * (`GET /v1/activity/layout`, #5520). Saved on the server so the phone and
 * web draw one page; read again when the screen regains focus, so an edit on
 * the other device shows up. Until it answers, and if it fails, the page
 * draws the role's default (`arrangeActivityCards`), never nothing.
 */
export function useActivityLayout(options: { enabled?: boolean } = {}) {
  const client = useFrappClient();
  const chapterId = useActiveChapterId();
  return useQuery({
    queryKey: activityLayoutKeys.chapter(chapterId!),
    queryFn: async ({ signal }): Promise<ActivityLayoutRead> => {
      const { data, error } = await client.GET("/v1/activity/layout", {
        signal,
      });
      if (error !== undefined || data === undefined) throw error;
      return data;
    },
    staleTime: 30_000,
    enabled: !!chapterId && (options.enabled ?? true),
  });
}

type LayoutKey = ReturnType<typeof activityLayoutKeys.chapter>;
type LayoutContext = {
  key: LayoutKey;
  previous: ActivityLayoutRead | undefined;
};

/**
 * Save an arrangement. The page shows it at once; a failed save puts back
 * what was there and re-reads the server's copy, and the caller says so.
 * Every write lands on the chapter the save started in, whatever the member
 * opened since, and a read already out is cancelled so it can't draw the old
 * arrangement over the new one. Keys this build doesn't know are carried
 * through (`activityLayoutBody`).
 */
export function useSaveActivityLayout() {
  const client = useFrappClient();
  const chapterId = useActiveChapterId();
  const queryClient = useQueryClient();
  return useMutation<
    ActivityLayoutRead,
    unknown,
    ActivityCardArrangement,
    LayoutContext
  >({
    mutationKey: ["activity-layout", "save"],
    onMutate: async (arrangement) => {
      const key = activityLayoutKeys.chapter(chapterId!);
      await queryClient.cancelQueries({ queryKey: key, exact: true });
      const previous = queryClient.getQueryData<ActivityLayoutRead>(key);
      queryClient.setQueryData<ActivityLayoutRead>(key, {
        ...activityLayoutBody(arrangement, previous),
        saved: true,
      });
      return { key, previous };
    },
    mutationFn: async (arrangement) => {
      // `onMutate` ran first: what is cached now is the arrangement with the
      // stored unknown keys already folded in, so this adds nothing twice.
      const cached = queryClient.getQueryData<ActivityLayoutRead>(
        activityLayoutKeys.chapter(chapterId!),
      );
      const { data, error } = await client.PUT("/v1/activity/layout", {
        body: activityLayoutBody(arrangement, cached),
      });
      if (error !== undefined || data === undefined) throw error;
      return data;
    },
    onSuccess: (data, _arrangement, context) => {
      if (context) queryClient.setQueryData(context.key, data);
    },
    onError: (_error, _arrangement, context) => {
      if (!context) return;
      queryClient.setQueryData(context.key, context.previous);
      void queryClient.invalidateQueries({
        queryKey: context.key,
        exact: true,
      });
    },
  });
}

/**
 * Forget the member's arrangement, so their role's default applies again.
 * Shown at once; a failure puts the arrangement back, and either way the
 * server's copy is read again.
 */
export function useResetActivityLayout() {
  const client = useFrappClient();
  const chapterId = useActiveChapterId();
  const queryClient = useQueryClient();
  return useMutation<void, unknown, void, LayoutContext>({
    mutationKey: ["activity-layout", "reset"],
    onMutate: async () => {
      const key = activityLayoutKeys.chapter(chapterId!);
      await queryClient.cancelQueries({ queryKey: key, exact: true });
      const previous = queryClient.getQueryData<ActivityLayoutRead>(key);
      queryClient.setQueryData<ActivityLayoutRead>(key, {
        card_order: [],
        hidden_cards: [],
        saved: false,
      });
      return { key, previous };
    },
    mutationFn: async () => {
      const { error } = await client.DELETE("/v1/activity/layout");
      if (error !== undefined) throw error;
    },
    onError: (_error, _vars, context) => {
      if (context) queryClient.setQueryData(context.key, context.previous);
    },
    onSettled: (_data, _error, _vars, context) => {
      if (context) {
        void queryClient.invalidateQueries({
          queryKey: context.key,
          exact: true,
        });
      }
    },
  });
}
