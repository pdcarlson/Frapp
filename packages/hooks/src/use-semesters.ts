"use client";

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useFrappClient } from "./use-frapp-client";

/**
 * `GET /v1/semesters` declares no OpenAPI response schema, so
 * openapi-typescript emits `never` for its body and `useSemesters()`'s `data`
 * is untyped at the wire. This is the one hand-maintained mirror of the
 * `semester_archives` row shape — import it rather than re-declaring it (web
 * previously had two identical copies, in the Points page and Settings).
 */
export type SemesterArchive = {
  id: string;
  label: string;
  start_date: string;
  end_date: string;
  created_at: string;
};

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
