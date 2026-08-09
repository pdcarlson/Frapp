import type { ActivationMilestone } from '@repo/validation';

/**
 * First time a chapter reached an activation-funnel milestone (#267).
 *
 * At most one row per `(chapter_id, milestone)` — the row's existence *is* the
 * record that the milestone happened, and `occurred_at` is when it first did.
 * There is no "count" column on purpose: this table answers "did this chapter
 * get here, and when", not "how many times".
 */
export interface ChapterActivationMilestone {
  id: string;
  chapter_id: string;
  milestone: ActivationMilestone;
  occurred_at: string;
}
