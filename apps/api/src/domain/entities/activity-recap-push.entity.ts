/**
 * A weekly recap push a member was sent (#4985): the claim that sends it once
 * per chapter, member and week, however many API replicas swept.
 * `week_first_day` is `YYYY-MM-DD`, the Sunday the recapped week began on in
 * the member's own time zone.
 */
export interface ActivityRecapPush {
  chapter_id: string;
  user_id: string;
  week_first_day: string;
  created_at: string;
}
