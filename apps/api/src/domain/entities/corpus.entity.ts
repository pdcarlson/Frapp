/**
 * The AI corpus (#720, `spec/architecture/README.md` § 13): what Ask and the
 * later AI features retrieve from.
 *
 * The list of source types is closed, and the database holds the same list
 * (`corpus_sources_type_allowed` in `20261112140000_ai_corpus.sql`). Channel
 * messages join with #4314. Vault, rush and backwork content have no type, so
 * they cannot be indexed.
 */
export const CORPUS_SOURCE_TYPES = [
  'chapter_document',
  'meeting_minutes',
] as const;
export type CorpusSourceType = (typeof CORPUS_SOURCE_TYPES)[number];

/** Why a source is not in the index. A person can read each one. */
export const CORPUS_SKIP_REASONS = [
  /** A file format the indexer does not read (a slide deck, a spreadsheet). */
  'unsupported_type',
  /** More text than one source may add to the index. */
  'too_large',
  /** No words in it: a scanned PDF, an image, minutes with empty sections. */
  'no_text',
  /** The file would not open, or is not the format it says it is. */
  'unreadable',
] as const;
export type CorpusSkipReason = (typeof CORPUS_SKIP_REASONS)[number];

export type CorpusSourceStatus = 'pending' | 'indexed' | 'skipped';

/**
 * A row of `corpus_sources`: one thing that can be indexed, and how far the
 * index has caught up with it. Database triggers on the source tables create
 * the row, raise `revision` when the source changes and delete the row when
 * the source goes, so the API never has to be told a source changed.
 */
export interface CorpusSource {
  id: string;
  chapter_id: string;
  source_type: string;
  source_id: string;
  /** Goes up by one each time the source changes. */
  revision: number;
  /** The revision the index holds, 0 when it holds none. */
  indexed_revision: number;
  status: CorpusSourceStatus;
  skip_reason: CorpusSkipReason | null;
  /** `users.id` of whoever last changed the source; indexing acts for them. */
  changed_by: string | null;
  attempts: number;
  next_attempt_at: string;
  /** {@link corpusFingerprint} of the run that last indexed it. */
  index_fingerprint: string | null;
  title: string | null;
  source_at: string | null;
  decays: boolean;
  chunk_count: number;
  indexed_at: string | null;
  created_at: string;
  updated_at: string;
}

/** A passage as it is written to `corpus_chunks`. */
export interface CorpusChunkWrite {
  chunk_index: number;
  heading: string | null;
  content: string;
  page_start: number | null;
  page_end: number | null;
  embedding: number[];
}

/**
 * One row of `match_corpus_chunks`: a passage that is among the nearest by
 * embedding, among the best by words, or both, with its rank in each list.
 */
export interface CorpusCandidate {
  chunk_id: string;
  corpus_source_id: string;
  source_type: string;
  source_id: string;
  title: string;
  heading: string | null;
  content: string;
  page_start: number | null;
  page_end: number | null;
  source_at: string | null;
  decays: boolean;
  /** 1 is nearest. Null: not among the nearest. */
  dense_rank: number | null;
  /** 1 is the best word match. Null: no word of the question is in it. */
  sparse_rank: number | null;
  /** Cosine distance to the question, when it is among the nearest. */
  distance: number | null;
}
