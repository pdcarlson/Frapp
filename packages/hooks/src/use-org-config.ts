"use client";

import { useMemo } from "react";
import {
  useMutation,
  useMutationState,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import { useFrappClient, useActiveChapterId } from "./use-frapp-client";
import type { components } from "@repo/api-sdk";
import { isModuleEnabled } from "@repo/validation";
import type {
  ChapterDuesConfig,
  ChapterPointsConfig,
  PatchChapterConfig,
} from "@repo/validation";

/** A workflow row in the merged config: catalog presentation + chapter state. */
export interface OrgWorkflow {
  key: string;
  label: string;
  enabled: boolean;
  threshold?: number;
  units?: string;
}

/**
 * The singleton dues config returned by `GET /chapters/:id/config`. Sourced from
 * the shared zod schema so the web shape can't drift from the wire contract.
 */
export type OrgDues = ChapterDuesConfig;

/**
 * The singleton points anti-fraud policy returned by
 * `GET /chapters/:id/config` (#394). Same sourcing rationale as `OrgDues`.
 */
export type OrgPoints = ChapterPointsConfig;

/**
 * What `GET /chapters/:id/config` reports when a chapter has no
 * `chapter_points_config` row — the values `PointsService` enforced before the
 * limits became configurable. Kept here so a surface can render the active
 * limits before the config query resolves without inventing its own numbers.
 */
export const ORG_POINTS_DEFAULTS: OrgPoints = {
  adjustment_rate_limit_per_hour: 50,
  anomaly_threshold: 100,
};

/**
 * Merged chapter config returned by `GET /chapters/:id/config` (archetype
 * defaults overlaid with per-chapter overrides). Known fields are typed; the
 * index signature keeps it forward-compatible with fields added server-side.
 */
export interface OrgConfig {
  org_archetype?: string;
  enabled_modules?: Record<string, boolean>;
  vocabulary?: Record<string, string>;
  branding?: Record<string, unknown>;
  theme_palette?: Record<string, string>;
  beta_config?: Record<string, unknown>;
  workflows?: OrgWorkflow[];
  dues?: OrgDues;
  points?: OrgPoints;
  /** When true, this chapter has opted out of pseudonymous product analytics. */
  analytics_opt_out?: boolean;
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
      // Shared with the API's ChapterGuard so a module the UI treats as off is
      // exactly the set the server rejects writes for (#264).
      isModuleEnabled: (key: string) =>
        isModuleEnabled(data.enabled_modules, key),
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

const configMutationKey = (chapterId: string | null | undefined) =>
  ["chapter-config", chapterId, "patch"] as const;

/**
 * The settings leaves currently being saved, e.g. `enabled_modules.chat`,
 * `dues`, `analytics_opt_out`.
 *
 * Settings surfaces used to share the single `isPending` flag off one
 * `usePatchOrgConfig()` call, so saving anything disabled every control on
 * every tab — toggling one module greyed out the Dues form (#881). Reading the
 * in-flight *variables* instead lets each control ask only about itself.
 *
 * Top-level keys are reported as-is; `enabled_modules` additionally reports one
 * entry per module key, since that tab renders a switch per module and they
 * save independently.
 */
export function usePendingConfigKeys(): ReadonlySet<string> {
  const chapterId = useActiveChapterId();
  const pending = useMutationState({
    filters: { mutationKey: configMutationKey(chapterId), status: "pending" },
    select: (mutation) => mutation.state.variables as PatchChapterConfig,
  });

  return useMemo(() => {
    const keys = new Set<string>();
    for (const diff of pending) {
      if (!diff) continue;
      for (const [key, value] of Object.entries(diff)) {
        keys.add(key);
        if (key === "enabled_modules" && value && typeof value === "object") {
          for (const moduleKey of Object.keys(value)) {
            keys.add(`enabled_modules.${moduleKey}`);
          }
        }
      }
    }
    return keys;
  }, [pending]);
}

export function usePatchOrgConfig() {
  const client = useFrappClient();
  const chapterId = useActiveChapterId();
  const qc = useQueryClient();
  const queryKey = ["chapter-config", chapterId] as const;

  return useMutation({
    // Identifies this mutation to `usePendingConfigKeys` below, which needs to
    // know WHICH settings are in flight rather than merely that something is.
    mutationKey: configMutationKey(chapterId),
    // Serialises concurrent config PATCHes. The server deep-merges against the
    // row it reads (`chapter-config.service.ts` does a read-modify-write on
    // `enabled_modules`), so two overlapping writes each merge against a stale
    // copy and the later one silently drops the earlier toggle.
    scope: { id: `chapter-config:${chapterId ?? "none"}` },
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
