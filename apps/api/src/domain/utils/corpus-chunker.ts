/**
 * Cuts a source's text into the passages the AI corpus indexes (#720).
 *
 * A passage is what gets embedded, matched and later quoted, so it should be
 * one thought: small enough that a question about "Article IV dues" lands on
 * the paragraph that answers it, large enough to carry its own context. The
 * target is about 400 tokens (1,600 characters), the size the retrieval
 * research settled on for bylaws and minutes (#720). Passages never cross a
 * heading, and a paragraph is kept whole unless it alone is over the limit.
 * There is no overlap: sections and paragraphs are the natural seams, and
 * overlapping passages would hand the reader the same lines twice.
 */

/** A run of text from a source, in reading order. */
export interface CorpusSection {
  /** What the text sits under ("Decisions", "Article IV"), when known. */
  heading: string | null;
  /** The page it is on, for a paged file. */
  page: number | null;
  text: string;
}

export interface CorpusChunkDraft {
  heading: string | null;
  content: string;
  pageStart: number | null;
  pageEnd: number | null;
}

/** A passage is closed once it reaches this many characters. */
export const CORPUS_CHUNK_TARGET_CHARS = 1600;
/** No passage is longer than this; a longer paragraph is split. */
export const CORPUS_CHUNK_MAX_CHARS = 2400;

interface Paragraph {
  text: string;
  page: number | null;
}

/**
 * Removes half of a surrogate pair left on its own (a broken PDF font map
 * makes them, and so does cutting a string between the two halves).
 * Postgres refuses one inside JSON, which would fail a write on every try.
 */
export function stripLoneSurrogates(text: string): string {
  return text.replace(
    /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/g,
    '',
  );
}

/**
 * Tidies text for storage and matching: no NUL (Postgres refuses it), no
 * other control characters, one space between words, at most one blank line
 * between paragraphs.
 */
export function normalizeCorpusText(text: string): string {
  return (
    stripLoneSurrogates(text)
      // eslint-disable-next-line no-control-regex
      .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '')
      .replace(/\r\n?/g, '\n')
      .replace(/[^\S\n]+/g, ' ')
      .replace(/ ?\n ?/g, '\n')
      .replace(/\n{3,}/g, '\n\n')
      .trim()
  );
}

/** Splits text over the limit at sentence ends, then at spaces, then anywhere. */
function splitLong(text: string): string[] {
  const parts: string[] = [];
  let rest = text;
  while (rest.length > CORPUS_CHUNK_MAX_CHARS) {
    const window = rest.slice(0, CORPUS_CHUNK_MAX_CHARS);
    const sentence = Math.max(
      window.lastIndexOf('. '),
      window.lastIndexOf('? '),
      window.lastIndexOf('! '),
      window.lastIndexOf('\n'),
    );
    const floor = CORPUS_CHUNK_TARGET_CHARS / 2;
    let cut: number;
    if (sentence >= floor) cut = sentence + 1;
    else if (window.lastIndexOf(' ') >= floor) cut = window.lastIndexOf(' ');
    else {
      cut = CORPUS_CHUNK_MAX_CHARS;
      // Never between the two halves of one character (an emoji, say).
      const before = rest.charCodeAt(cut - 1);
      if (before >= 0xd800 && before <= 0xdbff) cut -= 1;
    }
    parts.push(rest.slice(0, cut).trim());
    rest = rest.slice(cut).trim();
  }
  if (rest) parts.push(rest);
  return parts;
}

function paragraphsOf(section: CorpusSection): Paragraph[] {
  return normalizeCorpusText(section.text)
    .split(/\n{2,}/)
    .flatMap((paragraph) => splitLong(paragraph.trim()))
    .filter((text) => text.length > 0)
    .map((text) => ({ text, page: section.page }));
}

export function chunkSections(
  sections: readonly CorpusSection[],
): CorpusChunkDraft[] {
  const chunks: CorpusChunkDraft[] = [];
  let heading: string | null = null;
  let open: Paragraph[] = [];
  let length = 0;

  const close = () => {
    if (open.length === 0) return;
    const pages = open.flatMap((p) => (p.page === null ? [] : [p.page]));
    chunks.push({
      heading,
      content: open.map((p) => p.text).join('\n\n'),
      pageStart: pages.length ? Math.min(...pages) : null,
      pageEnd: pages.length ? Math.max(...pages) : null,
    });
    open = [];
    length = 0;
  };

  for (const section of sections) {
    const sectionHeading = section.heading?.trim() || null;
    if (sectionHeading !== heading) {
      close();
      heading = sectionHeading;
    }
    for (const paragraph of paragraphsOf(section)) {
      const joined = length + paragraph.text.length + (open.length ? 2 : 0);
      if (open.length > 0 && joined > CORPUS_CHUNK_MAX_CHARS) close();
      open.push(paragraph);
      length += paragraph.text.length + (open.length > 1 ? 2 : 0);
      if (length >= CORPUS_CHUNK_TARGET_CHARS) close();
    }
  }
  close();
  return chunks;
}

/**
 * What is embedded for a passage: its source's title and heading, then its
 * text. A paragraph that says "the fee is $225" embeds near "dues" only when
 * the vector also saw that it sits under "Bylaws › Article IV: Dues".
 */
export function corpusEmbeddingText(
  title: string,
  chunk: Pick<CorpusChunkDraft, 'heading' | 'content'>,
): string {
  const path = [title.trim(), chunk.heading?.trim()]
    .filter(Boolean)
    .join(' › ');
  return path ? `${path}\n${chunk.content}` : chunk.content;
}
