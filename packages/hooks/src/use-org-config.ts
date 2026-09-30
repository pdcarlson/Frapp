"use client";

import { useMemo } from "react";
import {
  useMutation,
  useMutationState,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import { useFrappClient, useActiveChapterId } from "./use-frapp-client";
import { currentChapterQueryKey } from "./use-chapters";
import type { components } from "@repo/api-sdk";
import { isModuleEnabled } from "@repo/validation";
import { CHAPTER_POINTS_CONFIG_DEFAULTS } from "@repo/validation";
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
 * `chapter_points_config` row, so a surface can render the active limits
 * before the config query resolves without inventing its own numbers.
 *
 * Re-exported from `@repo/validation`, which the API reads for the same
 * defaults — a hand-copied number here would compile forever while the
 * server's moved, and the dashboard would state an anti-fraud limit nobody
 * enforces.
 */
export const ORG_POINTS_DEFAULTS: OrgPoints = CHAPTER_POINTS_CONFIG_DEFAULTS;

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
  /**
   * Role new invites default to (#422). `null` means no default is configured
   * and the API falls back to the seeded Member role. Typed explicitly rather
   * than left to the index signature below, which would surface it as
   * `unknown` at every call site.
   */
  default_invite_role_id?: string | null;
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
  const chapterKey = currentChapterQueryKey(chapterId);

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
    //
    // A module toggle is also written into the current-chapter payload. The
    // web shell's module gate (sidebar, drawer, Ask pill, Settings tools) reads
    // `enabled_modules` from there, because members cannot read this config
    // endpoint (#1982), and that query is cached for five minutes. Without this
    // write, switching a module off would leave its nav row up until the cache
    // went stale.
    onMutate: async (diff: PatchChapterConfig) => {
      await qc.cancelQueries({ queryKey });
      const previous = qc.getQueryData<OrgConfig>(queryKey);
      qc.setQueryData<OrgConfig>(queryKey, (old) => applyOptimistic(old, diff));

      const modules = diff.enabled_modules;
      if (!modules) return { previous };
      await qc.cancelQueries({ queryKey: chapterKey });
      // Only the keys this write touches, with the value each had. `scope`
      // serialises the PATCHes but not `onMutate`, so a second toggle's
      // optimistic write lands while this one is in flight; restoring a
      // whole-object snapshot on error would silently undo it too.
      const touchedModules: Record<string, boolean | undefined> = {};
      qc.setQueryData(chapterKey, (old: unknown) => {
        if (!old || typeof old !== "object") return old;
        const current =
          (old as { enabled_modules?: Record<string, boolean> | null })
            .enabled_modules ?? {};
        for (const key of Object.keys(modules)) touchedModules[key] = current[key];
        return { ...old, enabled_modules: { ...current, ...modules } };
      });
      return { previous, touchedModules };
    },
    onError: (_error, _diff, context) => {
      if (context && "previous" in context) {
        qc.setQueryData(queryKey, context.previous);
      }
      const touched = context && "touchedModules" in context ? context.touchedModules : null;
      if (touched) {
        qc.setQueryData(chapterKey, (old: unknown) => {
          if (!old || typeof old !== "object") return old;
          const restored = {
            ...((old as { enabled_modules?: Record<string, boolean> | null })
              .enabled_modules ?? {}),
          };
          for (const [key, value] of Object.entries(touched)) {
            if (value === undefined) delete restored[key];
            else restored[key] = value;
          }
          return { ...old, enabled_modules: restored };
        });
      }
    },
    // Reconcile against the server (which deep-merges + recomputes derived
    // fields such as theme_palette) once the write settles either way. The
    // current chapter is re-read too: it carries `enabled_modules`, `branding`,
    // `vocabulary` and `analytics_opt_out` from the same row. Both re-reads
    // wait for the last config write in flight: fetched while a later toggle
    // is still queued, either would return the row without that toggle and
    // overwrite its optimistic value, flicking the switch and its nav row
    // back. During `onSettled` this mutation still counts as pending, so 1
    // means "only this one".
    onSettled: () => {
      if (qc.isMutating({ mutationKey: configMutationKey(chapterId) }) > 1) return;
      void qc.invalidateQueries({ queryKey });
      void qc.invalidateQueries({ queryKey: chapterKey });
    },
  });
}
