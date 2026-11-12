/**
 * One Important message a member has seen (#4186): a row of
 * `chat_message_important_seen`. The "1 important message" strip counts a
 * channel's recent Important messages that have no such row for the viewer.
 * spec/behavior/chat/README.md § Message flags.
 */
export interface ChatMessageImportantSeen {
  user_id: string;
  message_id: string;
  chapter_id: string;
  seen_at: string;
}

/**
 * What the strip needs to know about one unseen Important message: enough to
 * jump to it and to name it in one line. Not the message itself: the timeline
 * already serves that, masked, and the strip never draws a row.
 */
export interface ImportantMessageRef {
  id: string;
  created_at: string;
  flagged_at: string;
  /** `users.id` of the sender, or `null` for an imported Discord row. */
  sender_id: string | null;
  /** An imported row's Discord name; `null` for a member's message. */
  author_name: string | null;
  /** The message's first words, for web's "Sender: first words…". */
  excerpt: string;
}

/** The strip's state for one channel and one member. */
export interface ImportantMessages {
  /**
   * The unseen ones, oldest first, which is the order the strip jumps in.
   * At most `IMPORTANT_LIST_LIMIT`; `total` counts all of them.
   */
  messages: ImportantMessageRef[];
  total: number;
}
