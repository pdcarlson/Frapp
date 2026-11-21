/**
 * Limits on a Backwork course's name and nicknames (#3848). The API's DTO
 * enforces all three. The database backs them too: a check on `name`'s
 * length, and `backwork_course_nicknames_ok` (count, and each nickname 1 to
 * 60 characters) in `supabase/migrations/20261109230000_backwork_courses.sql`,
 * which repeats these numbers. The web dialog stops typing at them.
 */
export const MAX_COURSE_NAME_LENGTH = 255;
export const MAX_COURSE_NICKNAMES = 20;
export const MAX_COURSE_NICKNAME_LENGTH = 60;

/**
 * A course name or nickname as stored: trimmed, inner whitespace collapsed to
 * one space. The API and the web dialog share it. The SQL that compares
 * nicknames (`backwork_course_merge_nicknames`) spells its own version,
 * which agrees with this for ASCII whitespace.
 */
export function collapseCourseText(text: string): string {
  return text.trim().replace(/\s+/g, " ");
}

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
  const nameKey = name ? collapseCourseText(name).toLowerCase() : "";
  if (nameKey) seen.add(nameKey);
  const out: string[] = [];
  for (const raw of nicknames) {
    const nickname = collapseCourseText(raw);
    const key = nickname.toLowerCase();
    if (!nickname || seen.has(key)) continue;
    seen.add(key);
    out.push(nickname);
  }
  return out;
}

/**
 * Length as Postgres `char_length` counts it: code points, so an emoji made
 * of two UTF-16 units counts once, and "❤️" (heart + variation selector)
 * counts twice. Use it for every course-name and nickname limit, so a value
 * the API accepts never trips the table's checks.
 */
export function courseTextLength(text: string): number {
  return [...text].length;
}

/**
 * Why a course name or nickname is too long, or null when every one fits
 * (`MAX_COURSE_NAME_LENGTH`, `MAX_COURSE_NICKNAME_LENGTH`, by
 * `courseTextLength`).
 */
export function courseTextTooLong(
  name: string | null | undefined,
  nicknames: readonly string[],
): string | null {
  if (name && courseTextLength(name) > MAX_COURSE_NAME_LENGTH) {
    return `A course name takes at most ${MAX_COURSE_NAME_LENGTH} characters`;
  }
  if (nicknames.some((n) => courseTextLength(n) > MAX_COURSE_NICKNAME_LENGTH)) {
    return `A nickname takes at most ${MAX_COURSE_NICKNAME_LENGTH} characters`;
  }
  return null;
}

/**
 * A department code as matched (#3918): trimmed and upper-cased, so "math",
 * " Math " and "MATH" are one department. New departments are stored this
 * way; an existing one keeps the spelling it was filed under.
 */
export function departmentCodeKey(code: string): string {
  return code.trim().toUpperCase();
}

/**
 * The chapter department a typed code files under, by {@link departmentCodeKey}.
 * The API's upload (`confirmUpload`) and the web upload sheet's course lookup
 * both pick with this, so they agree. Where case variants already exist side by
 * side (filed before #3918), the exact trimmed spelling wins, then the
 * first code in code-unit order, then the lowest id: an order both ends can
 * compute from the rows alone.
 */
export function findDepartmentByCode<T extends { id: string; code: string }>(
  departments: readonly T[],
  code: string,
): T | undefined {
  const key = departmentCodeKey(code);
  if (!key) return undefined;
  const typed = code.trim();
  const rank = (d: T) => (d.code.trim() === typed ? 0 : 1);
  let best: T | undefined;
  for (const d of departments) {
    if (departmentCodeKey(d.code) !== key) continue;
    if (
      !best ||
      rank(d) < rank(best) ||
      (rank(d) === rank(best) &&
        (d.code < best.code || (d.code === best.code && d.id < best.id)))
    ) {
      best = d;
    }
  }
  return best;
}
