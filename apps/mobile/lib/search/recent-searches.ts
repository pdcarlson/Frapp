import { useCallback, useEffect, useState } from "react";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { useActiveChapterId, useViewerUserId } from "@repo/hooks";

/**
 * The Search screen's recent searches (#5139): what this member searched for
 * in this chapter, on this phone, newest first. A search counts once the
 * member opens one of its results or presses Search on the keyboard, so a
 * half-typed word is never kept. Slack, Discord and iOS's own search keep the
 * same short list under an empty field.
 *
 * Kept per member and chapter, since a search names that chapter's channels
 * and people. Best-effort both ways, as every phone-only memory here is
 * (`lib/chat/last-channel.ts`): a failed read shows no list, and a failed
 * write keeps the list for as long as the screen is open.
 */

/** How many are kept and shown. */
export const RECENT_SEARCH_LIMIT = 8;

const KEY_PREFIX = "frapp.search.recent.v1";
const NONE: readonly string[] = [];

export function recentSearchesKey(
  userId: string,
  chapterId: string | null,
): string {
  return `${KEY_PREFIX}:${userId}:${chapterId ?? "sole"}`;
}

/**
 * `query` at the front, any earlier copy of it (in any case) dropped, and the
 * list cut to {@link RECENT_SEARCH_LIMIT}. A blank query changes nothing.
 */
export function rememberSearch(
  list: readonly string[],
  query: string,
): string[] {
  const kept = query.trim();
  if (!kept) return [...list];
  const lower = kept.toLowerCase();
  return [kept, ...list.filter((entry) => entry.toLowerCase() !== lower)].slice(
    0,
    RECENT_SEARCH_LIMIT,
  );
}

/** The stored string as a list, or empty for anything else. */
export function parseRecentSearches(raw: unknown): string[] {
  if (typeof raw !== "string") return [];
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter((entry): entry is string => typeof entry === "string")
      .map((entry) => entry.trim())
      .filter(Boolean)
      .slice(0, RECENT_SEARCH_LIMIT);
  } catch {
    return [];
  }
}

export function useRecentSearches(): {
  recent: readonly string[];
  remember: (query: string) => void;
  clear: () => void;
} {
  const userId = useViewerUserId();
  const chapterId = useActiveChapterId() ?? null;
  const key = userId ? recentSearchesKey(userId, chapterId) : null;
  // Held with the key it was read for, so a change of member or chapter
  // shows nothing until that list is read, never the last one's.
  const [held, setHeld] = useState<{
    key: string | null;
    list: readonly string[];
  }>({ key: null, list: [] });
  const recent = held.key === key ? held.list : NONE;

  useEffect(() => {
    if (!key) return;
    let live = true;
    AsyncStorage.getItem(key)
      .then((raw) => {
        if (live) setHeld({ key, list: parseRecentSearches(raw) });
      })
      .catch(() => {
        /* No list, rather than a wrong one. */
      });
    return () => {
      live = false;
    };
  }, [key]);

  const write = useCallback(
    (next: readonly string[]) => {
      setHeld({ key, list: next });
      if (!key) return;
      AsyncStorage.setItem(key, JSON.stringify(next)).catch(() => {
        /* Best-effort: the list holds while the screen is open. */
      });
    },
    [key],
  );

  const remember = useCallback(
    (query: string) => write(rememberSearch(recent, query)),
    [recent, write],
  );

  const clear = useCallback(() => write([]), [write]);

  return { recent, remember, clear };
}
