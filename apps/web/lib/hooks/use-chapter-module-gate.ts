"use client";

import { useCallback } from "react";
import { useCurrentChapter } from "@repo/hooks";
import { isModuleEnabled } from "@repo/validation";
import { useChapterStore } from "@/lib/stores/chapter-store";

/**
 * The module gate for member-facing chrome: the sidebar, the drawer, the Ask
 * pill and the Settings tools list.
 *
 * **It reads `enabled_modules` from `GET /v1/chapters/current`, not from
 * `useOrgConfig()`.** The config read (`GET /v1/chapters/:id/config`) is guarded
 * by `chapter-config:view`, which no seeded role below President holds. For an
 * ordinary member that query therefore errors on every load, and a gate built
 * on it failed open for good: members kept seeing rows for modules their
 * chapter had switched off (#1982). The current-chapter payload is the member
 * view (`toChapterMemberView`), which carries `enabled_modules` for exactly
 * this reader.
 *
 * Returns `undefined` while the read is in flight. Callers treat that as "do
 * not gate", so nothing flashes out of the nav on first paint
 * (`isNavItemVisible`). Once the read has **failed**, the gate closes: a module
 * row it cannot vouch for would lead to a route `ChapterGuard` refuses.
 */
/** One identity for "the read failed", so a failed gate never looks like a change. */
const GATE_CLOSED = (): boolean => false;

export function useChapterModuleGate():
  | ((moduleKey: string) => boolean)
  | undefined {
  const activeChapterId = useChapterStore((s) => s.activeChapterId);
  const chapterQuery = useCurrentChapter({
    chapterId: activeChapterId,
    enabled: !!activeChapterId,
  });
  const loaded = chapterQuery.data !== undefined;
  // A failed refetch with a cached payload still answers from the cache.
  const failed = chapterQuery.isError && !loaded;
  const enabledModules = (
    chapterQuery.data as
      | { enabled_modules?: Record<string, boolean> | null }
      | undefined
  )?.enabled_modules;

  const gate = useCallback(
    (moduleKey: string) => isModuleEnabled(enabledModules, moduleKey),
    [enabledModules],
  );

  if (failed) return GATE_CLOSED;
  if (!loaded) return undefined;
  return gate;
}
