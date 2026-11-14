/**
 * The cards an Ask answer comes with (#4904, `spec/behavior/ai.md` § Asking
 * Frapp to do something). The words both clients show that the single card's
 * copy (`ACT_COPY`) does not have.
 */
export const ASK_CARDS_COPY = {
  /**
   * The asker's waiting cards could not be read. Not "gone": the card may
   * still be waiting, and it is drawn once the list is read.
   */
  unread: "Couldn't load this. It may still be waiting.",
} as const;
