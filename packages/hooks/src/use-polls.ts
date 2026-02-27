"use client";

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useFrappClient } from "./use-frapp-client";

export function usePoll(messageId: string) {
  const client = useFrappClient();
  return useQuery({
    queryKey: ["polls", messageId],
    queryFn: async () => {
      const { data, error } = await client.GET("/v1/polls/{messageId}", {
        params: { path: { messageId } },
      });
      if (error) throw error;
      return data;
    },
    staleTime: 0,
    enabled: !!messageId,
  });
}

export function useCreatePoll() {
  const client = useFrappClient();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({
      channelId,
      body,
    }: {
      channelId: string;
      body: {
        question: string;
        options: string[];
        expires_at?: string;
        choice_mode: "single" | "multi";
      };
    }) => {
      const { data, error } = await client.POST(
        "/v1/channels/{channelId}/polls",
        { params: { path: { channelId } }, body },
      );
      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["polls"] });
      queryClient.invalidateQueries({ queryKey: ["channels"] });
    },
  });
}

export function useVote() {
  const client = useFrappClient();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({
      messageId,
      body,
    }: {
      messageId: string;
      body: { option_indexes: number[] };
    }) => {
      const { data, error } = await client.POST(
        "/v1/polls/{messageId}/vote",
        { params: { path: { messageId } }, body },
      );
      if (error) throw error;
      return data;
    },
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({
        queryKey: ["polls", variables.messageId],
      });
    },
  });
}

export function useRemoveVote() {
  const client = useFrappClient();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (messageId: string) => {
      const { data, error } = await client.DELETE(
        "/v1/polls/{messageId}/vote",
        { params: { path: { messageId } } },
      );
      if (error) throw error;
      return data;
    },
    onSuccess: (_data, messageId) => {
      queryClient.invalidateQueries({ queryKey: ["polls", messageId] });
    },
  });
}
