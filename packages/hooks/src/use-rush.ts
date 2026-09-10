"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useActiveChapterId, useFrappClient } from "./use-frapp-client";

export const rushKeys = {
  all: ["rush"] as const,
  detail: (chapterId: string | null, id: string) =>
    ["rush", chapterId, "detail", id] as const,
};

export interface RushCandidateView {
  id: string;
  chapter_id: string;
  display_name: string;
  name_key: string;
  user_id: string | null;
  stage: string;
  bid_status: "none" | "extended";
  created_by: string;
  created_at: string;
  vote_count: number;
  viewer_has_voted: boolean;
}

export function useRushCandidate(id: string | undefined) {
  const client = useFrappClient();
  const chapterId = useActiveChapterId();
  return useQuery({
    queryKey: rushKeys.detail(chapterId, id ?? ""),
    queryFn: async () => {
      const { data, error } = await client.GET("/v1/rush/candidates/{id}", {
        params: { path: { id: id as string } },
      });
      if (error) throw error;
      return data as RushCandidateView;
    },
    enabled: !!chapterId && !!id,
    staleTime: 15_000,
  });
}

export function useVoteRushCandidate() {
  const client = useFrappClient();
  const queryClient = useQueryClient();
  const chapterId = useActiveChapterId();
  return useMutation({
    mutationFn: async (id: string) => {
      const { data, error } = await client.POST(
        "/v1/rush/candidates/{id}/vote",
        { params: { path: { id } } },
      );
      if (error) throw error;
      return data as RushCandidateView;
    },
    onSuccess: (view) => {
      queryClient.setQueryData(rushKeys.detail(chapterId, view.id), view);
    },
  });
}

export function useBidRushCandidate() {
  const client = useFrappClient();
  const queryClient = useQueryClient();
  const chapterId = useActiveChapterId();
  return useMutation({
    mutationFn: async (id: string) => {
      const { data, error } = await client.POST("/v1/rush/candidates/{id}/bid", {
        params: { path: { id } },
      });
      if (error) throw error;
      return data as RushCandidateView;
    },
    onSuccess: (view) => {
      queryClient.setQueryData(rushKeys.detail(chapterId, view.id), view);
    },
  });
}
