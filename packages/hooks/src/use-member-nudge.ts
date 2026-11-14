"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { components } from "@repo/api-sdk";
import type { MemberNudgeDismissReason } from "@repo/validation";
import { createChapterQueryKeys } from "./chapter-query-keys";
import { useActiveChapterId, useFrappClient } from "./use-frapp-client";

export type MemberNudge = components["schemas"]["MemberNudgeDto"];

/** Chapter-scoped keys; the read is `memberNudgeKeys.chapter(chapterId)`. */
const memberNudgeKeys = createChapterQueryKeys("member-nudge");
const memberNudgeSettingsKeys = createChapterQueryKeys("member-nudge-settings");

/**
 * The member's card for Activity (`POST /v1/nudges/current`,
 * `spec/behavior/ai.md` § Nudges), or null.
 *
 * A card is an extra: any failure (AI off on the server, a network error) is
 * no card, never an error state, and it is not retried. The server may write
 * a new card on this call, which costs a model call, so the read is held for
 * a few minutes rather than taken again on every focus; `enabled` is the
 * caller saying the server offers AI to this member at all.
 */
export function useMemberNudge(options: { enabled?: boolean } = {}) {
  const client = useFrappClient();
  const chapterId = useActiveChapterId();
  return useQuery({
    queryKey: memberNudgeKeys.chapter(chapterId!),
    queryFn: async ({ signal }): Promise<MemberNudge | null> => {
      try {
        const { data, error } = await client.POST("/v1/nudges/current", {
          signal,
        });
        if (error !== undefined || data === undefined) return null;
        return data.nudge ?? null;
      } catch {
        return null;
      }
    },
    staleTime: 5 * 60_000,
    retry: false,
    refetchOnWindowFocus: false,
    enabled: !!chapterId && (options.enabled ?? true),
  });
}

/**
 * The card's own actions. Closing takes the card off the screen at once and
 * leaves it off if the request fails: a card the member waved away never
 * comes back to argue, and the server's own limits apply either way.
 */
export function useMemberNudgeActions() {
  const client = useFrappClient();
  const chapterId = useActiveChapterId();
  const queryClient = useQueryClient();
  const key = memberNudgeKeys.chapter(chapterId!);

  const dismiss = useMutation({
    mutationKey: ["member-nudge-dismiss"],
    mutationFn: async (input: {
      id: string;
      reason: MemberNudgeDismissReason;
    }) => {
      await client.POST("/v1/nudges/{id}/dismiss", {
        params: { path: { id: input.id } },
        body: { reason: input.reason },
      });
    },
    onMutate: () => {
      queryClient.setQueryData(key, null);
    },
  });

  const seen = useMutation({
    mutationKey: ["member-nudge-seen"],
    mutationFn: async (id: string) => {
      await client.POST("/v1/nudges/{id}/seen", {
        params: { path: { id } },
      });
    },
    onMutate: (id) => {
      queryClient.setQueryData<MemberNudge | null>(key, (current) =>
        current && current.id === id ? { ...current, seen: true } : current,
      );
    },
  });

  /** After the member acted on the task: ask the server what shows now. */
  const recheck = () => queryClient.invalidateQueries({ queryKey: key });

  return {
    dismiss: (id: string, reason: MemberNudgeDismissReason) =>
      dismiss.mutate({ id, reason }),
    markSeen: (id: string) => seen.mutate(id),
    recheck,
  };
}

/** The member's own switch for the cards. */
export function useMemberNudgeSettings(options: { enabled?: boolean } = {}) {
  const client = useFrappClient();
  const chapterId = useActiveChapterId();
  return useQuery({
    queryKey: memberNudgeSettingsKeys.chapter(chapterId!),
    queryFn: async () => {
      const { data, error } = await client.GET("/v1/nudges/settings");
      if (error) throw error;
      return data;
    },
    enabled: !!chapterId && (options.enabled ?? true),
  });
}

export function useSetMemberNudgesEnabled() {
  const client = useFrappClient();
  const chapterId = useActiveChapterId();
  const queryClient = useQueryClient();
  return useMutation({
    mutationKey: ["member-nudge-settings"],
    mutationFn: async (enabled: boolean) => {
      const { data, error } = await client.PUT("/v1/nudges/settings", {
        body: { enabled },
      });
      if (error) throw error;
      return data;
    },
    onSuccess: (data, enabled) => {
      queryClient.setQueryData(
        memberNudgeSettingsKeys.chapter(chapterId!),
        data,
      );
      if (!enabled) {
        queryClient.setQueryData(memberNudgeKeys.chapter(chapterId!), null);
      } else {
        void queryClient.invalidateQueries({
          queryKey: memberNudgeKeys.chapter(chapterId!),
        });
      }
    },
  });
}
