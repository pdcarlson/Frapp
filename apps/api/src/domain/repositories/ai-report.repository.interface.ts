import type { AiReportReason, AiReportSubject } from '@repo/validation';

export const AI_REPORT_REPOSITORY = 'AI_REPORT_REPOSITORY';

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
   * Keeps one report. Returns false when this member already reported this
   * thing, and nothing new is kept.
   */
  insert(input: InsertAiReportInput): Promise<boolean>;

  /**
   * Deletes every report quoting this person, in every chapter: their answer
   * on the AI sheet covers them everywhere. Returns how many.
   */
  deleteQuoting(userId: string): Promise<number>;

  /** Deletes every report past its date, everywhere. Returns how many. */
  deleteExpired(now: Date): Promise<number>;
}
