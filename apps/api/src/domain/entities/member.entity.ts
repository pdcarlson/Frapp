export interface Member {
  id: string;
  user_id: string;
  chapter_id: string;
  role_ids: string[];
  has_completed_onboarding: boolean;
  created_at: string;
  updated_at: string;
}
