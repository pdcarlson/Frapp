import type {
  AskFeedbackRow,
  AskTraceRow,
  AskTraceStepRow,
} from '../entities/ask-trace.entity';

export const ASK_TRACE_REPOSITORY = 'ASK_TRACE_REPOSITORY';

/** What a thumbs or a signal needs to know about the turn it is on. */
export type AskTraceSummary = Pick<
  AskTraceRow,
  'id' | 'door' | 'prompt_version' | 'model' | 'effort' | 'outcome'
>;

/**
 * Storage for Ask traces and the thumbs on them (#4902). Nothing here reads
 * a trace back for a member: the one read a route makes is "is this ask
 * yours", and the Frapp team reads the rest from the database
 * (`docs/ops/ask-answer-quality.md`).
 */
export interface IAskTraceRepository {
  /**
   * Keeps one turn and its steps. Returns false, keeping nothing, when the
   * asker's membership is gone or this ask already has a trace.
   */
  insertTrace(
    trace: AskTraceRow,
    steps: readonly AskTraceStepRow[],
  ): Promise<boolean>;

  /**
   * When this member last started a turn in this chapter before `before`,
   * or null. For "asked again within a minute".
   */
  lastStartedAt(
    chapterId: string,
    userId: string,
    before: Date,
  ): Promise<string | null>;

  /** The trace of this ask if this member asked it in this chapter. */
  findForAsker(
    askId: string,
    chapterId: string,
    userId: string,
  ): Promise<AskTraceSummary | null>;

  /**
   * Sets the asker's thumbs on an answer, replacing an earlier one. Returns
   * null when the trace went away since it was read.
   */
  upsertFeedback(input: {
    askId: string;
    chapterId: string;
    userId: string;
    rating: string;
    reason: string | null;
    now: Date;
  }): Promise<AskFeedbackRow | null>;

  /** Takes the asker's thumbs back. Returns whether there was one. */
  deleteFeedback(
    askId: string,
    chapterId: string,
    userId: string,
  ): Promise<boolean>;

  /**
   * Deletes every trace a person has, in every chapter, and with each its
   * steps and thumbs. Returns how many traces went.
   */
  deleteByUser(userId: string): Promise<number>;

  /** Deletes every trace past its date, in any chapter. Returns how many. */
  deleteExpired(now: Date): Promise<number>;
}
