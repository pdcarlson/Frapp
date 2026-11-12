/**
 * An officer's screen showing an event's check-in QR
 * (`event_check_in_screens`, #4532).
 *
 * One row per officer per event, written by their phone while it shows the
 * code. The location fields are all set or all null: null means that screen
 * couldn't tell where it was, so it anchors nothing (the code is still
 * required). Kept only until `expires_at`, the close of the event's check-in
 * window.
 */
export interface EventCheckInScreen {
  event_id: string;
  reported_by: string;
  chapter_id: string;
  lat: number | null;
  lng: number | null;
  accuracy_m: number | null;
  located_at: string | null;
  shown_at: string;
  expires_at: string;
}
