/**
 * The president's AI switches for one chapter (`chapter_ai_settings`,
 * #4308). A chapter with no row has every switch off.
 */
export interface ChapterAiSettings {
  chapter_id: string;
  ask_enabled: boolean;
  meeting_notes_enabled: boolean;
  chat_source_enabled: boolean;
  updated_by: string | null;
  updated_at: string;
}

/**
 * One person's answer on one version of the AI sheet (`user_ai_consents`,
 * #4308). Only the row for the current version counts; no row is No.
 */
export interface UserAiConsent {
  user_id: string;
  sheet_version: number;
  accepted: boolean;
  answered_at: string;
}
