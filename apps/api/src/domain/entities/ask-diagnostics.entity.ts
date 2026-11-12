/**
 * The beta diagnostics window on Ask (`spec/behavior/ai.md` § Stored AI
 * text, ADR-28 decision 8, #4315): for one chapter, with its president's
 * recorded yes, the questions asked in Ask and their answers are kept,
 * encrypted, until a fixed end date at most 14 days out.
 */

/** The longest a window may run. The database refuses a longer one. */
export const ASK_DIAGNOSTICS_MAX_DAYS = 14;

/**
 * A row of `ai_diagnostics_windows`. A row exists only while its window is
 * open: turning the window off, or the sweep at `ends_at`, deletes the row,
 * and everything it kept goes with it in the same statement. The lasting
 * record of the president's yes is the audit log.
 */
export interface AskDiagnosticsWindow {
  id: string;
  chapter_id: string;
  /** The president who said yes. Null once that account is gone. */
  started_by: string | null;
  started_at: string;
  /** Fixed when the window starts. Never moved. */
  ends_at: string;
}

/** A row of `ai_diagnostics_exchanges`: one question and its answer, sealed. */
export interface AskDiagnosticsExchange {
  id: string;
  window_id: string;
  chapter_id: string;
  /** The asker's membership row. Deleting it deletes the exchange. */
  member_id: string;
  user_id: string;
  /** The `ai-text-cipher` envelope. Nothing readable is stored beside it. */
  sealed: string;
  created_at: string;
}
