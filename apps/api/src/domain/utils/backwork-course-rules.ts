import { normalizeCourseNicknames } from '@repo/validation';

/**
 * Who may edit a Backwork course's name and nicknames (#3848, the
 * social-trust default of #3709). The one place this rule lives; the service
 * calls it, and the web dialog mirrors it only to hide controls.
 *
 * - Anyone who may upload (`backwork:upload`) may name a course that has no
 *   name yet, and may add nicknames.
 * - Changing a name that is already set, removing a nickname, and deleting a
 *   course need `backwork:admin`.
 *
 * `edit` is the change asked for: the name the course would have, and the
 * nicknames asked to be removed. Returns why the edit is refused, or `null`
 * when it is allowed.
 */
export function courseEditRefusal(
  stored: { name: string | null } | null,
  edit: { name: string | null; removeNicknames: readonly string[] },
  isAdmin: boolean,
): string | null {
  if (isAdmin) return null;
  if (stored && stored.name !== null && stored.name !== edit.name) {
    return 'Only a backwork admin can change a course name that is already set.';
  }
  if (edit.removeNicknames.some((n) => n.trim() !== '')) {
    return 'Only a backwork admin can remove a nickname.';
  }
  return null;
}

/**
 * The nicknames an edit would leave, predicted from the row as the service
 * read it, so it can refuse a list past the cap with a 400 before writing.
 * The write itself (`backwork_course_write`) applies the same arithmetic in
 * SQL to the row as it is when the statement runs:
 * `remove` matches case-insensitively, `add` joins the end, and the result is
 * normalised (`normalizeCourseNicknames`; one that repeats `name` drops). Not
 * capped: the caller refuses a list past `MAX_COURSE_NICKNAMES`.
 */
export function applyNicknameEdit(
  stored: readonly string[],
  add: readonly string[],
  remove: readonly string[],
  name: string | null,
): string[] {
  const removed = new Set(remove.map((n) => n.trim().toLowerCase()));
  return normalizeCourseNicknames(
    [...stored.filter((n) => !removed.has(n.trim().toLowerCase())), ...add],
    name,
  );
}
