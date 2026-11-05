/**
 * Typo-tolerant word matching for lists the page already holds in memory.
 *
 * Built for `/backwork`, whose `GET /v1/backwork` returns the chapter's whole
 * library in one response: once the rows are on the client, matching them here
 * is instant and can forgive typos, which the server's `websearch` full-text
 * search cannot (`spec/behavior/search.md` § Typo tolerance). It is not a
 * replacement for server search on anything paginated.
 *
 * The rules, per query word:
 * - every query word must match some word of the item (AND, like the server);
 * - an exact word scores highest, then a word the query word starts
 *   ("homew" finds "homework"), then a near miss: one edit for words of 4 to 6
 *   letters, two from 7 ("homwork", "thompsn"), counting a swap of two
 *   neighbouring letters as one edit;
 * - numbers never fuzz: "2" must start a word, so "Homework 2" is not found by
 *   "3", and "2120" is not found by "2210";
 * - a short alias table expands the shorthand people type ("hw", "key").
 *
 * The result keeps the item words each query word matched, so the caller can
 * highlight them.
 */

export type FuzzyResult<T> = {
  item: T;
  score: number;
  /** Normalised item words that matched, for highlighting. */
  hits: string[];
};

/** Lowercase, strip punctuation, collapse whitespace. */
export function normalizeWords(text: string): string[] {
  return text
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .split(" ")
    .filter(Boolean);
}

/**
 * Optimal-string-alignment distance, abandoned early once every cell in a row
 * exceeds `max` (the answer can only grow from there).
 */
export function boundedEditDistance(a: string, b: string, max: number): number {
  if (Math.abs(a.length - b.length) > max) return max + 1;
  let prevPrev: number[] = [];
  let prev = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    const row = [i];
    let rowMin = i;
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      let value = Math.min(prev[j]! + 1, row[j - 1]! + 1, prev[j - 1]! + cost);
      if (
        i > 1 &&
        j > 1 &&
        a[i - 1] === b[j - 2] &&
        a[i - 2] === b[j - 1]
      ) {
        value = Math.min(value, prevPrev[j - 2]! + 1);
      }
      row.push(value);
      if (value < rowMin) rowMin = value;
    }
    if (rowMin > max) return max + 1;
    prevPrev = prev;
    prev = row;
  }
  return prev[b.length]!;
}

const EXACT = 3;
const PREFIX = 2.5;
const NEAR = 2;

function allowedEdits(word: string): number {
  if (word.length >= 7) return 2;
  if (word.length >= 4) return 1;
  return 0;
}

/** Best score of one query word against an item's words, and the word it hit. */
function scoreWord(
  query: string,
  words: readonly string[],
): { score: number; hit: string | null } {
  const numeric = /^\d+$/.test(query);
  const edits = numeric ? 0 : allowedEdits(query);
  let best = 0;
  let hit: string | null = null;
  for (const word of words) {
    let score = 0;
    if (word === query) {
      score = EXACT;
    } else if (word.startsWith(query) && (numeric || query.length >= 2)) {
      score = PREFIX;
    } else if (edits > 0) {
      // Compare against the whole word, and against its first
      // `query.length + 1` letters, so a typo in the start of a long word
      // ("homewrk" for "homeworks") still counts as a near miss.
      const head = word.slice(0, query.length + 1);
      const distance = Math.min(
        boundedEditDistance(query, word, edits),
        boundedEditDistance(query, head, edits),
      );
      if (distance <= edits) score = NEAR - distance * 0.5;
    }
    if (score > best) {
      best = score;
      hit = word;
      if (score === EXACT) break;
    }
  }
  return { score: best, hit };
}

/**
 * Filters and ranks `items` by `query`. An empty query returns every item with
 * score 0 in its original order, so a caller can apply its own default sort.
 */
export function fuzzyMatch<T>(
  items: readonly T[],
  query: string,
  toText: (item: T) => string,
  aliases: Readonly<Record<string, string>> = {},
): FuzzyResult<T>[] {
  const queryWords = normalizeWords(query);
  if (queryWords.length === 0) {
    return items.map((item) => ({ item, score: 0, hits: [] }));
  }
  const results: FuzzyResult<T>[] = [];
  for (const item of items) {
    const words = normalizeWords(toText(item));
    let total = 0;
    const hits: string[] = [];
    let matched = true;
    for (const queryWord of queryWords) {
      let best = scoreWord(queryWord, words);
      const alias = aliases[queryWord];
      if (alias) {
        const viaAlias = scoreWord(alias, words);
        if (viaAlias.score > best.score) best = viaAlias;
      }
      if (best.score === 0 || !best.hit) {
        matched = false;
        break;
      }
      total += best.score;
      hits.push(best.hit);
    }
    if (matched) results.push({ item, score: total, hits });
  }
  // Stable: equal scores keep the caller's order.
  return results
    .map((result, index) => ({ result, index }))
    .sort((a, b) => b.result.score - a.result.score || a.index - b.index)
    .map(({ result }) => result);
}

/**
 * Splits `text` into runs, marking each word whose normalised form is in
 * `hits`, for rendering highlights without `dangerouslySetInnerHTML`.
 */
export function highlightRuns(
  text: string,
  hits: readonly string[],
): { text: string; hit: boolean }[] {
  if (hits.length === 0 || !text) return [{ text, hit: false }];
  const wanted = new Set(hits);
  return text
    .split(/(\s+)/)
    .filter((part) => part.length > 0)
    .map((part) => {
      const words = normalizeWords(part);
      return {
        text: part,
        hit: words.length > 0 && words.some((word) => wanted.has(word)),
      };
    });
}
