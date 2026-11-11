export const CHAT_IMPORTANT_SEEN_REPOSITORY = 'CHAT_IMPORTANT_SEEN_REPOSITORY';

/**
 * Which Important messages a member has seen (#4186):
 * `chat_message_important_seen`.
 *
 * **Every method takes both the chapter and the member, and every query
 * filters on both.** Chapter-first, per the repository convention. There is
 * no method that reads another member's rows: what someone has seen is theirs.
 */
export interface IChatImportantSeenRepository {
  /** Of `messageIds`, the ones this member has seen. */
  findSeenMessageIds(
    chapterId: string,
    userId: string,
    messageIds: readonly string[],
  ): Promise<Set<string>>;
  /** Marks each message seen. Idempotent: a repeat keeps the first `seen_at`. */
  markSeen(
    chapterId: string,
    userId: string,
    messageIds: readonly string[],
  ): Promise<void>;
}
