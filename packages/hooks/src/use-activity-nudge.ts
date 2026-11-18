"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { components } from "@repo/api-sdk";
import { createChapterQueryKeys } from "./chapter-query-keys";
import { useActiveChapterId, useFrappClient } from "./use-frapp-client";

/** One card or tray item (`ActivityNudgeItemDto`). */
export type ActivityNudge = components["schemas"]["ActivityNudgeItemDto"];
/** The card and its tray (`POST /v1/activity/card`). */
export type ActivityNudgeCard = components["schemas"]["ActivityNudgeCardDto"];

/** Chapter-scoped keys; the read is `activityNudgeKeys.chapter(chapterId)`. */
const activityNudgeKeys = createChapterQueryKeys("activity-nudge");
const activityNudgeSettingsKeys = createChapterQueryKeys(
  "activity-nudge-settings",
);

const EMPTY: ActivityNudgeCard = { card: null, tray: [] };

/**
 * The card at the top of Activity and its tray (`POST /v1/activity/card`,
 * `spec/behavior/ai.md` § The card and its tray, #5464). It shows with or
 * without AI, so it is asked for on every Activity; AI only adds a sentence.
 *
 * A card is an extra: any failure is no card, never an error state, and it is
 * not retried. The server may write a sentence on this call, which costs a
 * model call, so the read is held for a minute rather than taken on every
 * focus. `recheck` asks again after the member acted.
 */
export function useActivityNudge(options: { enabled?: boolean } = {}) {
  const client = useFrappClient();
  const chapterId = useActiveChapterId();
  return useQuery({
    queryKey: activityNudgeKeys.chapter(chapterId!),
    queryFn: async ({ signal }): Promise<ActivityNudgeCard> => {
      try {
        const { data, error } = await client.POST("/v1/activity/card", {
          signal,
        });
        if (error !== undefined || data === undefined) return EMPTY;
        return data;
      } catch {
        return EMPTY;
      }
    },
    staleTime: 60_000,
    retry: false,
    refetchOnWindowFocus: false,
    enabled: !!chapterId && (options.enabled ?? true),
  });
}

/**
 * The card's own actions. Waving one off takes it off the screen at once,
 * from the card or the tray, and leaves it off if the request fails: a card
 * the member waved away never comes back to argue.
 */
export function useActivityNudgeActions() {
  const client = useFrappClient();
  const chapterId = useActiveChapterId();
  const queryClient = useQueryClient();
  const key = activityNudgeKeys.chapter(chapterId!);

  const dismiss = useMutation({
    mutationKey: ["activity-nudge-dismiss"],
    mutationFn: async (item: Pick<ActivityNudge, "kind" | "subject_key">) => {
      await client.POST("/v1/activity/card/dismiss", {
        body: {
          kind: item.kind as components["schemas"]["ActivityNudgeDismissDto"]["kind"],
          subject_key: item.subject_key,
        },
      });
    },
    onMutate: (item) => {
      queryClient.setQueryData<ActivityNudgeCard>(key, (current) => {
        if (!current) return current;
        const same = (other: ActivityNudge | null) =>
          other !== null &&
          other.kind === item.kind &&
          other.subject_key === item.subject_key;
        if (same(current.card)) {
          // The tray's first moves up until the server answers again.
          const [next, ...rest] = current.tray;
          return { card: next ?? null, tray: rest };
        }
        return {
          card: current.card,
          tray: current.tray.filter((other) => !same(other)),
        };
      });
    },
    onSettled: () => queryClient.invalidateQueries({ queryKey: key }),
  });

  const seen = useMutation({
    mutationKey: ["activity-nudge-seen"],
    mutationFn: async (id: string) => {
      await client.POST("/v1/activity/card/seen", { body: { id } });
    },
    onMutate: (id) => {
      queryClient.setQueryData<ActivityNudgeCard>(key, (current) =>
        current?.card && current.card.id === id
          ? { ...current, card: { ...current.card, seen: true } }
          : current,
      );
    },
  });

  /** After the member acted on something: ask the server what shows now. */
  const recheck = () => queryClient.invalidateQueries({ queryKey: key });

  return {
    dismiss: (item: Pick<ActivityNudge, "kind" | "subject_key">) =>
      dismiss.mutate(item),
    markSeen: (id: string) => seen.mutate(id),
    recheck,
  };
}

/** The member's own switch for the card. */
export function useActivityNudgeSettings(options: { enabled?: boolean } = {}) {
  const client = useFrappClient();
  const chapterId = useActiveChapterId();
  return useQuery({
    queryKey: activityNudgeSettingsKeys.chapter(chapterId!),
    queryFn: async ({ signal }) => {
      const { data, error } = await client.GET("/v1/activity/card/settings", {
        signal,
      });
      if (error) throw error;
      return data;
    },
    enabled: !!chapterId && (options.enabled ?? true),
  });
}

export function useSetActivityNudgesEnabled() {
  const client = useFrappClient();
  const chapterId = useActiveChapterId();
  const queryClient = useQueryClient();
  return useMutation({
    mutationKey: ["activity-nudge-settings"],
    mutationFn: async (enabled: boolean) => {
      const { data, error } = await client.PUT("/v1/activity/card/settings", {
        body: { enabled },
      });
      if (error) throw error;
      return data;
    },
    onSuccess: (data, enabled) => {
      queryClient.setQueryData(
        activityNudgeSettingsKeys.chapter(chapterId!),
        data,
      );
      if (!enabled) {
        queryClient.setQueryData(activityNudgeKeys.chapter(chapterId!), EMPTY);
      } else {
        void queryClient.invalidateQueries({
          queryKey: activityNudgeKeys.chapter(chapterId!),
        });
      }
    },
  });
}
