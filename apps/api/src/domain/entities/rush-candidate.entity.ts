export type RushBidStatus = 'none' | 'extended';

export interface RushCandidate {
  id: string;
  chapter_id: string;
  display_name: string;
  name_key: string;
  user_id: string | null;
  stage: string;
  bid_status: RushBidStatus;
  created_by: string;
  created_at: string;
}

export interface RushCandidateVote {
  id: string;
  candidate_id: string;
  chapter_id: string;
  voter_id: string;
  created_at: string;
}

/**
 * Live card projection. `vote_count` and `viewer_has_voted` are the only
 * ballot fields the card may show — voter names stay off the wire.
 */
export interface RushCandidateView extends RushCandidate {
  vote_count: number;
  viewer_has_voted: boolean;
}
