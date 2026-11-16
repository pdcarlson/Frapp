import AsyncStorage from "@react-native-async-storage/async-storage";

/**
 * The member's last few searches on this phone, shown on the Search screen
 * before they type (#5139). iOS's search screens (Mail, Messages, the App
 * Store) and Slack open on the same list. They stay on this phone and in
 * this chapter: a search is the member's own words, so nothing is sent to
 * the server, and a chapter switch shows that chapter's list.
 *
 * Every read and write is best-effort. A phone that can't store them simply
 * opens Search on an empty field.
 */

/** How many are kept and shown. A short list, under the field. */
export const RECENT_SEARCH_LIMIT = 6;

function key(userId: string, chapterId: string | null): string {
  return `frapp.recentSearches.${userId}.${chapterId ?? "sole"}`;
}

/**
 * `searches` with `query` put first: trimmed, an earlier copy that differs
 * only in letter case dropped, and the list cut to
 * {@link RECENT_SEARCH_LIMIT}. Pure, so the rule is testable without storage.
 */
export function withRecentSearch(
  searches: readonly string[],
  query: string,
): string[] {
  const term = query.trim();
  if (term === "") return [...searches];
  const lower = term.toLowerCase();
  return [term, ...searches.filter((s) => s.toLowerCase() !== lower)].slice(
    0,
    RECENT_SEARCH_LIMIT,
  );
}

/** What was stored, kept only if it is a list of strings. */
export function parseRecentSearches(raw: string | null): string[] {
  if (!raw) return [];
  try {
    const value: unknown = JSON.parse(raw);
    if (!Array.isArray(value)) return [];
    return value
      .filter((s): s is string => typeof s === "string" && s.trim() !== "")
      .slice(0, RECENT_SEARCH_LIMIT);
  } catch {
    return [];
  }
}

export async function readRecentSearches(
  userId: string,
  chapterId: string | null,
): Promise<string[]> {
  try {
    return parseRecentSearches(await AsyncStorage.getItem(key(userId, chapterId)));
  } catch {
    return [];
  }
}

export function writeRecentSearches(
  userId: string,
  chapterId: string | null,
  searches: readonly string[],
): void {
  const stored =
    searches.length === 0
      ? AsyncStorage.removeItem(key(userId, chapterId))
      : AsyncStorage.setItem(key(userId, chapterId), JSON.stringify(searches));
  stored.catch(() => {
    /* Best-effort: the list is a convenience, never the member's data. */
  });
}
