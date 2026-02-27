export type PointCategory =
  | 'ATTENDANCE'
  | 'ACADEMIC'
  | 'SERVICE'
  | 'FINE'
  | 'MANUAL'
  | 'STUDY';

export interface PointTransaction {
  id: string;
  chapter_id: string;
  user_id: string;
  amount: number;
  category: PointCategory;
  description: string;
  metadata: Record<string, unknown>;
  created_at: string;
}
