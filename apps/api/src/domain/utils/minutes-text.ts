/**
 * Text helpers the minutes prompts share (`minutes-draft.ts`,
 * `minutes-context.ts`, `minutes-notes.ts`), in a module of their own so the
 * draft and its background never import each other.
 */

/**
 * A fence typed into a source would open or end one early. A whole tag on
 * one line goes; an unclosed "<source" loses only that word, so "<Source:
 * treasurer report" keeps the rest of its line and every line after it.
 */
const FENCE_TAG = /<\/?\s*source\b[^<>\n]*>/gi;
const FENCE_OPEN = /<\/?\s*source\b/gi;

/** A source's text with every fence-shaped piece taken out. */
export function unfenced(text: string): string {
  return text.replace(FENCE_TAG, '').replace(FENCE_OPEN, '');
}

export function oneLine(value: string): string {
  return value.replace(/\s+/g, ' ').trim();
}

/** The most bullets a drafted TL;DR keeps (#5523): it is read at a glance. */
export const TLDR_MAX_BULLETS = 6;

/**
 * A list marker a model may put on a line: "- ", "• ", "* ", "1. ", "2) ".
 * A marker is followed by a space, so "-$25 refund" keeps its minus sign; a
 * line that is only a marker (what an echo check can leave of "2. …") is
 * matched whole and dropped.
 */
const LIST_MARKER = /^(?:[-•*–]|\d{1,2}[.)])(?:\s+|$)/;

/** A heading the model put over its bullets ("TL;DR:", "Key points:"). */
const TLDR_HEADING =
  /^(?:tl;?\s*dr|summary|key points|in short|highlights)\b[^.]{0,20}:$/i;

/**
 * A drafted TL;DR as the minutes keep it (#5523): one "- " bullet per line,
 * with any list marker the model used put right, blank lines, a heading
 * over the bullets and lines left empty dropped, at most
 * {@link TLDR_MAX_BULLETS}. It splits on lines only: a TL;DR written as one
 * paragraph stays one bullet.
 */
export function tldrBullets(text: string): string {
  return text
    .split('\n')
    .map((line) => oneLine(line.trim().replace(LIST_MARKER, '')))
    .filter((line) => line.length > 0 && !TLDR_HEADING.test(line))
    .slice(0, TLDR_MAX_BULLETS)
    .map((line) => `- ${line}`)
    .join('\n');
}

/**
 * Several parts' TL;DRs as one (#5523), for when the editor's pass can't
 * write it for the whole meeting: a bullet from each part in turn, each
 * once, so the first part never fills the whole TL;DR and a deadline set
 * in the last hour still makes it in.
 */
export function interleavedBullets(texts: readonly string[]): string {
  const lists = texts.map((text) =>
    text
      .split('\n')
      .map((line) => line.trim())
      .filter((line) => line.length > 0),
  );
  const seen = new Set<string>();
  const out: string[] = [];
  const longest = Math.max(0, ...lists.map((list) => list.length));
  for (let index = 0; index < longest; index += 1) {
    for (const list of lists) {
      const line = list[index];
      if (line === undefined) continue;
      const key = oneLine(line.replace(LIST_MARKER, '')).toLowerCase();
      if (!key || seen.has(key)) continue;
      seen.add(key);
      out.push(line);
    }
  }
  return out.join('\n');
}
