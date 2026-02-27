"use client";

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useFrappClient } from "./use-frapp-client";

export function useTasks(assigneeId?: string) {
  const client = useFrappClient();
  return useQuery({
    queryKey: ["tasks", assigneeId],
    queryFn: async () => {
      const { data, error } = await client.GET("/v1/tasks");
      if (error) throw error;
      return data;
    },
    staleTime: 30_000,
  });
}

export function useTask(id: string) {
  const client = useFrappClient();
  return useQuery({
    queryKey: ["tasks", id],
    queryFn: async () => {
      const { data, error } = await client.GET("/v1/tasks/{id}", {
        params: { path: { id } },
      });
      if (error) throw error;
      return data;
    },
    staleTime: 30_000,
    enabled: !!id,
  });
}

export function useCreateTask() {
  const client = useFrappClient();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (body: {
      title: string;
      description?: string;
      assignee_id: string;
      due_date: string;
      point_reward?: number;
    }) => {
      const { data, error } = await client.POST("/v1/tasks", { body });
      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["tasks"] });
    },
  });
}

export function useUpdateTaskStatus() {
  const client = useFrappClient();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({
      id,
      body,
    }: {
      id: string;
      body: { status: "TODO" | "IN_PROGRESS" | "COMPLETED" | "OVERDUE" };
    }) => {
      const { data, error } = await client.PATCH("/v1/tasks/{id}/status", {
        params: { path: { id } },
        body,
      });
      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["tasks"] });
    },
  });
}

export function useConfirmTask() {
  const client = useFrappClient();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      const { data, error } = await client.POST("/v1/tasks/{id}/confirm", {
        params: { path: { id } },
      });
      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["tasks"] });
      queryClient.invalidateQueries({ queryKey: ["points"] });
    },
  });
}

export function useRejectTask() {
  const client = useFrappClient();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({
      id,
      body,
    }: {
      id: string;
      body?: { comment?: string };
    }) => {
      const { data, error } = await client.POST("/v1/tasks/{id}/reject", {
        params: { path: { id } },
        body: body ?? {},
      });
      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["tasks"] });
    },
  });
}

export function useDeleteTask() {
  const client = useFrappClient();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      const { data, error } = await client.DELETE("/v1/tasks/{id}", {
        params: { path: { id } },
      });
      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["tasks"] });
    },
  });
}
