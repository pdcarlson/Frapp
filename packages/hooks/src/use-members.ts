"use client";

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useActiveChapterId, useFrappClient } from "./use-frapp-client";

export function useMembers() {
  const client = useFrappClient();
  const chapterId = useActiveChapterId();
  return useQuery({
    queryKey: ["members", chapterId],
    queryFn: async () => {
      const { data, error } = await client.GET("/v1/members");
      if (error) throw error;
      return data;
    },
    staleTime: 60_000,
    enabled: !!chapterId,
  });
}

export function useMember(id: string) {
  const client = useFrappClient();
  const chapterId = useActiveChapterId();
  return useQuery({
    queryKey: ["members", chapterId, id],
    queryFn: async () => {
      const { data, error } = await client.GET("/v1/members/{id}", {
        params: { path: { id } },
      });
      if (error) throw error;
      return data;
    },
    staleTime: 60_000,
    enabled: !!chapterId && !!id,
  });
}

export function useMemberSearch(query: string) {
  const client = useFrappClient();
  const chapterId = useActiveChapterId();
  return useQuery({
    queryKey: ["members", chapterId, "search", query],
    queryFn: async () => {
      const { data, error } = await client.GET("/v1/members/search", {
        params: { query: { q: query } },
      });
      if (error) throw error;
      return data;
    },
    staleTime: 60_000,
    enabled: !!chapterId && !!query,
  });
}

export function useAlumni(filters?: {
  graduation_year?: string;
  city?: string;
  company?: string;
}) {
  const client = useFrappClient();
  const chapterId = useActiveChapterId();
  return useQuery({
    queryKey: ["alumni", chapterId, filters],
    queryFn: async () => {
      const { data, error } = await client.GET("/v1/alumni", {
        params: { query: filters },
      });
      if (error) throw error;
      return data;
    },
    staleTime: 60_000,
    enabled: !!chapterId,
  });
}

export function useUpdateMemberRoles() {
  const client = useFrappClient();
  const queryClient = useQueryClient();
  const chapterId = useActiveChapterId();
  return useMutation({
    mutationFn: async ({ id, role_ids }: { id: string; role_ids: string[] }) => {
      const { data, error } = await client.PATCH("/v1/members/{id}/roles", {
        params: { path: { id } },
        body: { role_ids },
      });
      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["members", chapterId] });
    },
  });
}

export function useRemoveMember() {
  const client = useFrappClient();
  const queryClient = useQueryClient();
  const chapterId = useActiveChapterId();
  return useMutation({
    mutationFn: async (id: string) => {
      const { data, error } = await client.DELETE("/v1/members/{id}", {
        params: { path: { id } },
      });
      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["members", chapterId] });
      queryClient.invalidateQueries({ queryKey: ["chapters", chapterId] });
    },
  });
}

export function useUpdateOnboarding() {
  const client = useFrappClient();
  const queryClient = useQueryClient();
  const chapterId = useActiveChapterId();
  return useMutation({
    mutationFn: async (body: { has_completed_onboarding: boolean }) => {
      const { data, error } = await client.PATCH("/v1/members/me/onboarding", {
        body,
      });
      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["members", chapterId] });
    },
  });
}
