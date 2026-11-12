export interface Notification {
  id: string;
  chapter_id: string;
  user_id: string;
  title: string;
  body: string;
  data: Record<string, unknown>;
  /**
   * The chat message a single-message chat row quotes (#4418). Deleting the
   * message deletes the row (a trigger), and an edit rewrites its body. Null
   * on every other row, a burst bundle included.
   */
  chat_message_id?: string | null;
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

/**
 * Every status a member can pick (#3845), as `user_settings.status`'s check
 * constraint lists them. `online` is the default and what an expired status
 * reads as. The constraint is the other copy, and moves in a migration.
 */
export const MEMBER_STATUSES = ['online', 'idle', 'dnd', 'invisible'] as const;

export type MemberStatus = (typeof MEMBER_STATUSES)[number];

/** Longest custom status line, as the column's check constraint caps it. */
export const CUSTOM_STATUS_MAX_LENGTH = 80;

export interface UserSettings {
  id: string;
  user_id: string;
  quiet_hours_start: string | null;
  quiet_hours_end: string | null;
  quiet_hours_tz: string | null;
  /**
   * The zone the member's device last reported (`x-time-zone`), which pushes
   * name times in. Not a setting the member edits, so it is not in
   * {@link UserSettingsValues}. Optional so fixtures that predate it still
   * type-check.
   */
  time_zone?: string | null;
  theme: Theme;
  /**
   * The member's chosen status (#3845). Optional here, like `time_zone`, so
   * fixtures that predate it still type-check; the column defaults to `online`.
   */
  status?: MemberStatus;
  /** When the status reverts to `online`. Null: until the member changes it. */
  status_expires_at?: string | null;
  /** One short line ("At practice till 6"), or null for none. */
  custom_status?: string | null;
  /** When the custom line clears. Null: until the member clears it. */
  custom_status_expires_at?: string | null;
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
> &
  Required<
    Pick<
      UserSettings,
      | 'status'
      | 'status_expires_at'
      | 'custom_status'
      | 'custom_status_expires_at'
    >
  >;
