"use client";

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useActiveChapterId, useFrappClient } from "./use-frapp-client";

export function useInvites() {
  const client = useFrappClient();
  const chapterId = useActiveChapterId();
  return useQuery({
    queryKey: ["invites", chapterId],
    queryFn: async () => {
      const { data, error } = await client.GET("/v1/invites");
      if (error) throw error;
      return data;
    },
    staleTime: 60_000,
    enabled: !!chapterId,
  });
}

export function useCreateInvite() {
  const client = useFrappClient();
  const chapterId = useActiveChapterId();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (body: { role: string }) => {
      const { data, error } = await client.POST("/v1/invites", { body });
      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["invites", chapterId] });
    },
  });
}

export function useBatchCreateInvites() {
  const client = useFrappClient();
  const chapterId = useActiveChapterId();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (body: { role: string; count: number }) => {
      const { data, error } = await client.POST("/v1/invites/batch", { body });
      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["invites", chapterId] });
    },
  });
}

export function useRedeemInvite() {
  const client = useFrappClient();
  const chapterId = useActiveChapterId();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (body: { token: string }) => {
      const { data, error } = await client.POST("/v1/invites/redeem", {
        body,
      });
      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["invites", chapterId] });
      queryClient.invalidateQueries({ queryKey: ["members", chapterId] });
      queryClient.invalidateQueries({ queryKey: ["chapters"] });
    },
  });
}

export function useRevokeInvite() {
  const client = useFrappClient();
  const chapterId = useActiveChapterId();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      const { data, error } = await client.DELETE("/v1/invites/{id}", {
        params: { path: { id } },
      });
      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["invites", chapterId] });
    },
  });
}
