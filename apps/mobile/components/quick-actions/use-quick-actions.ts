import { useCallback, useEffect, useMemo, useState } from "react";
import {
  useActiveChapterId,
  useCurrentChapter,
  usePermissionList,
  useViewerUserId,
} from "@repo/hooks";
import {
  availableQuickActions,
  type QuickActionKey,
  readSavedQuickActions,
  resolveQuickActions,
  writeSavedQuickActions,
} from "@/lib/quick-actions";

/**
 * Whether this build can open New event from the panel. It turns on with the
 * mobile event sheet ("Let officers add events on mobile"), which mounts in
 * `QuickActionsHost` beside the others.
 */
export const NEW_EVENT_IN_PANEL = false;

export type QuickActionsState = {
  /** What the panel shows, in order. */
  shown: QuickActionKey[];
  /** Everything this member may place in it. */
  available: QuickActionKey[];
  /** Keeps a new arrangement, on the phone, for this member and chapter. */
  save: (keys: readonly QuickActionKey[]) => void;
};

export function useQuickActions(): QuickActionsState {
  const permissions = usePermissionList();
  // The member view of the chapter: officers and members alike can read its
  // `enabled_modules`, which the org config endpoint is not (#1982).
  const chapterQuery = useCurrentChapter();
  const enabledModules = (
    chapterQuery.data as
      { enabled_modules?: Record<string, boolean> } | undefined
  )?.enabled_modules;
  const userId = useViewerUserId();
  const chapterId = useActiveChapterId() ?? null;

  const available = useMemo(
    () =>
      availableQuickActions({
        permissions,
        enabledModules,
        canOpenNewEvent: NEW_EVENT_IN_PANEL,
      }),
    [permissions, enabledModules],
  );

  // The saved arrangement, tagged with whose it is, so a chapter switch shows
  // the starting set until the new chapter's arrangement is read rather than
  // the old chapter's.
  const storeKey = userId ? `${userId}:${chapterId ?? "sole"}` : null;
  const [saved, setSaved] = useState<{
    key: string | null;
    keys: string[] | null;
  }>({ key: null, keys: null });

  useEffect(() => {
    if (!userId) return;
    let live = true;
    void readSavedQuickActions(userId, chapterId).then((keys) => {
      if (live) setSaved({ key: storeKey, keys });
    });
    return () => {
      live = false;
    };
  }, [userId, chapterId, storeKey]);

  const keys = saved.key === storeKey ? saved.keys : null;
  const shown = useMemo(
    () => resolveQuickActions(keys, available),
    [keys, available],
  );

  const save = useCallback(
    (next: readonly QuickActionKey[]) => {
      setSaved({ key: storeKey, keys: [...next] });
      if (userId) writeSavedQuickActions(userId, chapterId, next);
    },
    [storeKey, userId, chapterId],
  );

  return { shown, available, save };
}
