/**
 * A chat message a member scheduled to post later (#4956):
 * `chat_scheduled_messages`. The sweep posts it at `send_at` as its author and
 * deletes the row; one it can no longer post stays `failed`.
 */
export type ChatScheduledMessageStatus = 'pending' | 'failed';

/**
 * Why a scheduled message did not post. `no_access`: the author can no longer
 * post in the channel (or is no longer in the chapter). `not_sendable`: the
 * send refused the message itself (the channel was deleted, the message is no
 * longer valid there). `send_failed`: it kept failing for some other reason.
 */
export type ChatScheduledMessageFailure =
  'no_access' | 'not_sendable' | 'send_failed';

export interface ChatScheduledMessage {
  id: string;
  chapter_id: string;
  channel_id: string;
  user_id: string;
  content: string;
  /** The composer's `@` picks (#3835), as `{ user_id, label }[]`. */
  mention_picks: { user_id: string; label: string }[] | null;
  send_at: string;
  status: ChatScheduledMessageStatus;
  failure_reason: ChatScheduledMessageFailure | null;
  attempts: number;
  lease_until: string | null;
  created_at: string;
  updated_at: string;
}
