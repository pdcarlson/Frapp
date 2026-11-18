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

/** A list marker a model may put on a line: "- ", "• ", "* ", "1. ", "2) ". */
const LIST_MARKER = /^(?:[-•*–]\s*|\d{1,2}[.)]\s+)/;

/**
 * A drafted TL;DR as the minutes keep it (#5523): one "- " bullet per line,
 * blank lines and any heading-like line ending in a colon dropped, at most
 * {@link TLDR_MAX_BULLETS}. A model that numbers its points or writes a
 * paragraph still lands as bullets the minutes screens draw the same way.
 */
export function tldrBullets(text: string): string {
  return text
    .split('\n')
    .map((line) => oneLine(line.trim().replace(LIST_MARKER, '')))
    .filter((line) => line.length > 0 && !/:$/.test(line))
    .slice(0, TLDR_MAX_BULLETS)
    .map((line) => `- ${line}`)
    .join('\n');
}
