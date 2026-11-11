/**
 * Which module's id an Activity read names (#4173,
 * `spec/behavior/activity.md` § Unread). The same list is the check on
 * `activity_item_reads.kind`.
 *
 * - `task`: a task (`tasks.id`), whether it is the member's own or one they
 *   can confirm.
 * - `hours_entry`: a service entry waiting on their approval.
 * - `poll`: a poll card, by its chat message id.
 * - `event`: an event.
 * - `link`: a sign-up link (`chat_message_links.id`).
 */
export const ACTIVITY_ITEM_KINDS = [
  'task',
  'hours_entry',
  'poll',
  'event',
  'link',
] as const;
export type ActivityItemKind = (typeof ACTIVITY_ITEM_KINDS)[number];

/** One member's last open of one Activity item. */
export interface ActivityItemRead {
  user_id: string;
  chapter_id: string;
  kind: ActivityItemKind;
  item_id: string;
  read_at: string;
}
