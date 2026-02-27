"use client";

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useFrappClient } from "./use-frapp-client";

export function useRoles() {
  const client = useFrappClient();
  return useQuery({
    queryKey: ["roles"],
    queryFn: async () => {
      const { data, error } = await client.GET("/v1/roles");
      if (error) throw error;
      return data;
    },
    staleTime: 60_000,
  });
}

export function usePermissionsCatalog() {
  const client = useFrappClient();
  return useQuery({
    queryKey: ["roles", "permissions-catalog"],
    queryFn: async () => {
      const { data, error } = await client.GET(
        "/v1/roles/permissions-catalog",
      );
      if (error) throw error;
      return data;
    },
    staleTime: 300_000,
  });
}

export function useCreateRole() {
  const client = useFrappClient();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (body: {
      name: string;
      permissions: string[];
      display_order?: number;
      color?: string;
    }) => {
      const { data, error } = await client.POST("/v1/roles", { body });
      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["roles"] });
    },
  });
}

export function useUpdateRole() {
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
        permissions?: string[];
        display_order?: number;
        color?: string;
      };
    }) => {
      const { data, error } = await client.PATCH("/v1/roles/{id}", {
        params: { path: { id } },
        body,
      });
      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["roles"] });
    },
  });
}

export function useDeleteRole() {
  const client = useFrappClient();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      const { data, error } = await client.DELETE("/v1/roles/{id}", {
        params: { path: { id } },
      });
      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["roles"] });
    },
  });
}

export function useTransferPresidency() {
  const client = useFrappClient();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (body: { target_member_id: string }) => {
      const { data, error } = await client.POST(
        "/v1/roles/transfer-presidency",
        { body },
      );
      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["roles"] });
      queryClient.invalidateQueries({ queryKey: ["members"] });
    },
  });
}
