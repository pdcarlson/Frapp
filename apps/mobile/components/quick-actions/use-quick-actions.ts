import { useCallback, useEffect, useMemo, useState } from "react";
import {
  useActiveChapterId,
  useCurrentChapter,
  useMyPermissions,
  useViewerUserId,
} from "@repo/hooks";
import {
  availableQuickActions,
  mergeSavedQuickActions,
  type QuickActionKey,
  readSavedQuickActions,
  resolveQuickActions,
  writeSavedQuickActions,
} from "@/lib/quick-actions";

export type QuickActionsState = {
  /** What the panel shows, in order. */
  shown: QuickActionKey[];
  /** Everything this member may place in it. */
  available: QuickActionKey[];
  /** Keeps a new arrangement, on the phone, for this member and chapter. */
  save: (keys: readonly QuickActionKey[]) => void;
  /**
   * Whether the member's role and the chapter's modules are in hand. Until
   * they are, `available` is short, so the panel runs actions but doesn't
   * offer editing: an arrangement built then would be built from the wrong
   * list.
   */
  ready: boolean;
};

const NO_PERMISSIONS: readonly string[] = [];

export function useQuickActions(): QuickActionsState {
  const permissionsQuery = useMyPermissions();
  const permissions = useMemo(
    () =>
      Array.isArray(permissionsQuery.data?.permissions)
        ? permissionsQuery.data.permissions
        : NO_PERMISSIONS,
    [permissionsQuery.data],
  );
  // The member view of the chapter: officers and members alike can read its
  // `enabled_modules`, which the org config endpoint is not (#1982).
  const chapterQuery = useCurrentChapter();
  const enabledModules = chapterQuery.data?.enabled_modules;
  const userId = useViewerUserId();
  const chapterId = useActiveChapterId() ?? null;

  const available = useMemo(
    () => availableQuickActions({ permissions, enabledModules }),
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
      // An edit made while the read was out is newer than what it read.
      if (live) {
        setSaved((prev) =>
          prev.key === storeKey ? prev : { key: storeKey, keys },
        );
      }
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
      const merged = mergeSavedQuickActions(next, keys, available);
      setSaved({ key: storeKey, keys: merged });
      if (userId) writeSavedQuickActions(userId, chapterId, merged);
    },
    [keys, available, storeKey, userId, chapterId],
  );

  const ready =
    permissionsQuery.data !== undefined && chapterQuery.data !== undefined;

  return { shown, available, save, ready };
}
