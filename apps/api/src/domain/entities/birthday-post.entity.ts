/**
 * A birthday post a chapter made (#4959): the claim that makes it once per
 * member and day, whatever channel it went to and however many API replicas
 * swept. `local_date` is `YYYY-MM-DD` in the member's own time zone.
 */
export interface BirthdayPost {
  chapter_id: string;
  user_id: string;
  local_date: string;
  created_at: string;
}
