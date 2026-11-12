import type { AiReportReason, AiReportSubject } from '@repo/validation';

export const AI_REPORT_REPOSITORY = 'AI_REPORT_REPOSITORY';

export type AiReportInsertResult = 'kept' | 'duplicate' | 'refused';

export interface InsertAiReportInput {
  chapterId: string;
  reportedBy: string;
  subjectType: AiReportSubject;
  subjectId: string;
  reason: AiReportReason;
  note: string | null;
  sealed: string | null;
  quotedUserIds: readonly string[];
  model: string | null;
  promptVersion: string | null;
  createdAt: Date;
  expiresAt: Date;
}

/**
 * Storage for reports (#4315). There is no read of a report here on purpose:
 * no API serves stored AI text, and the Frapp team reads rows from the
 * database with the key (`docs/ops/ai-stored-text.md`).
 */
export interface IAiReportRepository {
  /**
   * Keeps one report. `duplicate` when this member already reported this
   * thing; `refused` when the reporter or a member it quotes has deleted
   * their account (the table's insert trigger keeps nothing). Either way
   * nothing new is kept.
   */
  insert(input: InsertAiReportInput): Promise<AiReportInsertResult>;

  /**
   * Deletes every report quoting this person, in every chapter: their answer
   * on the AI sheet covers them everywhere. Returns how many.
   */
  deleteQuoting(userId: string): Promise<number>;

  /** Deletes every report past its date, everywhere. Returns how many. */
  deleteExpired(now: Date): Promise<number>;
}
