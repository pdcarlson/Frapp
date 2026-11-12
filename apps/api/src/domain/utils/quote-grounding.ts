/**
 * The word-for-word check behind every citation and every proposal's quote
 * (ADR-28 decision 4, `spec/behavior/ai.md` § Citation requirement).
 *
 * One rule, in one place: the AI gateway applies it to what a model cites,
 * the suggestions work applies it to the quote a proposal carries, and the
 * eval grader (`test/ai-evals/harness/grader.ts`) applies it to an answer.
 * The comparison is exact, with no trimming, case folding or whitespace
 * repair: a quote that needs repairing to match is not a quote of the source.
 */
export function isQuoteGrounded(quote: string, sourceText: string): boolean {
  return quote.length > 0 && sourceText.includes(quote);
}

export interface QuotedCitation {
  sourceId: string;
  quote: string;
}

export interface CitableSource {
  id: string;
  text: string;
}

export interface CitationVerification<C extends QuotedCitation> {
  /** Citations whose quote is in the source they name, in the order given. */
  kept: C[];
  /**
   * How many were dropped: the source id is not one of `sources`, or the
   * quote is not in it. A count, so it can go on an event; never the quotes.
   */
  dropped: number;
}

/**
 * Keep a citation only when its quote appears word for word in the source it
 * names. `sources` is exactly what the model was given: a citation of anything
 * else (another chapter's document, an id the model made up) is dropped.
 */
export function verifyCitations<C extends QuotedCitation>(
  citations: readonly C[],
  sources: readonly CitableSource[],
): CitationVerification<C> {
  const textById = new Map(sources.map((source) => [source.id, source.text]));
  const kept = citations.filter((citation) => {
    const text = textById.get(citation.sourceId);
    return text !== undefined && isQuoteGrounded(citation.quote, text);
  });
  return { kept, dropped: citations.length - kept.length };
}
