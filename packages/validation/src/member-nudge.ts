/**
 * Member nudges (#4781, `spec/behavior/ai.md` § Nudges): the one card Frapp
 * puts on a member's Activity when something of theirs is worth a word. The
 * kinds, the limits on the words, and the few lines both clients show are
 * defined once, here.
 *
 * Forward compatibility, as for Ask's format: a client shows a card of a
 * `kind` it does not know as a plain card with its two lines and "Not now".
 */

/** Why a card exists. The same list as the `member_nudges.kind` check. */
export const MEMBER_NUDGE_KINDS = [
  "task_due_soon",
  "task_overdue",
  "task_sent_back",
  "task_praise",
] as const;
export type MemberNudgeKind = (typeof MEMBER_NUDGE_KINDS)[number];

/** How a member closes a card. `thanks` closes a praise card. */
export const MEMBER_NUDGE_DISMISS_REASONS = [
  "not_now",
  "fewer",
  "thanks",
] as const;
export type MemberNudgeDismissReason =
  (typeof MEMBER_NUDGE_DISMISS_REASONS)[number];

/** The most characters a card's title, body and starting point may hold. */
export const MEMBER_NUDGE_TITLE_MAX = 40;
export const MEMBER_NUDGE_BODY_MAX = 170;
export const MEMBER_NUDGE_START_MAX = 150;

/** How long "Fewer like this" keeps new cards away. */
export const MEMBER_NUDGE_FEWER_QUIET_DAYS = 14;

/** Whether a kind is a word of thanks, with nothing to do. */
export function isMemberNudgePraise(kind: string): boolean {
  return kind === "task_praise";
}

/**
 * What "Ask about this" puts in Ask's box for the member to send or change.
 * The member's own question, so it is theirs to edit before it goes.
 */
export function memberNudgeAskPrompt(taskTitle: string): string {
  return `Help me get started on "${taskTitle.trim()}". What should I do first?`;
}
