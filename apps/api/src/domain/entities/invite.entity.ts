export interface Invite {
  id: string;
  token: string;
  chapter_id: string;
  role: string;
  expires_at: string;
  created_by: string;
  used_at: string | null;
  created_at: string;
}
