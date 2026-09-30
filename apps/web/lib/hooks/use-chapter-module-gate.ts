"use client";

import { useCallback } from "react";
import { useCurrentChapter } from "@repo/hooks";
import { isModuleEnabled } from "@repo/validation";
import { useChapterStore } from "@/lib/stores/chapter-store";

/**
 * The module gate for member-facing chrome: the sidebar, the drawer, the Ask
 * pill, the Settings tools list, and chat's slash commands.
 *
 * **It reads `enabled_modules` from `GET /v1/chapters/current`, not from
 * `useOrgConfig()`.** The config read (`GET /v1/chapters/:id/config`) is guarded
 * by `chapter-config:view`, which no seeded role below President holds. For an
 * ordinary member that query therefore errors on every load, and a gate built
 * on it failed open for good: members kept seeing rows for modules their
 * chapter had switched off (#1982). Chat's slash gate failed the other way,
 * closed for good, so members saw no module commands at all (#2957). The
 * current-chapter payload is the member view (`toChapterMemberView`), which
 * carries `enabled_modules` for exactly these readers.
 */

/** One identity for "the read failed", so a failed gate never looks like a change. */
const GATE_CLOSED = (): boolean => false;

/** The gate plus where its read stands, for a caller that must say which. */
export interface ChapterModuleGateState {
  status: "loading" | "error" | "ready";
  /** Meaningful only when `status` is `"ready"`. */
  isModuleEnabled: (moduleKey: string) => boolean;
  /** Re-runs the member-view read, for a caller offering a Retry. */
  retry: () => void;
}

/**
 * The gate with its read state, for a caller that must refuse differently
 * while the read is pending or failed than when a module is off: chat's slash
 * palette and composer (#2993). Nav chrome wants {@link useChapterModuleGate}.
 *
 * A failed refetch with a cached payload still answers `"ready"` from the
 * cache.
 */
export function useChapterModuleGateState(): ChapterModuleGateState {
  const activeChapterId = useChapterStore((s) => s.activeChapterId);
  const chapterQuery = useCurrentChapter({
    chapterId: activeChapterId,
    enabled: !!activeChapterId,
  });
  const loaded = chapterQuery.data !== undefined;
  const enabledModules = (
    chapterQuery.data as
      | { enabled_modules?: Record<string, boolean> | null }
      | undefined
  )?.enabled_modules;

  const gate = useCallback(
    (moduleKey: string) => isModuleEnabled(enabledModules, moduleKey),
    [enabledModules],
  );
  const { refetch } = chapterQuery;
  const retry = useCallback(() => void refetch(), [refetch]);

  if (loaded) return { status: "ready", isModuleEnabled: gate, retry };
  return {
    status: chapterQuery.isError ? "error" : "loading",
    isModuleEnabled: GATE_CLOSED,
    retry,
  };
}

/**
 * The gate for nav chrome. Returns `undefined` while the read is in flight.
 * Callers treat that as "do not gate", so nothing flashes out of the nav on
 * first paint (`isNavItemVisible`). Once the read has **failed**, the gate
 * closes: a module row it cannot vouch for would lead to a route
 * `ChapterGuard` refuses.
 */
export function useChapterModuleGate():
  | ((moduleKey: string) => boolean)
  | undefined {
  const { status, isModuleEnabled: gate } = useChapterModuleGateState();
  return status === "loading" ? undefined : gate;
}
