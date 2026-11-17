/**
 * How long a meeting's working material is kept: an officer's notes, a draft
 * request from notes, and a recording with its transcript are all deleted
 * once older than this, posted or not (`spec/behavior/meetings.md`
 * § Retention: a transcript "is kept as the officer's notes are").
 *
 * One number for all three sweeps (notes, draft requests and recordings), so
 * their windows can't drift apart.
 */
export const MEETING_NOTES_RETENTION_DAYS = 30;

const DAY_MS = 24 * 60 * 60 * 1000;

/** The instant before which a retention sweep at `now` deletes rows. */
export function meetingRetentionCutoff(now: Date): Date {
  return new Date(now.getTime() - MEETING_NOTES_RETENTION_DAYS * DAY_MS);
}
