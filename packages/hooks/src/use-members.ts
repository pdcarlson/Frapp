"use client";

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useFrappClient } from "./use-frapp-client";

export function useMembers() {
  const client = useFrappClient();
  return useQuery({
    queryKey: ["members"],
    queryFn: async () => {
      const { data, error } = await client.GET("/v1/members");
      if (error) throw error;
      return data;
    },
    staleTime: 60_000,
  });
}

export function useMember(id: string) {
  const client = useFrappClient();
  return useQuery({
    queryKey: ["members", id],
    queryFn: async () => {
      const { data, error } = await client.GET("/v1/members/{id}", {
        params: { path: { id } },
      });
      if (error) throw error;
      return data;
    },
    staleTime: 60_000,
    enabled: !!id,
  });
}

export function useMemberSearch(query: string) {
  const client = useFrappClient();
  return useQuery({
    queryKey: ["members", "search", query],
    queryFn: async () => {
      const { data, error } = await client.GET("/v1/members/search", {
        params: { query: { q: query } },
      });
      if (error) throw error;
      return data;
    },
    staleTime: 60_000,
    enabled: !!query,
  });
}

export function useAlumni(filters?: {
  graduation_year?: string;
  city?: string;
  company?: string;
}) {
  const client = useFrappClient();
  return useQuery({
    queryKey: ["alumni", filters],
    queryFn: async () => {
      const { data, error } = await client.GET("/v1/alumni", {
        params: { query: filters },
      });
      if (error) throw error;
      return data;
    },
    staleTime: 60_000,
  });
}

export function useUpdateMemberRoles() {
  const client = useFrappClient();
  const queryClient = useQueryClient();
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
      queryClient.invalidateQueries({ queryKey: ["members"] });
    },
  });
}

export function useRemoveMember() {
  const client = useFrappClient();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      const { data, error } = await client.DELETE("/v1/members/{id}", {
        params: { path: { id } },
      });
      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["members"] });
    },
  });
}

export function useUpdateOnboarding() {
  const client = useFrappClient();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (body: { has_completed_onboarding: boolean }) => {
      const { data, error } = await client.PATCH("/v1/members/me/onboarding", {
        body,
      });
      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["members"] });
    },
  });
}
