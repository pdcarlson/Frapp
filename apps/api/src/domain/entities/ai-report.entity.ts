import type { AiReportReason, AiReportSubject } from '@repo/validation';

/**
 * A report of something the AI made (#4315, `spec/behavior/ai.md` § Stored
 * AI text): one exchange, sealed, kept 30 days for the Frapp team. A row of
 * `ai_reports` (`20261112220000_ai_reports.sql`).
 */
export interface AiReport {
  id: string;
  chapter_id: string;
  reported_by: string;
  subject_type: AiReportSubject;
  /**
   * The ask's id, the draft's request id (the meeting's id is inside the
   * sealed exchange), or the suggestion's id.
   */
  subject_id: string;
  reason: AiReportReason;
  /** The member's own words. Null when they added none. */
  note: string | null;
  /**
   * The `ai-text-cipher` envelope of the exchange, bound to the chapter.
   * Null when the server held no key: then no text was kept.
   */
  sealed: string | null;
  /** Members whose own words are inside `sealed`, never the reporter. */
  quoted_user_ids: string[];
  model: string | null;
  prompt_version: string | null;
  created_at: string;
  expires_at: string;
}
