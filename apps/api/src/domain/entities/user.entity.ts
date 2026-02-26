export interface User {
  id: string;
  supabase_auth_id: string;
  email: string;
  display_name: string;
  avatar_url: string | null;
  bio: string | null;
  graduation_year: number | null;
  current_city: string | null;
  current_company: string | null;
  created_at: string;
  updated_at: string;
}
