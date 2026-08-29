"use client";

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useFrappClient } from "./use-frapp-client";

export function useSemesters() {
  const client = useFrappClient();
  return useQuery({
    queryKey: ["semesters"],
    queryFn: async () => {
      const { data, error } = await client.GET("/v1/semesters");
      if (error) throw error;
      return data;
    },
    staleTime: 300_000,
  });
}

export function useSemesterRollover() {
  const client = useFrappClient();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (body: {
      label: string;
      start_date: string;
      end_date: string;
      /**
       * Bulk-promote the chapter's New Members to Member alongside the archive.
       * Optional here and defaulted below; the API treats an absent flag as
       * false, and the generated SDK type is non-optional only because
       * openapi-typescript drops `?` from any property carrying a `default`.
       */
      promote_new_members?: boolean;
    }) => {
      const { data, error } = await client.POST(
        "/v1/chapters/current/rollover",
        {
          body: {
            ...body,
            promote_new_members: body.promote_new_members ?? false,
          },
        },
      );
      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["semesters"] });
      queryClient.invalidateQueries({ queryKey: ["chapters"] });
      // Promotion rewrites members.role_ids across the chapter, so any cached
      // roster or permission-derived view is stale once this succeeds.
      queryClient.invalidateQueries({ queryKey: ["members"] });
    },
  });
}
