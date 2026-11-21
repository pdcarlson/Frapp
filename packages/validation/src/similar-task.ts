/**
 * Whether a suggested task is one the chapter already has (#5562; Paul,
 * 2026-11-19: "if a task is similar to an already existing one, we should be
 * able to recognize that and either not suggest it, give a merge option, or
 * at the very least a side by side comparison").
 *
 * Words, not a model: two titles match when most of the words that carry
 * meaning are the same ("Book the hall for formal" and "Formal: book hall").
 * Both apps call it on the tasks the officer can already see
 * (`@repo/hooks`' `useSimilarTasks`), so the card shows the two side by side
 * and offers Already a task, which records the existing task as the
 * suggestion's, or Create anyway.
 */

/** Words that say nothing about which task it is. */
const FILLER = new Set([
  "a",
  "about",
  "all",
  "an",
  "and",
  "any",
  "are",
  "as",
  "at",
  "be",
  "by",
  "can",
  "each",
  "for",
  "from",
  "get",
  "has",
  "have",
  "her",
  "his",
  "in",
  "into",
  "is",
  "it",
  "its",
  "must",
  "my",
  "need",
  "of",
  "on",
  "or",
  "our",
  "out",
  "over",
  "should",
  "so",
  "than",
  "that",
  "the",
  "their",
  "them",
  "then",
  "these",
  "they",
  "this",
  "those",
  "to",
  "up",
  "us",
  "we",
  "will",
  "with",
  "your",
]);

/** The words of a title that say which task it is, lower case, plural as singular. */
export function taskTitleWords(title: string): Set<string> {
  const words = title
    .toLowerCase()
    .replace(/[’']s\b/g, "")
    .split(/[^\p{L}\p{N}]+/u)
    // A lone digit stays: "round 1" and "round 2" are two tasks.
    .filter((word) => (word.length > 1 || /\d/.test(word)) && !FILLER.has(word))
    .map((word) =>
      word.length > 3 && word.endsWith("s") && !word.endsWith("ss")
        ? word.slice(0, -1)
        : word,
    );
  return new Set(words);
}

/**
 * How alike two titles are, from 0 to 1: the share of the shorter title's
 * words the other also has, held down when the longer one says much more.
 */
export function taskTitleLikeness(a: string, b: string): number {
  const x = taskTitleWords(a);
  const y = taskTitleWords(b);
  if (x.size === 0 || y.size === 0) return 0;
  let shared = 0;
  for (const word of x) if (y.has(word)) shared += 1;
  // One shared word is a match only when that word is the whole title.
  if (shared < 2 && !(shared === 1 && x.size === 1 && y.size === 1)) return 0;
  const small = Math.min(x.size, y.size);
  const large = Math.max(x.size, y.size);
  return (shared / small) * Math.min(1, (2 * shared) / large);
}

/** Likeness at or above which a suggestion reads as an existing task. */
// Above three of four words: "Book hall for spring formal" and "Book hall for
// fall formal" share three of four and are two tasks.
export const SIMILAR_TASK_THRESHOLD = 0.8;

export interface SimilarTaskCandidate {
  id: string;
  title: string;
  /** A finished task is history, not the same work again. */
  status?: string | null;
}

/**
 * The existing task most like `title`, or null when none is close enough.
 * Finished ones are left out: doing a thing again is a new task.
 */
export function similarTask<T extends SimilarTaskCandidate>(
  title: string,
  candidates: readonly T[],
): T | null {
  let best: T | null = null;
  let bestScore = 0;
  for (const candidate of candidates) {
    if (candidate.status === "COMPLETED") continue;
    const score = taskTitleLikeness(title, candidate.title);
    if (score >= SIMILAR_TASK_THRESHOLD && score > bestScore) {
      best = candidate;
      bestScore = score;
    }
  }
  return best;
}

/** The words on a suggestion that looks like a task the chapter has. */
export const SIMILAR_TASK_COPY = {
  heading: "Looks like a task you already have",
  suggested: "Suggested",
  existing: "Existing task",
  /** Dismisses the suggestion: the existing task is the one. */
  same: "Already a task",
  /** Keeps the suggestion, to create as usual. */
  different: "Create anyway",
  openExisting: "Open the existing task",
  /** Said once Already a task is recorded. */
  linked: "Noted as a task you already have",
  linkFailed: "Couldn't note it as a task you already have",
  /** Create all, when a look-alike is waiting on the officer's word. */
  acceptReady: (count: number) => `Create the ${count} that are ready`,
} as const;
