"use client";

import { useQuery } from "@tanstack/react-query";
import { useFrappClient } from "./use-frapp-client";

/** A row from `GET /v1/chapter-directory/search` (Chunk 02 endpoint). */
export interface ChapterDirectoryResult {
  id: string;
  org_letters: string;
  org_name: string;
  archetype: string;
  chapter_designation: string | null;
  university: string;
  university_short: string;
  founded_year: number | null;
  /**
   * One accent seed, not a pair — `accent-engine.md` §1. The `dark` half went
   * with #1225; nothing had read it since #1224 removed `branding.colors.dark`.
   * Still optional: the column is unconstrained jsonb and defaults to `{}`.
   */
  default_colors: { accent?: string } | null;
  website: string | null;
}

/** Minimum query length before we hit the directory endpoint. */
export const DIRECTORY_MIN_QUERY_LENGTH = 2;

export function useChapterDirectorySearch(
  query: string,
  options?: { university?: string; enabled?: boolean },
) {
  const client = useFrappClient();
  const q = query.trim();
  const university = options?.university?.trim() || undefined;
  const enabled =
    (options?.enabled ?? true) && q.length >= DIRECTORY_MIN_QUERY_LENGTH;

  return useQuery({
    queryKey: ["chapter-directory", "search", q, university ?? null],
    queryFn: async () => {
      const { data, error } = await client.GET("/v1/chapter-directory/search", {
        params: { query: { q, ...(university ? { university } : {}) } },
      });
      if (error) throw error;
      return (data ?? []) as ChapterDirectoryResult[];
    },
    enabled,
    staleTime: 60_000,
  });
}
