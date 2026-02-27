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
}
