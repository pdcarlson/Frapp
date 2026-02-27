"use client";

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useFrappClient } from "./use-frapp-client";

export function useChannels() {
  const client = useFrappClient();
  return useQuery({
    queryKey: ["channels"],
    queryFn: async () => {
      const { data, error } = await client.GET("/v1/channels");
      if (error) throw error;
      return data;
    },
    staleTime: 60_000,
  });
}

export function useChannel(id: string) {
  const client = useFrappClient();
  return useQuery({
    queryKey: ["channels", id],
    queryFn: async () => {
      const { data, error } = await client.GET("/v1/channels/{id}", {
        params: { path: { id } },
      });
      if (error) throw error;
      return data;
    },
    staleTime: 60_000,
    enabled: !!id,
  });
}

export function useMessages(
  channelId: string,
  options?: { limit?: number; before?: string },
) {
  const client = useFrappClient();
  return useQuery({
    queryKey: ["channels", channelId, "messages", options],
    queryFn: async () => {
      const { data, error } = await client.GET("/v1/channels/{id}/messages", {
        params: { path: { id: channelId }, query: options },
      });
      if (error) throw error;
      return data;
    },
    staleTime: 0,
    enabled: !!channelId,
  });
}

export function usePinnedMessages(channelId: string) {
  const client = useFrappClient();
  return useQuery({
    queryKey: ["channels", channelId, "pins"],
    queryFn: async () => {
      const { data, error } = await client.GET("/v1/channels/{id}/pins", {
        params: { path: { id: channelId } },
      });
      if (error) throw error;
      return data;
    },
    staleTime: 0,
    enabled: !!channelId,
  });
}

export function useReactions(messageId: string) {
  const client = useFrappClient();
  return useQuery({
    queryKey: ["messages", messageId, "reactions"],
    queryFn: async () => {
      const { data, error } = await client.GET(
        "/v1/channels/messages/{messageId}/reactions",
        { params: { path: { messageId } } },
      );
      if (error) throw error;
      return data;
    },
    staleTime: 0,
    enabled: !!messageId,
  });
}

export function useCategories() {
  const client = useFrappClient();
  return useQuery({
    queryKey: ["channels", "categories"],
    queryFn: async () => {
      const { data, error } = await client.GET(
        "/v1/channels/categories/list",
      );
      if (error) throw error;
      return data;
    },
    staleTime: 60_000,
  });
}

export function useCreateChannel() {
  const client = useFrappClient();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (body: {
      name: string;
      description?: string;
      type: "PUBLIC" | "PRIVATE" | "ROLE_GATED";
      required_permissions?: string[];
      category_id?: string;
      is_read_only: boolean;
    }) => {
      const { data, error } = await client.POST("/v1/channels", { body });
      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["channels"] });
    },
  });
}

export function useUpdateChannel() {
  const client = useFrappClient();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({
      id,
      body,
    }: {
      id: string;
      body: {
        name?: string;
        description?: string;
        required_permissions?: string[];
        category_id?: string;
        is_read_only?: boolean;
      };
    }) => {
      const { data, error } = await client.PATCH("/v1/channels/{id}", {
        params: { path: { id } },
        body,
      });
      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["channels"] });
    },
  });
}

export function useDeleteChannel() {
  const client = useFrappClient();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      const { data, error } = await client.DELETE("/v1/channels/{id}", {
        params: { path: { id } },
      });
      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["channels"] });
    },
  });
}

export function useGetOrCreateDm() {
  const client = useFrappClient();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (body: { member_id: string }) => {
      const { data, error } = await client.POST("/v1/channels/dm", { body });
      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["channels"] });
    },
  });
}

export function useCreateGroupDm() {
  const client = useFrappClient();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (body: { member_ids: string[]; name?: string }) => {
      const { data, error } = await client.POST("/v1/channels/group-dm", {
        body,
      });
      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["channels"] });
    },
  });
}

export function useSendMessage() {
  const client = useFrappClient();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({
      channelId,
      body,
    }: {
      channelId: string;
      body: {
        content: string;
        reply_to_id?: string;
        metadata?: Record<string, never>;
      };
    }) => {
      const { data, error } = await client.POST("/v1/channels/{id}/messages", {
        params: { path: { id: channelId } },
        body,
      });
      if (error) throw error;
      return data;
    },
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({
        queryKey: ["channels", variables.channelId, "messages"],
      });
    },
  });
}

export function useEditMessage() {
  const client = useFrappClient();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({
      messageId,
      body,
    }: {
      messageId: string;
      body: { content: string };
    }) => {
      const { data, error } = await client.PATCH(
        "/v1/channels/messages/{messageId}",
        { params: { path: { messageId } }, body },
      );
      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["channels"] });
    },
  });
}

export function useDeleteMessage() {
  const client = useFrappClient();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (messageId: string) => {
      const { data, error } = await client.DELETE(
        "/v1/channels/messages/{messageId}",
        { params: { path: { messageId } } },
      );
      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["channels"] });
    },
  });
}

export function usePinMessage() {
  const client = useFrappClient();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (messageId: string) => {
      const { data, error } = await client.POST(
        "/v1/channels/messages/{messageId}/pin",
        { params: { path: { messageId } } },
      );
      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["channels"] });
    },
  });
}

export function useUnpinMessage() {
  const client = useFrappClient();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (messageId: string) => {
      const { data, error } = await client.DELETE(
        "/v1/channels/messages/{messageId}/pin",
        { params: { path: { messageId } } },
      );
      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["channels"] });
    },
  });
}

export function useToggleReaction() {
  const client = useFrappClient();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({
      messageId,
      body,
    }: {
      messageId: string;
      body: { emoji: string };
    }) => {
      const { data, error } = await client.POST(
        "/v1/channels/messages/{messageId}/reactions",
        { params: { path: { messageId } }, body },
      );
      if (error) throw error;
      return data;
    },
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({
        queryKey: ["messages", variables.messageId, "reactions"],
      });
    },
  });
}

export function useMarkChannelRead() {
  const client = useFrappClient();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      const { data, error } = await client.POST("/v1/channels/{id}/read", {
        params: { path: { id } },
      });
      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["channels"] });
    },
  });
}

export function useRequestChatUploadUrl() {
  const client = useFrappClient();
  return useMutation({
    mutationFn: async ({
      id,
      body,
    }: {
      id: string;
      body: { filename: string; content_type: string };
    }) => {
      const { data, error } = await client.POST(
        "/v1/channels/{id}/upload-url",
        { params: { path: { id } }, body },
      );
      if (error) throw error;
      return data;
    },
  });
}

export function useCreateCategory() {
  const client = useFrappClient();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (body: { name: string; display_order: number }) => {
      const { data, error } = await client.POST("/v1/channels/categories", {
        body,
      });
      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: ["channels", "categories"],
      });
    },
  });
}

export function useUpdateCategory() {
  const client = useFrappClient();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({
      id,
      body,
    }: {
      id: string;
      body: { name?: string; display_order?: number };
    }) => {
      const { data, error } = await client.PATCH(
        "/v1/channels/categories/{id}",
        { params: { path: { id } }, body },
      );
      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: ["channels", "categories"],
      });
    },
  });
}

export function useDeleteCategory() {
  const client = useFrappClient();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      const { data, error } = await client.DELETE(
        "/v1/channels/categories/{id}",
        { params: { path: { id } } },
      );
      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: ["channels", "categories"],
      });
    },
  });
}
