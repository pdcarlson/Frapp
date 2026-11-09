/**
 * Limits on a Backwork course's name and nicknames (#3848). The API's DTO
 * enforces all three. The database backs them too: a check on `name`'s
 * length, and `backwork_course_nicknames_ok` (count, and each nickname 1 to
 * 60 characters) in `supabase/migrations/20261109120000_backwork_courses.sql`,
 * which repeats these numbers. The web dialog stops typing at them.
 */
export const MAX_COURSE_NAME_LENGTH = 255;
export const MAX_COURSE_NICKNAMES = 20;
export const MAX_COURSE_NICKNAME_LENGTH = 60;

/**
 * Nicknames as stored: trimmed, inner whitespace collapsed, blanks dropped,
 * and de-duplicated case-insensitively (first spelling kept). A nickname that
 * repeats `name` is dropped too, since the name already finds the course.
 */
export function normalizeCourseNicknames(
  nicknames: readonly string[],
  name?: string | null,
): string[] {
  const seen = new Set<string>();
  const nameKey = name?.trim().replace(/\s+/g, " ").toLowerCase();
  if (nameKey) seen.add(nameKey);
  const out: string[] = [];
  for (const raw of nicknames) {
    const nickname = raw.trim().replace(/\s+/g, " ");
    const key = nickname.toLowerCase();
    if (!nickname || seen.has(key)) continue;
    seen.add(key);
    out.push(nickname);
  }
  return out;
}
