import { useCallback, useState } from "react";
import { useTenantScope } from "@/lib/tenancy/scope";

/**
 * Which folders in the rail's tree this person has opened or closed (#5337),
 * kept in this browser under their id and the chapter's, as List / Grid keeps
 * its pick (`lib/list-layout.ts`): one member's tidy rail isn't anyone
 * else's, a laptop keeps its own, and a folder name in one chapter says
 * nothing about another's.
 *
 * Only the folders someone opened or closed are stored, by folder id (a
 * rename keeps it); every other folder takes its starting state
 * (`folderStartsOpen`). Best-effort: a private window or blocked site data
 * reads empty and keeps picks for the tab's life, and so does a pick made
 * before the viewer and chapter are known, which then stands until that
 * folder's own stored pick says otherwise.
 */
export function folderOpenStorageKey(
  userId: string,
  chapterId: string,
): string {
  return `frapp.documents.folders-open.${userId}.${chapterId}`;
}

type Picks = Record<string, boolean>;

function readStored(key: string | null): Picks {
  if (!key) return {};
  try {
    const raw = window.localStorage.getItem(key);
    const parsed: unknown = raw ? JSON.parse(raw) : null;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return {};
    }
    const out: Picks = {};
    for (const [folder, value] of Object.entries(parsed)) {
      if (typeof value === "boolean") out[folder] = value;
    }
    return out;
  } catch {
    return {};
  }
}

function writeStored(key: string | null, picks: Picks): void {
  if (!key) return;
  try {
    window.localStorage.setItem(key, JSON.stringify(picks));
  } catch {
    // Kept in memory for the tab's life.
  }
}

export function useFolderOpen(): {
  /** Whether `key`'s folder is open, falling back to `startsOpen`. */
  isOpen: (key: string, startsOpen: boolean) => boolean;
  setOpen: (keys: readonly string[], open: boolean) => void;
} {
  const scope = useTenantScope();
  const storageKey = scope
    ? folderOpenStorageKey(scope.userId, scope.chapterId)
    : null;
  const [picks, setPicks] = useState<Picks>(() => readStored(storageKey));
  /*
    The scope can arrive after the first render, or change with the chapter;
    read that scope's picks then, while rendering, React's pattern for state
    that follows a prop. Picks made before any scope was known join them.
  */
  const [readFor, setReadFor] = useState(storageKey);
  if (readFor !== storageKey) {
    setReadFor(storageKey);
    const stored = readStored(storageKey);
    if (readFor === null && storageKey) {
      const merged = { ...picks, ...stored };
      writeStored(storageKey, merged);
      setPicks(merged);
    } else {
      setPicks(stored);
    }
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
        writeStored(storageKey, next);
        return next;
      });
    },
    [storageKey],
  );

  return { isOpen, setOpen };
}
