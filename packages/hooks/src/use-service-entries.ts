"use client";

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useActiveChapterId, useFrappClient } from "./use-frapp-client";

export function useServiceEntries(
  userId?: string,
  filters?: {
    status?: "PENDING" | "APPROVED" | "REJECTED";
    start_date?: string;
    end_date?: string;
  },
) {
  const client = useFrappClient();
  // The chapter id is in the key because the endpoint resolves the chapter from
  // the request header, not from anything in this call — so without it two
  // chapters' histories share one cache entry and a member who switches sees
  // the previous chapter's hours under the new one.
  const chapterId = useActiveChapterId();
  return useQuery({
    queryKey: ["service-entries", chapterId, userId, filters],
    queryFn: async () => {
      const { data, error } = await client.GET("/v1/service-entries", {
        params: {
          query: {
            userId,
            status: filters?.status,
            start_date: filters?.start_date,
            end_date: filters?.end_date,
          },
        },
      });
      if (error) throw error;
      return data;
    },
    staleTime: 30_000,
  });
}

export function useCreateServiceEntry() {
  const client = useFrappClient();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (body: {
      date: string;
      duration_minutes: number;
      description: string;
      proof_path?: string;
    }) => {
      const { data, error } = await client.POST("/v1/service-entries", {
        body,
      });
      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["service-entries"] });
    },
  });
}

export function useRequestServiceProofUploadUrl() {
  const client = useFrappClient();
  return useMutation({
    mutationFn: async (body: { filename: string; content_type: string }) => {
      const { data, error } = await client.POST(
        "/v1/service-entries/proof-upload-url",
        { body },
      );
      if (error) throw error;
      return data;
    },
  });
}

export function useGetServiceProofUrl() {
  const client = useFrappClient();
  return useMutation({
    mutationFn: async (id: string) => {
      const { data, error } = await client.GET(
        "/v1/service-entries/{id}/proof-url",
        { params: { path: { id } } },
      );
      if (error) throw error;
      return data;
    },
  });
}

export function useReviewServiceEntry() {
  const client = useFrappClient();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({
      id,
      body,
    }: {
      id: string;
      body: {
        status: "APPROVED" | "REJECTED";
        review_comment?: string;
      };
    }) => {
      const { data, error } = await client.PATCH(
        "/v1/service-entries/{id}/review",
        { params: { path: { id } }, body },
      );
      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["service-entries"] });
    },
  });
}

export function useDeleteServiceEntry() {
  const client = useFrappClient();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      const { data, error } = await client.DELETE("/v1/service-entries/{id}", {
        params: { path: { id } },
      });
      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["service-entries"] });
    },
  });
}
