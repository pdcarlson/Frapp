"use client";

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useActiveChapterId, useFrappClient } from "./use-frapp-client";

type PointWindow = "all" | "semester" | "month";

export function useMyPoints(window?: PointWindow, semesterArchiveId?: string) {
  const client = useFrappClient();
  const chapterId = useActiveChapterId();
  return useQuery({
    queryKey: ["points", chapterId, "me", window, semesterArchiveId],
    queryFn: async () => {
      const { data, error } = await client.GET("/v1/points/me", {
        params: {
          query: { window, semester_archive_id: semesterArchiveId },
        },
      });
      if (error) throw error;
      return data;
    },
    staleTime: 30_000,
    // Matches every other read in this file: without an active chapter the
    // request cannot resolve a scope, and an ungated fetch would surface as a
    // page-level error rather than the "no chapter selected" empty state.
    enabled: !!chapterId,
  });
}

export function useLeaderboard(
  window?: PointWindow,
  semesterArchiveId?: string,
) {
  const client = useFrappClient();
  const chapterId = useActiveChapterId();
  return useQuery({
    queryKey: ["points", chapterId, "leaderboard", window, semesterArchiveId],
    queryFn: async () => {
      const { data, error } = await client.GET("/v1/points/leaderboard", {
        params: {
          query: { window, semester_archive_id: semesterArchiveId },
        },
      });
      if (error) throw error;
      return data;
    },
    staleTime: 30_000,
    enabled: !!chapterId,
  });
}

export function usePointsTransactions(options?: {
  userId?: string;
  category?:
    | "ATTENDANCE"
    | "ACADEMIC"
    | "SERVICE"
    | "FINE"
    | "MANUAL"
    | "STUDY";
  flagged?: boolean;
  before?: string;
  limit?: number;
}) {
  const client = useFrappClient();
  const chapterId = useActiveChapterId();
  return useQuery({
    queryKey: ["points", chapterId, "transactions", options],
    queryFn: async () => {
      const { data, error } = await client.GET("/v1/points/transactions", {
        params: {
          query: {
            user_id: options?.userId,
            category: options?.category,
            flagged:
              options?.flagged === undefined
                ? undefined
                : options.flagged
                  ? "true"
                  : "false",
            before: options?.before,
            limit: options?.limit,
          },
        },
      });
      if (error) throw error;
      return data;
    },
    staleTime: 30_000,
    enabled: !!chapterId,
  });
}

export function useAdjustPoints() {
  const client = useFrappClient();
  const chapterId = useActiveChapterId();
  const queryClient = useQueryClient();
  return useMutation({
    // No retry. The web client defaults every mutation to `retry: 2`
    // (`apps/web/lib/providers/query-provider.tsx`), and this path sends no
    // `client_message_id`, so the server has nothing to deduplicate on: if the
    // first attempt commits the ledger row and only its response is lost, the
    // two automatic retries write two MORE rows. The ledger is append-only, so
    // a +50 grant becomes +150 with no way back through the API — #1719's
    // double-grant, fired without anyone intending a second grant.
    //
    // This is the cheap containment, not the fix. The fix is for this hook to
    // mint a key and reuse it across attempts, which is #1733 along with the
    // `/points` slash-command half.
    retry: false,
    mutationFn: async (body: {
      target_user_id: string;
      amount: number;
      category: "MANUAL" | "FINE";
      reason: string;
    }) => {
      const { data, error } = await client.POST("/v1/points/adjust", { body });
      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["points", chapterId] });
    },
  });
}
