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

/**
 * Every value `user_settings.theme` holds, as its check constraint lists them.
 * The settings DTOs take both their published enum and their validation from
 * this one list, so the contract and the API cannot disagree about which themes
 * exist. The check constraint is the other copy, and moves in a migration.
 */
export const THEMES = ['light', 'dark', 'system'] as const;

export type Theme = (typeof THEMES)[number];

export interface UserSettings {
  id: string;
  user_id: string;
  quiet_hours_start: string | null;
  quiet_hours_end: string | null;
  quiet_hours_tz: string | null;
  theme: Theme;
  updated_at: string;
}

/**
 * A member's settings as `GET` and `PATCH /v1/settings` answer them: the fields
 * they can change, without the row's bookkeeping. A member who has never saved
 * has no row, so they have no `id` or `updated_at` to report either (#2885).
 */
export type UserSettingsValues = Pick<
  UserSettings,
  'quiet_hours_start' | 'quiet_hours_end' | 'quiet_hours_tz' | 'theme'
>;
