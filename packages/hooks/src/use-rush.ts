"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { components } from "@repo/api-sdk";
import { isCardReadMiss } from "./card-read-miss";
import { useActiveChapterId, useFrappClient } from "./use-frapp-client";

export const rushKeys = {
  all: ["rush"] as const,
  detail: (chapterId: string | null, id: string) =>
    ["rush", chapterId, "detail", id] as const,
};

/** A candidate as the rush routes return it. Voter names are never on it. */
export type RushCandidateView = components["schemas"]["RushCandidateViewDto"];

/**
 * One candidate, for a chat rush card's live tally and bid. The route needs
 * `members:view`; a caller passes `undefined` when the viewer lacks it, and the
 * hook asks nothing.
 *
 * A 404, or a 403 a retry won't change, resolves to `null` rather than
 * throwing, as `useServiceEntry` does (`isCardReadMiss`): a candidate since
 * deleted, or a permission since lost, then clears the tally instead of
 * keeping the last read, and an expected miss is neither retried nor
 * reported. Any other failure still throws, including `ChapterGuard`'s
 * `chapter.context.mismatch`, which clears once the token catches up with a
 * chapter switch and keeps its retry.
 */
export function useRushCandidate(id: string | undefined) {
  const client = useFrappClient();
  const chapterId = useActiveChapterId();
  return useQuery({
    queryKey: rushKeys.detail(chapterId, id ?? ""),
    queryFn: async (): Promise<RushCandidateView | null> => {
      const { data, error } = await client.GET("/v1/rush/candidates/{id}", {
        params: { path: { id: id as string } },
      });
      if (error) {
        if (isCardReadMiss(error)) return null;
        throw error;
      }
      return data;
    },
    enabled: !!chapterId && !!id,
    staleTime: 15_000,
  });
}

/**
 * Vote for a candidate. Idempotent on the server (a repeat answers 201 with
 * the same view), and there is no unvote. The returned view replaces the
 * card's live read.
 */
export function useVoteRushCandidate() {
  const client = useFrappClient();
  const queryClient = useQueryClient();
  const chapterId = useActiveChapterId();
  return useMutation({
    mutationKey: ["rush", "vote-rush-candidate"],
    mutationFn: async (id: string) => {
      const { data, error } = await client.POST(
        "/v1/rush/candidates/{id}/vote",
        { params: { path: { id } } },
      );
      if (error) throw error;
      return data;
    },
    onSuccess: (view) => {
      queryClient.setQueryData(rushKeys.detail(chapterId, view.id), view);
    },
  });
}

/**
 * Extend a bid to a candidate. Idempotent on the server, and any member may
 * (there are no rush permissions). The returned view replaces the card's live
 * read.
 */
export function useBidRushCandidate() {
  const client = useFrappClient();
  const queryClient = useQueryClient();
  const chapterId = useActiveChapterId();
  return useMutation({
    mutationKey: ["rush", "bid-rush-candidate"],
    mutationFn: async (id: string) => {
      const { data, error } = await client.POST(
        "/v1/rush/candidates/{id}/bid",
        {
          params: { path: { id } },
        },
      );
      if (error) throw error;
      return data;
    },
    onSuccess: (view) => {
      queryClient.setQueryData(rushKeys.detail(chapterId, view.id), view);
    },
  });
}
