import type {
  CorpusCandidate,
  CorpusSkipReason,
  CorpusSourceType,
} from '#domain/entities/corpus.entity';
import type { CorpusSection } from '#domain/utils/corpus-chunker';
import type { ChatPassageDraft } from '#domain/utils/corpus-chat';

/** What a source says when the indexer reads it. */
export interface CorpusSourceContent {
  /** What a citation calls the source: a document's title, "Chapter meeting, November 9, 2026". */
  title: string;
  /** When the source is "from": a document's effective date, a meeting's start. */
  sourceAt: string;
  /**
   * Whether a newer source should outrank it on the same question. True for
   * minutes, false for standing documents such as bylaws.
   */
  decays: boolean;
  sections: CorpusSection[];
  /**
   * Passages the source cut itself, used instead of cutting `sections`. Chat
   * does (#4314): a passage there is a run of messages, and has to know
   * whose messages it holds.
   */
  passages?: ChatPassageDraft[];
  /**
   * What the source left out of the index because its authors had not said
   * yes, and whose (chat only). Recorded on the source even when nothing
   * was left to index, so a member who says yes later brings it back.
   */
  leftOut?: { count: number; authorIds: string[] };
}

export type CorpusSourceRead =
  | { status: 'ok'; content: CorpusSourceContent }
  /** It no longer exists, or is no longer something the corpus may hold. */
  | { status: 'gone' }
  | { status: 'skipped'; reason: CorpusSkipReason };

/** What a source's passage-level check let through (`CorpusSourceAdapter.admit`). */
export interface CorpusAdmission {
  /** Candidate passage ids the asker may be given. */
  admitted: Set<string>;
  /**
   * Per source id, how many messages were withheld because an author's
   * answer is no longer yes. Added to the left-out count an answer reports;
   * never anything withheld for another reason (a block), and never whose.
   */
  withheldBySource: Map<string, number>;
}

/**
 * One kind of thing the AI corpus indexes (#720). A source type is added by
 * writing one of these and listing it under {@link CORPUS_SOURCE_ADAPTERS}
 * (and widening the type list and the database check): the indexer and
 * retrieval do the rest. Chapter channel messages are one (#4314).
 *
 * The two methods are the two rules every source must answer for itself:
 * what its text is, and who may read it.
 */
export interface CorpusSourceAdapter {
  readonly type: CorpusSourceType;
  /**
   * The source's current text, read with the server's own access: the index
   * holds the chapter's record, and who may read a passage is decided when
   * it is retrieved.
   */
  read(chapterId: string, sourceId: string): Promise<CorpusSourceRead>;
  /**
   * Of `sourceIds`, the ones `userId` could open right now in `chapterId`.
   * Retrieval drops every passage whose source is not in the answer, so a
   * member never retrieves what they could not open
   * (`spec/architecture/README.md` § 13). Anything unknown is left out.
   */
  readableBy(
    chapterId: string,
    userId: string,
    sourceIds: readonly string[],
  ): Promise<Set<string>>;
  /**
   * A passage-level check after `readableBy`, for a source whose passages
   * carry more than one person's words (chat, #4314): a passage by an author
   * who no longer says yes, or by someone the asker blocked, is withheld.
   * Optional: a source without it lets every readable passage through.
   */
  admit?(
    chapterId: string,
    userId: string,
    candidates: readonly CorpusCandidate[],
  ): Promise<CorpusAdmission>;
}

/** Injection token for the list of adapters, one per source type. */
export const CORPUS_SOURCE_ADAPTERS = 'CORPUS_SOURCE_ADAPTERS';

/** The adapter for a stored `source_type`, or none for a type this build does not know. */
export function corpusAdapterFor(
  adapters: readonly CorpusSourceAdapter[],
  sourceType: string,
): CorpusSourceAdapter | undefined {
  return adapters.find((adapter) => adapter.type === sourceType);
}
