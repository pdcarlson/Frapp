/**
 * Rolling 24-hour ceilings on writes that reach people outside the chapter:
 * emailed invites, and the chapters one account can start. Each is counted
 * from rows the database already keeps (`invites`, `chapters`), so it holds
 * across API replicas and restarts, where the per-minute throttler
 * (`throttle-profiles.decorator.ts`) is per process.
 *
 * Product choices, set so normal use never meets them
 * (`spec/behavior/README.md` § Daily limits):
 *
 * - A new president inviting a whole 150-member chapter on day one sends 150
 *   emails, and resends to the ones that bounced or were mistyped stay well
 *   inside 300. A chapter at the limit can still share an invite link, which
 *   sends no email.
 * - There is no tighter ceiling for a chapter of one. A real chapter is a
 *   chapter of one on its first day too, so any ceiling that lets that
 *   president invite everyone is no tighter than these. What bounds an
 *   account that starts chapters only to send email is the per-inviter
 *   ceiling, which counts across every chapter, and the chapter ceiling below.
 */

/** Emailed invites one chapter may send in any 24 hours. */
export const INVITE_EMAILS_PER_CHAPTER_PER_DAY = 300;

/** Emailed invites one member may send in any 24 hours, across chapters. */
export const INVITE_EMAILS_PER_INVITER_PER_DAY = 300;

/** Chapters one account may start in any 24 hours. */
export const CHAPTERS_STARTED_PER_USER_PER_DAY = 3;

/** The window every ceiling above counts over. */
export const DAILY_LIMIT_WINDOW_MS = 24 * 60 * 60 * 1000;
