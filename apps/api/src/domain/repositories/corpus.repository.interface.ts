import type {
  CorpusCandidate,
  CorpusChunkWrite,
  CorpusSkipReason,
  CorpusSource,
} from '../entities/corpus.entity';

export const CORPUS_REPOSITORY = 'CORPUS_REPOSITORY';

export interface FinishCorpusSourceInput {
  sourceId: string;
  /** The revision that was read. A source that moved on is left alone. */
  revision: number;
  fingerprint: string;
  title: string | null;
  sourceAt: string | null;
  decays: boolean;
  chunkCount: number;
  /** Set to end the source as skipped; its passages are removed. */
  skipReason: CorpusSkipReason | null;
}

export interface MatchCorpusInput {
  chapterId: string;
  /** The member the retrieval acts for. Not a member: no rows. */
  userId: string;
  query: string;
  embedding: number[];
  embeddingModel: string;
  /** How many candidates each half returns. */
  limit: number;
}

/**
 * `corpus_sources` and `corpus_chunks` (#720). Every read of passages takes
 * one chapter and the acting member; there is no method that reads passages
 * without both.
 */
export interface ICorpusRepository {
  /**
   * Up to `limit` sources that need indexing, each with its next attempt
   * already pushed out, so a failing source backs off and two replicas do not
   * take the same row.
   */
  claimSources(
    fingerprint: string,
    now: Date,
    limit: number,
  ): Promise<CorpusSource[]>;
  findSource(chapterId: string, id: string): Promise<CorpusSource | null>;
  /**
   * Holds every waiting source of the chapter until `until`, and gives back
   * the try a claim counted for a source that was then never attempted.
   */
  postponeChapter(chapterId: string, until: Date): Promise<void>;
  /** Removes a source whose row outlived what it pointed at. */
  deleteSource(chapterId: string, id: string): Promise<void>;
  /**
   * Writes one batch of a source's passages. False, with nothing written,
   * when the source is no longer at `revision`.
   */
  writeChunks(
    sourceId: string,
    revision: number,
    first: boolean,
    embeddingModel: string,
    chunks: CorpusChunkWrite[],
  ): Promise<boolean>;
  /** Marks the source indexed or skipped. False when it moved on. */
  finishSource(input: FinishCorpusSourceInput): Promise<boolean>;
  match(input: MatchCorpusInput): Promise<CorpusCandidate[]>;
}
