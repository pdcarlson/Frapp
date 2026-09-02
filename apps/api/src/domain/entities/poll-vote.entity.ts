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
