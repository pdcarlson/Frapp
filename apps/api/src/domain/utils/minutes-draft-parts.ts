import { MEETING_NOTES_COPY, type MeetingDraftOutput } from '@repo/validation';
import type { MinutesDraftRequest } from './minutes-draft';
import { interleavedBullets } from './minutes-text';

/**
 * Drafting a long meeting in parts (Paul, 2026-11-16: a 4-hour recording
 * came back as a five-sentence summary and a handful of the decisions).
 *
 * One pass over hours of transcript picks out the headline items and drops
 * the rest. Above `DRAFT_PART_CHARS`, the notes are cut into parts of about
 * twenty-five minutes of talk, and each part is drafted on its own (in
 * parallel). The review pass (`minutes-draft-review.ts`), which every draft
 * gets, then reads every part's candidates together and writes the minutes for the whole meeting;
 * `mergeParts` is what stands if that pass can't run.
 *
 * Every part is a stretch of the same notes, so a part's quotes
 * are checked against the whole notes exactly as a one-pass draft's are.
 *
 * Only a draft from one source is split. Several note-takers and a
 * recording don't line up by position, and a part of one beside the wrong
 * part of another would read as a disagreement that isn't one.
 */

/**
 * About twenty-five minutes of spoken transcript. Smaller parts are read
 * more closely: one pass over an hour of talk keeps the headline items and
 * drops the rest.
 */
export const DRAFT_PART_CHARS = 24_000;

/** Where in the meeting a part sits, told to the model. */
export interface MinutesDraftPart {
  index: number;
  count: number;
}

/**
 * The officer's answers to the draft's gaps, which the editor appends under
 * `MEETING_NOTES_COPY.answersHeading`. Every part is handed them, because an
 * answer can settle a gap anywhere in the meeting.
 */
export function splitAnswers(notes: string): {
  body: string;
  answers: string | null;
} {
  const at = notes.lastIndexOf(MEETING_NOTES_COPY.answersHeading);
  if (at < 0) return { body: notes, answers: null };
  return {
    body: notes.slice(0, at).replace(/\s+$/, ''),
    answers: notes.slice(at).trim(),
  };
}

/**
 * The notes cut into parts no longer than `max`, in order, each a run of the
 * notes' own text. A cut falls at a line break where one is near the limit,
 * else at the end of a sentence, else between words. A transcript is often
 * one line the whole meeting long (Paul's 4-hour recording was a single
 * 130,000-character line, so cutting only at line breaks never cut it).
 * Every part is a stretch of the source, so a quote from a part is a quote
 * of the source.
 */
export function splitIntoParts(text: string, max = DRAFT_PART_CHARS): string[] {
  const parts: string[] = [];
  let start = 0;
  while (start < text.length) {
    let end = Math.min(text.length, start + max);
    if (end < text.length) end = cutBefore(text, start, end);
    const part = text.slice(start, end).trim();
    if (part.length > 0) parts.push(part);
    start = end;
  }
  return parts;
}

/** Where to cut a part that would run past `limit`: the last good break in its second half. */
function cutBefore(text: string, start: number, limit: number): number {
  const floor = start + Math.floor((limit - start) / 2);
  const window = text.slice(floor, limit);
  const newline = window.lastIndexOf('\n');
  if (newline >= 0) return floor + newline + 1;
  let sentence = -1;
  for (const match of window.matchAll(/[.?!]["'\u201d\u2019)]?\s/g)) {
    sentence = (match.index ?? 0) + match[0].length;
  }
  if (sentence >= 0) return floor + sentence;
  const space = window.lastIndexOf(' ');
  return space >= 0 ? floor + space + 1 : limit;
}

/**
 * The requests to draft a long meeting part by part, or null when one pass
 * reads it all (short notes, or several sources).
 */
export function partRequests(
  request: MinutesDraftRequest,
  max = DRAFT_PART_CHARS,
): (MinutesDraftRequest & { part: MinutesDraftPart })[] | null {
  if (request.sources && request.sources.length > 1) return null;
  const only = request.sources?.[0];
  const notes = only ? only.text : (request.notes ?? '');
  if (notes.length <= max) return null;
  const { body, answers } = splitAnswers(notes);
  const pieces = splitIntoParts(body, max);
  if (pieces.length < 2) return null;
  return pieces.map((piece, index) => {
    const text = answers ? `${piece}\n\n${answers}` : piece;
    const part = { index: index + 1, count: pieces.length };
    return only
      ? { ...request, sources: [{ ...only, text }], notes: undefined, part }
      : { ...request, notes: text, part };
  });
}

/** Identical items drafted twice (an answer line two parts both quoted) are one. */
function distinct<T extends { text: string; quote: string }>(
  items: readonly T[],
): T[] {
  const seen = new Set<string>();
  return items.filter((item) => {
    const key = `${item.quote}\u0000${item.text}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function lines(texts: readonly string[]): string {
  return texts
    .map((text) => text.trim())
    .filter((text) => text.length > 0)
    .join('\n');
}

/**
 * The parts' drafts as one draft, in meeting order, for when the review
 * pass can't run: the parts' summaries joined, every item kept once.
 */
export function mergeParts(
  parts: readonly MeetingDraftOutput[],
): MeetingDraftOutput {
  const questions = new Set<string>();
  for (const part of parts) {
    for (const question of part.open_questions) {
      const text = question.trim();
      if (text) questions.add(text);
    }
  }
  return {
    summary: parts
      .map((part) => part.summary.trim())
      .filter((text) => text.length > 0)
      .join(' '),
    announcements: lines(parts.map((part) => part.announcements)),
    decisions: distinct(parts.flatMap((part) => part.decisions)),
    action_items: distinct(parts.flatMap((part) => part.action_items)),
    tabled: distinct(parts.flatMap((part) => part.tabled ?? [])),
    dates: distinct(parts.flatMap((part) => part.dates ?? [])),
    officer_reports: lines(parts.map((part) => part.officer_reports)),
    old_business: lines(parts.map((part) => part.old_business)),
    new_business: lines(parts.map((part) => part.new_business)),
    // Topic blocks keep their blank line between parts.
    discussion_log: parts
      .map((part) => part.discussion_log.trim())
      .filter((text) => text.length > 0)
      .join('\n\n'),
    // A bullet from each part in turn, so the verifier's first few cover the
    // whole meeting. The review pass, when it runs, writes one for all of it.
    tldr: interleavedBullets(parts.map((part) => part.tldr ?? '')),
    open_questions: [...questions],
    conflicts: parts.flatMap((part) => part.conflicts ?? []),
  };
}
