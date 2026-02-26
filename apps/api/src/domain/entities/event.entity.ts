export interface Event {
  id: string;
  chapter_id: string;
  name: string;
  description: string | null;
  location: string | null;
  start_time: string;
  end_time: string;
  point_value: number;
  is_mandatory: boolean;
  recurrence_rule: string | null;
  parent_event_id: string | null;
  required_role_ids: string[] | null;
  notes: string | null;
  created_at: string;
}
