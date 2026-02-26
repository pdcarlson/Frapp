export interface Role {
  id: string;
  chapter_id: string;
  name: string;
  permissions: string[];
  is_system: boolean;
  display_order: number;
  color: string | null;
  created_at: string;
}
