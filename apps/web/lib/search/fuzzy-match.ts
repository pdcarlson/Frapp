/**
 * Typo-tolerant word matching for lists the page already holds in memory.
 *
 * Built for `/backwork`, whose `GET /v1/backwork` returns the chapter's
 * library in one unpaginated response (capped at PostgREST's `max_rows`, which
 * the page surfaces): once the rows are on the client, matching them here is
 * instant and can forgive typos, which the server's `websearch` full-text
 * library's `?search=` (a case-insensitive substring match, #1357) and global
 * search (`spec/behavior/search.md` § MVP defaults) cannot. It is not a
 * replacement for server search on anything paginated.
 *
 * The rules, per query word:
 * - every query word must match some word of the item (AND, like the server);
 * - an exact word scores highest, then a word the query word starts
 *   ("homew" finds "homework"), then a near miss: one edit for words of 4 to 6
 *   letters, two from 7 ("homwork", "thompsn"), counting a swap of two
 *   neighbouring letters as one edit;
 * - a word with a digit in it never fuzzes, so "2210" does not find "2120"
 *   and "cs201" does not find "cs101";
 * - a number of one or two digits must match a whole word, so "hw 2" finds
 *   Homework 2 but not a Homework 5 from 2025; from three digits a number may
 *   start a word ("212" finds "2120");
 * - a short alias table expands the shorthand people type ("hw", "mt");
 * - Roman and Arabic numerals are not equated here, because "i" and "v" are
 *   ordinary words in titles; `withNumeralVariants` and `isNumeralWord` let a
 *   caller do it for text where they are numbers (Backwork's course names,
 *   `backwork-library.ts`).
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
    // Letters and digits of any script, so a Greek or CJK query narrows the
    // list instead of normalising to nothing and matching everything.
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim()
    .split(" ")
    .filter(Boolean);
}

const ROMAN_NUMERALS = ["i", "ii", "iii", "iv", "v", "vi", "vii", "viii", "ix", "x"];

/**
 * Whether `word` is a number from 1 to 10 in either spelling ("1", "10", "i",
 * "x"): the words `withNumeralVariants` converts.
 */
export function isNumeralWord(word: string): boolean {
  return ROMAN_NUMERALS.includes(word) || /^(?:[1-9]|10)$/.test(word);
}

/**
 * `words` with each Roman numeral from I to X followed by its digits, and each
 * whole number from 1 to 10 by its Roman numeral ("i" → "i", "1"; "2" → "2",
 * "ii"), so a query in either spelling matches it exactly. Only whole words
 * convert: "1010" and "xi" stay as they are.
 */
export function withNumeralVariants(words: readonly string[]): string[] {
  const out: string[] = [];
  for (const word of words) {
    out.push(word);
    const roman = ROMAN_NUMERALS.indexOf(word);
    if (roman !== -1) {
      out.push(String(roman + 1));
    } else if (/^(?:[1-9]|10)$/.test(word)) {
      out.push(ROMAN_NUMERALS[Number(word) - 1]!);
    }
  }
  return out;
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
  const hasDigit = /\d/.test(query);
  const edits = hasDigit ? 0 : allowedEdits(query);
  const prefixOk = !/^\d{1,2}$/.test(query);
  let best = 0;
  let hit: string | null = null;
  for (const word of words) {
    let score = 0;
    if (word === query) {
      score = EXACT;
    } else if (prefixOk && word.startsWith(query)) {
      score = PREFIX;
    } else if (edits > 0) {
      // Compare against the whole word, and against its first
      // `query.length + 1` letters, so a typo in the start of a long word
      // ("homewrk" for "homeworks") still counts as a near miss.
      const head = word.slice(0, query.length + 1);
      let distance = boundedEditDistance(query, word, edits);
      if (head !== word) {
        distance = Math.min(distance, boundedEditDistance(query, head, edits));
      }
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
 * How well one normalised query word matches `words`, trying its alias too:
 * the per-word rule `fuzzyMatchWords` applies, for a caller that scores a
 * subset of an item's words (one phrase) on its own. Score 0 is no match.
 */
export function matchQueryWord(
  queryWord: string,
  words: readonly string[],
  aliases: Readonly<Record<string, string>> = {},
): { score: number; hit: string | null } {
  let best = scoreWord(queryWord, words);
  const alias = aliases[queryWord];
  if (alias) {
    const viaAlias = scoreWord(alias, words);
    if (viaAlias.score > best.score) best = viaAlias;
  }
  return best;
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
  return fuzzyMatchWords(items, query, (item) => normalizeWords(toText(item)), aliases);
}

/**
 * `fuzzyMatch` for items whose words the caller normalised once, ahead of
 * time, so a keystroke does not re-normalise every item's text.
 */
export function fuzzyMatchWords<T>(
  items: readonly T[],
  query: string,
  toWords: (item: T) => readonly string[],
  aliases: Readonly<Record<string, string>> = {},
  /**
   * Asked only when a query word matches none of the item's words: another
   * way that word may match the item, scored on the same scale (0 is no
   * match). Backwork uses it for words of a course's name, which match under
   * stricter rules than the rest of a row.
   */
  fallback?: (item: T, queryWord: string) => { score: number; hit: string | null },
): FuzzyResult<T>[] {
  const queryWords = normalizeWords(query);
  if (queryWords.length === 0) {
    return items.map((item) => ({ item, score: 0, hits: [] }));
  }
  const results: FuzzyResult<T>[] = [];
  for (const item of items) {
    const words = toWords(item);
    let total = 0;
    const hits: string[] = [];
    let matched = true;
    for (const queryWord of queryWords) {
      let best = matchQueryWord(queryWord, words, aliases);
      if ((best.score === 0 || !best.hit) && fallback) {
        best = fallback(item, queryWord);
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
