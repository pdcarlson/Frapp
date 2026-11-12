/**
 * Where an event's check-in QR screen is (`event_check_in_screens`, #4532).
 *
 * One row per event, written by the officer's phone while it shows the code.
 * The location fields are all set or all null: null means a screen showed the
 * code but couldn't tell where it was, so the code is required and the
 * distance isn't checked. Kept only until `expires_at`, the close of the
 * event's check-in window.
 */
export interface EventCheckInScreen {
  event_id: string;
  chapter_id: string;
  lat: number | null;
  lng: number | null;
  accuracy_m: number | null;
  located_at: string | null;
  shown_at: string;
  expires_at: string;
}
