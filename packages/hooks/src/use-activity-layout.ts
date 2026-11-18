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

/**
 * Save an arrangement. The page shows it at once and keeps it if the write
 * fails, re-reading the server's copy only on the next read; the caller
 * reports the failure.
 */
export function useSaveActivityLayout() {
  const client = useFrappClient();
  const chapterId = useActiveChapterId();
  const queryClient = useQueryClient();
  return useMutation({
    mutationKey: ["activity-layout", "save"],
    mutationFn: async (arrangement: ActivityCardArrangement) => {
      const { data, error } = await client.PUT("/v1/activity/layout", {
        body: activityLayoutBody(arrangement),
      });
      if (error !== undefined || data === undefined) throw error;
      return data;
    },
    onMutate: (arrangement) => {
      queryClient.setQueryData<ActivityLayoutRead>(
        activityLayoutKeys.chapter(chapterId!),
        { ...activityLayoutBody(arrangement), saved: true },
      );
    },
    onSuccess: (data) => {
      queryClient.setQueryData(activityLayoutKeys.chapter(chapterId!), data);
    },
  });
}

/** Forget the member's arrangement, so their role's default applies again. */
export function useResetActivityLayout() {
  const client = useFrappClient();
  const chapterId = useActiveChapterId();
  const queryClient = useQueryClient();
  return useMutation({
    mutationKey: ["activity-layout", "reset"],
    mutationFn: async () => {
      const { error } = await client.DELETE("/v1/activity/layout");
      if (error !== undefined) throw error;
    },
    onMutate: () => {
      queryClient.setQueryData<ActivityLayoutRead>(
        activityLayoutKeys.chapter(chapterId!),
        { card_order: [], hidden_cards: [], saved: false },
      );
    },
  });
}
