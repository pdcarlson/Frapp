"use client";

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useFrappClient, useActiveChapterId } from "@repo/hooks";
import type { components } from "@repo/api-sdk";
import type { PatchChapterConfig } from "@repo/validation";

/**
 * Merged chapter config returned by `GET /chapters/:id/config` (archetype
 * defaults overlaid with per-chapter overrides). Known fields are typed; the
 * index signature keeps it forward-compatible with fields added server-side.
 */
/** A workflow row in the merged config: catalog presentation + chapter state. */
export interface OrgWorkflow {
  key: string;
  label: string;
  enabled: boolean;
  threshold?: number;
  units?: string;
}

export interface OrgConfig {
  org_archetype?: string;
  enabled_modules?: Record<string, boolean>;
  vocabulary?: Record<string, string>;
  branding?: Record<string, unknown>;
  theme_palette?: Record<string, string>;
  beta_config?: Record<string, unknown>;
  workflows?: OrgWorkflow[];
  [key: string]: unknown;
}

type OrgConfigWithHelpers = OrgConfig & {
  /** A module is enabled unless explicitly set to `false`. */
  isModuleEnabled: (key: string) => boolean;
};

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
    select: (data): OrgConfigWithHelpers => ({
      ...data,
      isModuleEnabled: (key: string) => data.enabled_modules?.[key] !== false,
    }),
  });
}

/**
 * One-level-deep merge used for optimistic cache updates. JSON config columns
 * (`enabled_modules`, `vocabulary`, `branding`) merge key-by-key so a partial
 * PATCH preserves untouched keys; scalars (`org_archetype`) replace.
 */
function applyOptimistic(
  previous: OrgConfig | undefined,
  diff: PatchChapterConfig,
): OrgConfig {
  const base = (previous ?? {}) as Record<string, unknown>;
  const next: Record<string, unknown> = { ...base };
  for (const [key, value] of Object.entries(diff)) {
    const baseValue = base[key];
    if (
      value &&
      typeof value === "object" &&
      !Array.isArray(value) &&
      baseValue &&
      typeof baseValue === "object" &&
      !Array.isArray(baseValue)
    ) {
      next[key] = { ...(baseValue as object), ...(value as object) };
    } else {
      next[key] = value;
    }
  }
  return next;
}

export function usePatchOrgConfig() {
  const client = useFrappClient();
  const chapterId = useActiveChapterId();
  const qc = useQueryClient();
  const queryKey = ["chapter-config", chapterId] as const;

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
    // Optimistic update: write the merged config into the cache immediately so
    // module toggles and vocabulary edits feel instant, then roll back on error
    // (per the Chunk 06 brief — settings writes go through this mutation).
    onMutate: async (diff: PatchChapterConfig) => {
      await qc.cancelQueries({ queryKey });
      const previous = qc.getQueryData<OrgConfig>(queryKey);
      qc.setQueryData<OrgConfig>(queryKey, (old) => applyOptimistic(old, diff));
      return { previous };
    },
    onError: (_error, _diff, context) => {
      if (context && "previous" in context) {
        qc.setQueryData(queryKey, context.previous);
      }
    },
    // Reconcile against the server (which deep-merges + recomputes derived
    // fields such as theme_palette) once the write settles either way.
    onSettled: () => {
      void qc.invalidateQueries({ queryKey });
    },
  });
}
