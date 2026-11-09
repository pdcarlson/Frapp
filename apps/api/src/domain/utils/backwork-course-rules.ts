import {
  MAX_COURSE_NICKNAMES,
  normalizeCourseNicknames,
} from '@repo/validation';

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
 * Returns why the edit is refused, or `null` when it is allowed.
 */
export function courseEditRefusal(
  stored: { name: string | null; nicknames: readonly string[] } | null,
  next: { name: string | null; nicknames: readonly string[] },
  isAdmin: boolean,
): string | null {
  if (isAdmin || !stored) return null;
  if (stored.name !== null && stored.name !== next.name) {
    return 'Only a backwork admin can change a course name that is already set.';
  }
  // A nickname folded into the new name isn't lost, so it isn't a removal.
  const kept = new Set(
    [...next.nicknames, ...(next.name ? [next.name] : [])].map((n) =>
      n.toLowerCase(),
    ),
  );
  if (stored.nicknames.some((n) => !kept.has(n.toLowerCase()))) {
    return 'Only a backwork admin can remove a nickname.';
  }
  return null;
}

/**
 * The course a department merge keeps when source and target both name the
 * same course number: the target's name (or the source's when the target has
 * none), every nickname of both, and the losing name as a nickname, so
 * nothing anyone typed stops finding the course. Past `MAX_COURSE_NICKNAMES`
 * the target's own nicknames win.
 */
export function mergeCourseNames(
  target: { name: string | null; nicknames: readonly string[] },
  source: { name: string | null; nicknames: readonly string[] },
): { name: string | null; nicknames: string[] } {
  const name = target.name ?? source.name;
  const losing = target.name && source.name ? source.name : null;
  const nicknames = normalizeCourseNicknames(
    [...target.nicknames, ...(losing ? [losing] : []), ...source.nicknames],
    name,
  ).slice(0, MAX_COURSE_NICKNAMES);
  return { name, nicknames };
}
