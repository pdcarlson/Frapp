/**
 * Whether a member is locked out of the dashboard: their roles grant nothing
 * in their only chapter (#3236). `NoAccessRedirect` sends such a member to
 * `/no-access`, and `/join` uses the same rule to keep from offering them
 * Open chat, which would send them there again (#3850).
 *
 * It holds only on an answer. While the permission read is loading or
 * disabled (no active chapter yet) there is no list, and a failed read with
 * nothing cached has none either, so neither is mistaken for "no
 * permissions". A failed *refetch* keeps the last answer, which is still the
 * member's.
 *
 * Only for a member of exactly one chapter: `/no-access` has no chapter
 * switcher, so a member of another chapter would be stranded there, and the
 * shell they already have is where they switch.
 */
export function isLockedOutOfChapter(
  permissions: readonly string[] | null | undefined,
  membershipCount: number,
): boolean {
  return (
    Array.isArray(permissions) &&
    permissions.length === 0 &&
    membershipCount === 1
  );
}
