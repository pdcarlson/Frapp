"use client";

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useFrappClient } from "./use-frapp-client";

export function useDocuments(folder?: string) {
  const client = useFrappClient();
  return useQuery({
    queryKey: ["documents", folder],
    queryFn: async () => {
      const { data, error } = await client.GET("/v1/documents", {
        params: { query: { folder } },
      });
      if (error) throw error;
      return data;
    },
    staleTime: 60_000,
  });
}

export function useDocument(id: string) {
  const client = useFrappClient();
  return useQuery({
    queryKey: ["documents", id],
    queryFn: async () => {
      const { data, error } = await client.GET("/v1/documents/{id}", {
        params: { path: { id } },
      });
      if (error) throw error;
      return data;
    },
    staleTime: 60_000,
    enabled: !!id,
  });
}

export function useRequestDocumentUploadUrl() {
  const client = useFrappClient();
  return useMutation({
    mutationFn: async (body: { filename: string; content_type: string }) => {
      const { data, error } = await client.POST("/v1/documents/upload-url", {
        body,
      });
      if (error) throw error;
      return data;
    },
  });
}

export function useConfirmDocumentUpload() {
  const client = useFrappClient();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (body: {
      storage_path: string;
      title: string;
      description?: string;
      folder?: string;
    }) => {
      const { data, error } = await client.POST("/v1/documents", { body });
      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["documents"] });
    },
  });
}

export function useDeleteDocument() {
  const client = useFrappClient();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      const { data, error } = await client.DELETE("/v1/documents/{id}", {
        params: { path: { id } },
      });
      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["documents"] });
    },
  });
}
