import type {
  ChatScheduledAttachment,
  ChatScheduledMessage,
  ChatScheduledMessageFailure,
} from '../entities/chat-scheduled-message.entity';

export const CHAT_SCHEDULED_MESSAGE_REPOSITORY =
  'CHAT_SCHEDULED_MESSAGE_REPOSITORY';

export interface NewChatScheduledMessage {
  chapter_id: string;
  channel_id: string;
  user_id: string;
  member_id: string;
  content: string;
  mention_picks: { user_id: string; label: string }[] | null;
  attachments: ChatScheduledAttachment[];
  reply_to_id: string | null;
  thread_root_id: string | null;
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
  /** The author's pending rows in the chapter. */
  countPending(chapterId: string, userId: string): Promise<number>;
  /**
   * Deletes the author's row unless a send holds it right now, answering the
   * row deleted. `held` when a send does, `missing` when there is no such row.
   */
  deleteForAuthor(
    chapterId: string,
    userId: string,
    id: string,
    now: string,
  ): Promise<
    | { outcome: 'deleted'; row: ChatScheduledMessage }
    | { outcome: 'held' }
    | { outcome: 'missing' }
  >;
  /**
   * Of these `chat` storage paths, the ones a scheduled row in the chapter
   * still names, as an attachment or as a photo's preview: storage that a
   * message not yet posted needs, so no delete may take it (#4971). With
   * `excludingId`, that row doesn't count (the one being deleted).
   */
  findPathsInUse(
    chapterId: string,
    paths: readonly string[],
    excludingId: string | null,
  ): Promise<string[]>;
  /** Pending rows due by `now` that no send holds, soonest first. */
  findDue(now: string, limit: number): Promise<ChatScheduledMessage[]>;
  /**
   * Takes the row for one send: a compare-and-set on its `attempts`, so on
   * several replicas only one wins. Sets `lease_until` and spends an attempt.
   * With `dueBy`, only while `send_at` is still at or before it, so a row
   * moved later by an edit after it was read is left alone. Answers the row as
   * it now stands, which is what is sent, or null when the claim lost.
   */
  claim(
    row: Pick<ChatScheduledMessage, 'id' | 'chapter_id' | 'attempts'>,
    leaseUntil: string,
    now: string,
    dueBy?: string,
  ): Promise<ChatScheduledMessage | null>;
  /** The message posted: the row is done. */
  removeSent(
    row: Pick<ChatScheduledMessage, 'id' | 'chapter_id'>,
  ): Promise<void>;
  markFailed(
    row: Pick<ChatScheduledMessage, 'id' | 'chapter_id'>,
    reason: ChatScheduledMessageFailure,
  ): Promise<void>;
}
