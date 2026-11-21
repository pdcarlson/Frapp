/**
 * How a member arranged their Activity cards (#5520), one row per
 * (member, chapter) in `activity_layouts`
 * (`20261118173946_activity_layouts.sql`).
 *
 * No row means the default for the member's role. Both lists hold card keys
 * matching `ACTIVITY_CARD_KEY_PATTERN` in `@repo/validation`, which may include
 * keys this API doesn't know (a newer client's card). The rule is
 * `spec/behavior/activity.md` § Cards.
 */
export interface ActivityLayout {
  user_id: string;
  chapter_id: string;
  /** The cards shown, top to bottom. */
  card_order: string[];
  /** The cards the member hid. */
  hidden_cards: string[];
  created_at: string;
  updated_at: string;
}
