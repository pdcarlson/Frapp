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
 * - `signup`: a sign-up sheet or headcount card, by its chat message id.
 * - `form`: a form card, by its chat message id.
 */
export const ACTIVITY_ITEM_KINDS = [
  'task',
  'hours_entry',
  'poll',
  'event',
  'link',
  'signup',
  'form',
] as const;
export type ActivityItemKind = (typeof ACTIVITY_ITEM_KINDS)[number];

/**
 * When one member's unread dots began in one chapter: the first time a client
 * that draws them opened Activity. Nothing that appeared before it is unread.
 */
export interface ActivityUnreadStart {
  user_id: string;
  chapter_id: string;
  started_at: string;
}

/** One member's last open of one Activity item. */
export interface ActivityItemRead {
  user_id: string;
  chapter_id: string;
  kind: ActivityItemKind;
  item_id: string;
  read_at: string;
}

/**
 * One member's snooze of one Activity item (#4982, `spec/behavior/activity.md`
 * § Snooze): the row leaves their list until `until`, then comes back. Kept
 * after it ends, since when it came back decides whether it is unread.
 */
export interface ActivityItemSnooze {
  user_id: string;
  chapter_id: string;
  kind: ActivityItemKind;
  item_id: string;
  until: string;
  created_at: string;
}
