import type {
  ChatMessageReminder,
  StoredBookmarkedMessage,
} from '../entities/chat.entity';

export type { ChatMessageReminder };

export const CHAT_MESSAGE_REMINDER_REPOSITORY =
  'CHAT_MESSAGE_REMINDER_REPOSITORY';

/**
 * A reminder joined to its message. The message carries the same narrow
 * columns a bookmark's does, because a reminder row draws the same preview.
 */
export interface StoredChatMessageReminder extends ChatMessageReminder {
  message: StoredReminderMessage;
}

/**
 * A bookmark's columns plus `metadata`, which a message with no text needs
 * to say what was sent ("Sent an attachment", "Sent a GIF") the way its chat
 * push does.
 */
export type StoredReminderMessage = StoredBookmarkedMessage & {
  metadata?: Record<string, unknown> | null;
};

/**
 * Private reminders on chat messages (#4957, `spec/behavior/chat/README.md`
 * § Reminders (personal)).
 *
 * Every member-facing method filters on the caller's `user_id` and chapter,
 * and none answers a question about anyone else's reminders. Only the sweep's
 * two methods walk every chapter, by design: they read and claim due rows
 * across the deployment.
 */
export interface IChatMessageReminderRepository {
  /**
   * Sets the caller's reminder on a message, or moves the one there is: the
   * new time replaces the old and `fired_at` clears, so a reminder already
   * sent fires again at the new time (a snooze).
   */
  upsert(
    userId: string,
    messageId: string,
    chapterId: string,
    remindAt: string,
  ): Promise<ChatMessageReminder>;
  /** Removes the caller's reminder on a message. Idempotent. */
  delete(userId: string, messageId: string, chapterId: string): Promise<void>;
  /**
   * The caller's reminders in one chapter: those due at `now`, newest first,
   * then those still waiting, soonest first, at most `limit` of each. Read
   * apart so a pile of old due reminders the member never cleared can't
   * crowd a new one off the list.
   */
  findByUserAndChapter(
    userId: string,
    chapterId: string,
    now: string,
    limit: number,
  ): Promise<StoredChatMessageReminder[]>;
  /** Unfired reminders due at `now`, oldest first, across every chapter. */
  findDue(now: string, limit: number): Promise<StoredChatMessageReminder[]>;
  /**
   * Claims a due reminder for this replica: sets `fired_at` only if it is
   * still unfired and still due at the time that was read, so two replicas
   * never both push, and a reminder moved between the read and the claim is
   * left for its new time. True when this call won.
   */
  claimDue(
    reminder: Pick<ChatMessageReminder, 'id' | 'remind_at'>,
    firedAt: string,
  ): Promise<boolean>;
}
