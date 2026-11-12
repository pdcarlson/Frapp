/**
 * Where each citation's marker goes in an answer (#451: a citation sits next
 * to the sentence it backs, not in a list at the end).
 *
 * A model says what it quoted and from where; whether it also says where in
 * its own prose depends on the provider. So placement is Frapp's:
 *
 * - A citation that arrives with a position (`at`, the end of the span the
 *   provider attached it to) goes to the end of the sentence holding that
 *   position.
 * - One without goes to the end of the sentence that shares the most words
 *   with its quote, the earliest on a tie, and to the end of the answer when
 *   no sentence shares any.
 *
 * A marker is only ever at a sentence end, so it never splits a word or a
 * number. Offsets are JavaScript string offsets (UTF-16 code units), which is
 * what both clients slice with.
 */

export interface PlaceableCitation {
  sourceId: string;
  quote: string;
  at?: number;
}

export type PlacedCitation<C extends PlaceableCitation> = Omit<C, 'at'> & {
  at: number;
};

interface Sentence {
  start: number;
  /** Just past the sentence's closing punctuation. */
  end: number;
}

/** A terminator, any closing quotes or brackets, then space or the end. */
const SENTENCE_END = /[.!?]+["')\]]*(?=\s|$)|\n+/g;

function sentences(text: string): Sentence[] {
  const found: Sentence[] = [];
  let start = 0;
  for (const match of text.matchAll(SENTENCE_END)) {
    const isBreak = match[0].startsWith('\n');
    const end = isBreak ? match.index : match.index + match[0].length;
    if (text.slice(start, end).trim()) found.push({ start, end });
    start = match.index + match[0].length;
  }
  const tail = text.slice(start);
  if (tail.trim()) {
    found.push({ start, end: start + tail.trimEnd().length });
  }
  return found;
}

function words(text: string): Set<string> {
  const found: string[] = text.toLowerCase().match(/[\p{L}\p{N}$%]+/gu) ?? [];
  return new Set(found.filter((word) => word.length >= 3 || /\d/.test(word)));
}

export function placeCitations<C extends PlaceableCitation>(
  text: string,
  citations: readonly C[],
): PlacedCitation<C>[] {
  const all = sentences(text);
  const endOfText = text.trimEnd().length;
  const wordsBySentence = all.map((sentence) =>
    words(text.slice(sentence.start, sentence.end)),
  );

  const placed = citations.map((citation, order) => {
    let at = endOfText;
    if (
      citation.at !== undefined &&
      Number.isInteger(citation.at) &&
      citation.at >= 0 &&
      citation.at <= text.length
    ) {
      const position = citation.at;
      // The sentence that holds the position: the first one ending at or
      // after it.
      at = all.find((sentence) => sentence.end >= position)?.end ?? endOfText;
    } else {
      const quoted = words(citation.quote);
      let best = 0;
      all.forEach((sentence, index) => {
        let shared = 0;
        for (const word of wordsBySentence[index]) {
          if (quoted.has(word)) shared += 1;
        }
        if (shared > best) {
          best = shared;
          at = sentence.end;
        }
      });
    }
    return { citation: { ...citation, at }, order };
  });

  return placed
    .sort((a, b) => a.citation.at - b.citation.at || a.order - b.order)
    .map((entry) => entry.citation);
}
