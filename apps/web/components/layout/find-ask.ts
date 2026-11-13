/**
 * Whether what is in the Find field reads as a question for Frapp rather
 * than something to search for (#4904). It decides where Enter lands when
 * the field does both (`find-dialog.tsx`): a question starts on the Ask
 * row, anything else on the first result.
 *
 * Read from the words alone, so the answer is the same on every keystroke
 * and never changes because results arrived. It only picks the row that is
 * highlighted first; the other is one arrow key away, and nothing is sent
 * until the member presses Enter or clicks.
 *
 * A question is text that ends in a question mark, opens with a question
 * word, or runs to four words or more. Search terms here are a name, a
 * channel or a couple of words from a message; nobody finds `#general` in
 * four.
 */
const OPENERS = new Set([
  "who",
  "whos",
  "who's",
  "what",
  "whats",
  "what's",
  "when",
  "whens",
  "when's",
  "where",
  "wheres",
  "where's",
  "why",
  "how",
  "hows",
  "how's",
  "which",
  "whose",
  "is",
  "are",
  "was",
  "were",
  "do",
  "does",
  "did",
  "can",
  "could",
  "should",
  "will",
  "would",
  "am",
]);

/** A question reads as one from this many words on. */
const QUESTION_WORDS = 4;

export function asksFirst(query: string): boolean {
  const words = query
    .trim()
    .toLowerCase()
    // A phone or a Mac types a curly apostrophe; some keyboards a wide "?".
    .replace(/\u2019/g, "'")
    .split(/\s+/)
    .filter(Boolean);
  if (words.length === 0) return false;
  if (/[?\uFF1F]$/.test(words.at(-1)!)) return true;
  if (words.length >= QUESTION_WORDS) return true;
  // One word is a search, whatever the word: "which" finds messages too.
  return words.length > 1 && OPENERS.has(words[0]!);
}
