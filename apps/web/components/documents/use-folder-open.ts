import { useCallback, useState } from "react";
import { useViewerUserId } from "@repo/hooks";

/**
 * Which folders in the rail's tree this person has opened or closed (#5337),
 * kept in this browser under their id, as List / Grid is (`lib/list-layout.ts`):
 * one member's tidy rail isn't anyone else's, and a laptop keeps its own.
 *
 * Only the folders someone opened or closed are stored, by folder id (a
 * rename keeps it); every other folder takes its starting state
 * (`folderStartsOpen`). Best-effort: a private window or blocked site data
 * reads empty and keeps picks for the tab's life.
 */
export function folderOpenStorageKey(userId: string): string {
  return `frapp.documents.folders-open.${userId}`;
}

function readStored(
  userId: string | null | undefined,
): Record<string, boolean> {
  if (!userId) return {};
  try {
    const raw = window.localStorage.getItem(folderOpenStorageKey(userId));
    const parsed: unknown = raw ? JSON.parse(raw) : null;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return {};
    }
    const out: Record<string, boolean> = {};
    for (const [key, value] of Object.entries(parsed)) {
      if (typeof value === "boolean") out[key] = value;
    }
    return out;
  } catch {
    return {};
  }
}

export function useFolderOpen(): {
  /** Whether `key`'s folder is open, falling back to `startsOpen`. */
  isOpen: (key: string, startsOpen: boolean) => boolean;
  setOpen: (keys: readonly string[], open: boolean) => void;
} {
  const userId = useViewerUserId();
  const [picks, setPicks] = useState<Record<string, boolean>>(() =>
    readStored(userId),
  );
  /*
    The viewer's id can arrive after the first render; read their picks then,
    while rendering, React's pattern for state that follows a prop.
  */
  const [readFor, setReadFor] = useState(userId);
  if (readFor !== userId) {
    setReadFor(userId);
    setPicks(readStored(userId));
  }

  const isOpen = useCallback(
    (key: string, startsOpen: boolean) => picks[key] ?? startsOpen,
    [picks],
  );

  const setOpen = useCallback(
    (keys: readonly string[], open: boolean) => {
      setPicks((current) => {
        if (keys.every((key) => current[key] === open)) return current;
        const next = { ...current };
        for (const key of keys) next[key] = open;
        if (userId) {
          try {
            window.localStorage.setItem(
              folderOpenStorageKey(userId),
              JSON.stringify(next),
            );
          } catch {
            // Kept in memory for the tab's life.
          }
        }
        return next;
      });
    },
    [userId],
  );

  return { isOpen, setOpen };
}
