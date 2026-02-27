export type ServiceEntryStatus = 'PENDING' | 'APPROVED' | 'REJECTED';

export interface ServiceEntry {
  id: string;
  chapter_id: string;
  user_id: string;
  date: string;
  duration_minutes: number;
  description: string;
  proof_path: string | null;
  status: ServiceEntryStatus;
  reviewed_by: string | null;
  review_comment: string | null;
  points_awarded: boolean;
  created_at: string;
}
