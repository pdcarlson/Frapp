export const CHAT_CATCH_UP_REPOSITORY = 'CHAT_CATCH_UP_REPOSITORY';

/** One message of a stretch, as stored. Whose it may be read is the service's call. */
export interface CatchUpMessageRow {
  id: string;
  /** Null for an imported Discord message nobody linked to a member. */
  sender_id: string | null;
  content: string;
  created_at: string;
  thread_root_id: string | null;
  mentions: string[] | null;
}

export interface CatchUpStretch {
  /** The newest messages of the stretch under the limit, oldest first. */
  messages: CatchUpMessageRow[];
  /** How many messages the stretch holds, read or not. */
  total: number;
}

/**
 * The messages Catch me up reads (#3946): a channel's messages from a moment
 * on, or one thread.
 *
 * Every read is scoped to the chapter and to a chapter channel in the query
 * itself: a direct message, a group DM and the audit-log channel return
 * nothing whatever the caller passes, as the chat index's window read refuses
 * them (`20261112170000_ai_corpus_chat.sql`). Only messages a member wrote
 * are returned: text, announcements and imported history, not deleted and
 * not empty. Cards (events, polls, tasks) and system rows are not
 * conversation.
 *
 * Nothing here authorizes or filters by consent. The caller has checked that
 * the member can read the channel, and decides whose messages are read.
 */
export interface IChatCatchUpRepository {
  /**
   * When the member's unread stretch began: the send time of the `count`th
   * newest message that counted as unread at `asOf` (a timeline message from
   * someone else, not deleted, not imported: the unread badge's rule,
   * `get_channel_unread_counts`). Null when the channel holds fewer.
   */
  unreadStart(input: {
    chapterId: string;
    channelId: string;
    userId: string;
    count: number;
    asOf: string;
  }): Promise<string | null>;

  /**
   * The channel's messages sent at or after `since`: timeline messages and
   * thread replies alike, since a reply is part of what was said.
   */
  readChannelSince(input: {
    chapterId: string;
    channelId: string;
    since: string;
    limit: number;
  }): Promise<CatchUpStretch>;

  /**
   * One thread: its first message and its replies. Null when `rootId` is not
   * a timeline message of this channel.
   */
  readThread(input: {
    chapterId: string;
    channelId: string;
    rootId: string;
    limit: number;
  }): Promise<CatchUpStretch | null>;
}
