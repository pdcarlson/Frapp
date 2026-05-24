"use client";

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useFrappClient, useActiveChapterId } from "@repo/hooks";
import type { components } from "@repo/api-sdk";
import type { PatchChapterConfig } from "@repo/validation";

type OrgConfig = Record<string, unknown>;

export function useOrgConfig() {
  const client = useFrappClient();
  const chapterId = useActiveChapterId();

  return useQuery({
    queryKey: ["chapter-config", chapterId],
    queryFn: async () => {
      const { data, error } = await client.GET("/v1/chapters/{id}/config", {
        params: { path: { id: chapterId as string } },
      });
      if (error) throw error;
      return (data ?? {}) as unknown as OrgConfig;
    },
    enabled: !!chapterId,
    staleTime: 5 * 60 * 1000,
    select: (data) => ({
      ...data,
      isModuleEnabled: (key: string) =>
        (data["enabled_modules"] as Record<string, boolean> | undefined)?.[
          key
        ] !== false,
    }),
  });
}

export function usePatchOrgConfig() {
  const client = useFrappClient();
  const chapterId = useActiveChapterId();
  const qc = useQueryClient();

  return useMutation({
    mutationFn: async (diff: PatchChapterConfig) => {
      if (!chapterId) throw new Error("No active chapter selected");
      const { data, error } = await client.PATCH("/v1/chapters/{id}/config", {
        params: { path: { id: chapterId } },
        // PatchChapterConfig (zod-inferred) is the wire shape; the generated
        // DTO types record values as `never`, so cast at this boundary.
        body: diff as components["schemas"]["PatchChapterConfigDto"],
      });
      if (error) throw error;
      return (data ?? {}) as unknown as OrgConfig;
    },
    onSuccess: () => {
      void qc.invalidateQueries({
        queryKey: ["chapter-config", chapterId],
      });
    },
  });
}
