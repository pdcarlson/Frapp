import type {
  ChatScheduledMessage,
  ChatScheduledMessageFailure,
} from '../entities/chat-scheduled-message.entity';

export const CHAT_SCHEDULED_MESSAGE_REPOSITORY =
  'CHAT_SCHEDULED_MESSAGE_REPOSITORY';

export interface NewChatScheduledMessage {
  chapter_id: string;
  channel_id: string;
  user_id: string;
  content: string;
  mention_picks: { user_id: string; label: string }[] | null;
  send_at: string;
}

export interface ChatScheduledMessagePatch {
  content?: string;
  mention_picks?: { user_id: string; label: string }[] | null;
  send_at?: string;
}

/**
 * Messages members scheduled to post later (#4956):
 * `chat_scheduled_messages`.
 *
 * The author-facing methods take the chapter and the author and filter on
 * both, chapter first: a member reads and changes only their own rows. The
 * sweep's methods ({@link findDue}, {@link claim}, {@link removeSent},
 * {@link markFailed}) find due rows across chapters, then write each by its id and chapter.
 */
export interface IChatScheduledMessageRepository {
  /** The author's pending and failed rows, soonest first; one channel when given. */
  listForAuthor(
    chapterId: string,
    userId: string,
    channelId?: string,
  ): Promise<ChatScheduledMessage[]>;
  findForAuthor(
    chapterId: string,
    userId: string,
    id: string,
  ): Promise<ChatScheduledMessage | null>;
  create(row: NewChatScheduledMessage): Promise<ChatScheduledMessage>;
  /**
   * Changes a pending row no send holds right now (`lease_until` unset or
   * past). A failed row is edited back to pending. Null when there is no such
   * row: it was deleted, posted, or is being sent.
   */
  updateForAuthor(
    chapterId: string,
    userId: string,
    id: string,
    patch: ChatScheduledMessagePatch,
    now: string,
  ): Promise<ChatScheduledMessage | null>;
  /** Deletes the author's row. False when there was none. */
  deleteForAuthor(
    chapterId: string,
    userId: string,
    id: string,
  ): Promise<boolean>;
  /** Pending rows due by `now` that no send holds, soonest first. */
  findDue(now: string, limit: number): Promise<ChatScheduledMessage[]>;
  /**
   * Takes the row for one send: a compare-and-set on its `attempts`, so on
   * several replicas only one wins. Sets `lease_until` and spends an attempt.
   */
  claim(
    row: Pick<ChatScheduledMessage, 'id' | 'chapter_id' | 'attempts'>,
    leaseUntil: string,
    now: string,
  ): Promise<boolean>;
  /** The message posted: the row is done. */
  removeSent(
    row: Pick<ChatScheduledMessage, 'id' | 'chapter_id'>,
  ): Promise<void>;
  markFailed(
    row: Pick<ChatScheduledMessage, 'id' | 'chapter_id'>,
    reason: ChatScheduledMessageFailure,
  ): Promise<void>;
}
