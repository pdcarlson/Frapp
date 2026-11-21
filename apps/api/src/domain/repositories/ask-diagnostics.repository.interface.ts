import type { AskDiagnosticsWindow } from '../entities/ask-diagnostics.entity';

export const ASK_DIAGNOSTICS_REPOSITORY = 'ASK_DIAGNOSTICS_REPOSITORY';

/**
 * Storage for the Ask diagnostics window and what it keeps (#4315). There is
 * no read of an exchange here on purpose: no API serves stored AI text, and
 * the Frapp team reads it from the database with the key
 * (`docs/ops/ai-stored-text.md`).
 */
export interface IAskDiagnosticsRepository {
  /** The chapter's window, whether or not it has run out, or null. */
  findWindow(chapterId: string): Promise<AskDiagnosticsWindow | null>;

  /**
   * Opens a window. Returns null when one is already open, for this chapter
   * or any other: only one chapter has a window at a time.
   */
  openWindow(input: {
    chapterId: string;
    startedBy: string;
    startedAt: Date;
    endsAt: Date;
  }): Promise<AskDiagnosticsWindow | null>;

  /**
   * Deletes the chapter's window and, with it, everything it kept. Returns
   * whether there was one.
   */
  deleteWindow(chapterId: string): Promise<boolean>;

  /**
   * Keeps one sealed exchange under a window. Returns false when the window
   * is gone (turned off or swept since it was read), and nothing is kept.
   */
  insertExchange(input: {
    chapterId: string;
    windowId: string;
    memberId: string;
    userId: string;
    sealed: string;
    createdAt: Date;
  }): Promise<boolean>;

  /** Deletes everything a person asked, in every chapter. Returns how many. */
  deleteExchangesByUser(userId: string): Promise<number>;

  /**
   * Deletes every window past its end, in any chapter, and with each
   * everything it kept. Returns how many windows went.
   */
  deleteExpiredWindows(now: Date): Promise<number>;
}
