export interface PollVote {
  id: string;
  message_id: string;
  user_id: string;
  option_index: number;
  created_at: string;
}

export interface PollMetadata {
  question: string;
  options: string[];
  expires_at?: string;
  choice_mode: 'single' | 'multi';
  /** Set by `PollService.close` when the creator manually locks the poll early. */
  closed_at?: string;
  /** The user who closed it — always the poll's own `sender_id` today, but recorded
   * separately from `expires_at`-based expiry so a client can tell the two apart. */
  closed_by?: string;
}

/**
 * A poll as `GET /v1/polls` and `GET /v1/polls/{messageId}` serve it: a
 * projection of the poll's message plus its tallies, with the viewer's block
 * list applied by `maskBlockedPoll` (`chat-block-mask.ts`).
 */
export interface PollWithResults {
  id: string;
  channel_id: string;
  /**
   * Nullable because `chat_messages.sender_id` is. In practice a poll always has
   * one — `poll` is not a kind the archive importer writes, and `createPoll`
   * takes the sender from the session — but the field is projected straight off
   * the message row, so narrowing it here would be a lie the compiler could not
   * catch at the seam where it is read.
   */
  sender_id: string | null;
  content: string;
  type: 'POLL';
  /**
   * The whole {@link PollMetadata} for a clear row. A masked row carries only
   * {@link MaskedPollMetadata}: the question and options are what the blocked
   * member wrote.
   */
  metadata: PollMetadata | MaskedPollMetadata;
  created_at: string;
  isExpired: boolean;
  /** `optionText` is `null` on a masked row; `voteCount` never is. */
  results: {
    optionIndex: number;
    optionText: string | null;
    voteCount: number;
  }[];
  userVotes?: number[];
  /**
   * Whether the caller has blocked the poll's author, on every row, as the
   * timeline's `sender_blocked` is (`chat-block-mask.ts`). This is the signal a
   * client keys on, never the sentinel in `content`.
   */
  sender_blocked: boolean;
}

/**
 * What survives of a blocked member's poll metadata: the fields a card needs to
 * say whether and when the poll closes, none of which the author wrote as text.
 * An allowlist, for `maskMessage`'s reason: a field added to `PollMetadata`
 * later is withheld until someone lets it through.
 */
export type MaskedPollMetadata = Pick<
  PollMetadata,
  'choice_mode' | 'expires_at' | 'closed_at'
>;
