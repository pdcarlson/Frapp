"use client";

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useFrappClient } from "./use-frapp-client";
import type { components } from "@repo/api-sdk";

type ConfirmBackworkUploadDto = components["schemas"]["ConfirmBackworkUploadDto"];

export function useBackworkResources(filters?: {
  department_id?: string;
  professor_id?: string;
  course_number?: string;
  year?: number;
  semester?: string;
  assignment_type?: string;
  document_variant?: string;
  search?: string;
}) {
  const client = useFrappClient();
  return useQuery({
    queryKey: ["backwork", filters],
    queryFn: async () => {
      const { data, error } = await client.GET("/v1/backwork", {
        params: { query: filters },
      });
      if (error) throw error;
      return data;
    },
    staleTime: 60_000,
  });
}

export function useBackworkResource(id: string) {
  const client = useFrappClient();
  return useQuery({
    queryKey: ["backwork", id],
    queryFn: async () => {
      const { data, error } = await client.GET("/v1/backwork/{id}", {
        params: { path: { id } },
      });
      if (error) throw error;
      return data;
    },
    staleTime: 60_000,
    enabled: !!id,
  });
}

export function useDepartments() {
  const client = useFrappClient();
  return useQuery({
    queryKey: ["backwork", "departments"],
    queryFn: async () => {
      const { data, error } = await client.GET("/v1/backwork/departments");
      if (error) throw error;
      return data;
    },
    staleTime: 60_000,
  });
}

export function useProfessors() {
  const client = useFrappClient();
  return useQuery({
    queryKey: ["backwork", "professors"],
    queryFn: async () => {
      const { data, error } = await client.GET("/v1/backwork/professors");
      if (error) throw error;
      return data;
    },
    staleTime: 60_000,
  });
}

export function useRequestBackworkUploadUrl() {
  const client = useFrappClient();
  return useMutation({
    mutationFn: async (body: { filename: string; content_type: string }) => {
      const { data, error } = await client.POST("/v1/backwork/upload-url", {
        body,
      });
      if (error) throw error;
      return data;
    },
  });
}

export function useConfirmBackworkUpload() {
  const client = useFrappClient();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (body: ConfirmBackworkUploadDto) => {
      const { data, error } = await client.POST("/v1/backwork", { body });
      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["backwork"] });
    },
  });
}

export function useDeleteBackworkResource() {
  const client = useFrappClient();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      const { data, error } = await client.DELETE("/v1/backwork/{id}", {
        params: { path: { id } },
      });
      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["backwork"] });
    },
  });
}

export function useUpdateDepartment() {
  const client = useFrappClient();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({
      id,
      body,
    }: {
      id: string;
      body: { name?: string };
    }) => {
      const { data, error } = await client.PATCH(
        "/v1/backwork/departments/{id}",
        { params: { path: { id } }, body },
      );
      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: ["backwork", "departments"],
      });
    },
  });
}
