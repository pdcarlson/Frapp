"use client";

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useFrappClient } from "./use-frapp-client";

type PointWindow = "all" | "semester" | "month";

export function useMyPoints(window?: PointWindow) {
  const client = useFrappClient();
  return useQuery({
    queryKey: ["points", "me", window],
    queryFn: async () => {
      const { data, error } = await client.GET("/v1/points/me", {
        params: { query: { window } },
      });
      if (error) throw error;
      return data;
    },
    staleTime: 30_000,
  });
}

export function useLeaderboard(window?: PointWindow) {
  const client = useFrappClient();
  return useQuery({
    queryKey: ["points", "leaderboard", window],
    queryFn: async () => {
      const { data, error } = await client.GET("/v1/points/leaderboard", {
        params: { query: { window } },
      });
      if (error) throw error;
      return data;
    },
    staleTime: 30_000,
  });
}

export function useMemberPoints(userId: string, window?: PointWindow) {
  const client = useFrappClient();
  return useQuery({
    queryKey: ["points", "members", userId, window],
    queryFn: async () => {
      const { data, error } = await client.GET("/v1/points/members/{userId}", {
        params: { path: { userId }, query: { window } },
      });
      if (error) throw error;
      return data;
    },
    staleTime: 30_000,
    enabled: !!userId,
  });
}

export function useAdjustPoints() {
  const client = useFrappClient();
  const queryClient = useQueryClient();
  return useMutation({
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
      queryClient.invalidateQueries({ queryKey: ["points"] });
    },
  });
}
