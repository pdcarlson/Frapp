/**
 * Whether a member may change their own name (#5801, Paul 2026-11-21: a member
 * kept renaming himself to the president's name). A chapter setting,
 * `chapters.members_can_change_name`, off by default: once a member has
 * finished joining, only an officer holding `roles:manage` changes their name
 * (`PATCH /v1/members/{id}/profile`). `spec/behavior/members.md` § Profiles.
 *
 * One copy of the words, so the API's refusal, both apps' Profile and both
 * apps' Chapter settings say the same thing.
 */
export const NAME_LOCK_COPY = {
  /** The Chapter settings switch, on web and the phone. */
  settingLabel: "Members can change their own name",
  /** The phone's row line when the switch's save failed (web toasts). */
  saveFailed: "Couldn't save that. Try again.",
  /** The switch's one muted line. */
  settingLine: "When off, officers who manage roles change names.",
  /** Under the member's own name on Profile while it is locked. */
  lockedLine: "Your chapter's officers set names.",
  /** The API's 403 for a rename it refuses. */
  refusal: "Your chapter's officers set names, so ask one to change yours.",
} as const;

/**
 * Whether the caller's own row (`GET /v1/users/me`, the PATCH's answer) says
 * their name is locked. Narrowed at runtime because the route has no response
 * schema; anything but `true` reads as unlocked, and the API refuses a locked
 * rename either way.
 */
export function isDisplayNameLocked(me: unknown): boolean {
  return (
    !!me &&
    typeof me === "object" &&
    (me as { display_name_locked?: unknown }).display_name_locked === true
  );
}
