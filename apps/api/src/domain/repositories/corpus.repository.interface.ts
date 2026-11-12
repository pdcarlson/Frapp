import type {
  CorpusCandidate,
  CorpusChunkWrite,
  CorpusSkipReason,
  CorpusSource,
} from '../entities/corpus.entity';
import type { ChatWindowMessage } from '../utils/corpus-chat';

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
  /** Chat only (#4314): messages left out because their author had not said yes. */
  leftOutCount?: number;
  /** And whose; kept in the database only. */
  leftOutAuthorIds?: string[];
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
/** A chat window as `read_chat_corpus_window` returns it (#4314). */
export interface ChatWindowRead {
  channelId: string;
  channelName: string;
  /** `YYYY-MM-DD`. */
  day: string;
  /** Readable messages only, oldest conversation first. */
  messages: ChatWindowMessage[];
}

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

  /**
   * A chat window's readable messages, or null when the window is gone, is
   * in another chapter, or its channel is a DM or group DM: the query
   * refuses those itself (#4314).
   */
  readChatWindow(
    chapterId: string,
    windowId: string,
  ): Promise<ChatWindowRead | null>;

  /** Of `windowIds`, each one's channel; DM windows and other chapters' are left out. */
  chatWindowChannels(
    chapterId: string,
    windowIds: readonly string[],
  ): Promise<Map<string, string>>;

  /**
   * Reads again every chat window that holds a passage by, or left out, one
   * of `userIds`: their passages go now. In `chapterId`, or in every chapter
   * when it is null. Returns how many windows.
   */
  requeueChatByAuthors(
    userIds: readonly string[],
    chapterId: string | null,
  ): Promise<number>;

  /** The chapters that hold chat windows. */
  chatCorpusChapters(): Promise<string[]>;

  /** Who the chapter's chat index holds a passage by, and who it left out. */
  chatCorpusAuthors(
    chapterId: string,
  ): Promise<{ indexed: string[]; leftOut: string[] }>;
}
