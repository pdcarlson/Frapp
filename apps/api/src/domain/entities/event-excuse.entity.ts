export type EventExcuseStatus = 'PENDING' | 'APPROVED' | 'DECLINED';

/**
 * A member's request to be excused from an event that requires them
 * (`event_excuses`, #3735; `spec/behavior/events.md` § Excuses).
 *
 * Kept apart from `event_attendance` so it can exist before the event.
 * Approving writes the member's attendance `EXCUSED` with `reason`, in the same
 * transaction (`decide_event_excuse`).
 */
export interface EventExcuse {
  id: string;
  chapter_id: string;
  event_id: string;
  user_id: string;
  /** The member's one line, 1 to 500 characters. */
  reason: string;
  status: EventExcuseStatus;
  /** Who decided; null while pending, or once their account is deleted. */
  decided_by: string | null;
  /** When it was decided; null exactly while pending. */
  decided_at: string | null;
  created_at: string;
  updated_at: string;
}
