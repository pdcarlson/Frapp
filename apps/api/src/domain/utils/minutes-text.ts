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
