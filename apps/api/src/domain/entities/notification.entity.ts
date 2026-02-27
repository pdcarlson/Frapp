export interface Notification {
  id: string;
  chapter_id: string;
  user_id: string;
  title: string;
  body: string;
  data: Record<string, unknown>;
  read_at: string | null;
  created_at: string;
}

export interface PushToken {
  id: string;
  user_id: string;
  token: string;
  device_name: string | null;
  created_at: string;
}

export interface NotificationPreference {
  id: string;
  user_id: string;
  chapter_id: string;
  category: string;
  is_enabled: boolean;
  updated_at: string;
}

export type Theme = 'light' | 'dark' | 'system';

export interface UserSettings {
  id: string;
  user_id: string;
  quiet_hours_start: string | null;
  quiet_hours_end: string | null;
  quiet_hours_tz: string | null;
  theme: Theme;
  updated_at: string;
}
