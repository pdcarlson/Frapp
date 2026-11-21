/**
 * Group kinds (#4076, #5778): what each automatic group follows, and which
 * kinds can open a channel. One copy for the API and both apps.
 */

/** Every kind of group `GET /v1/groups` returns. */
export const CHAPTER_GROUP_KINDS = [
  "manual",
  "pledge_class",
  "class_year",
  "major",
] as const;

export type ChapterGroupKind = (typeof CHAPTER_GROUP_KINDS)[number];

/**
 * Whether a group of this kind can open a channel that lists it, or be what
 * a task is "From". A class year or a major can't: members set their own,
 * so a list naming one would let anyone in by changing theirs. Both are for
 * `@`-mentions and task audiences only (`can_read_chat_channel` in
 * `20261121173330_major_groups.sql` holds the same rule). A kind this build
 * doesn't know opens nothing.
 */
export function groupKindOpensChannels(kind: string): boolean {
  return kind === "manual" || kind === "pledge_class";
}

/**
 * The form majors match on, as `chapter_major_key` folds it in the
 * database: trimmed, each run of whitespace one space, lower case. `""` for
 * no major. "mechE" and " MechE " are the same major; "MechE" and
 * "Mechanical Engineering" are not.
 */
export function majorGroupKey(major: string | null | undefined): string {
  return (major ?? "").replace(/\s+/g, " ").trim().toLowerCase();
}

/**
 * The chapter's majors to suggest under the profile's Major field (#5778),
 * so a member picks an existing one rather than make a near twin: those
 * containing what is typed (any case), ones starting with it first, then
 * alphabetical. Nothing once the field already holds one of them exactly,
 * and at most `limit`.
 */
export function majorSuggestions(
  majors: readonly string[],
  typed: string,
  limit = 6,
): string[] {
  const query = majorGroupKey(typed);
  const seen = new Set<string>();
  const unique = majors.filter((major) => {
    const key = majorGroupKey(major);
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
  if (query && seen.has(query)) return [];
  return unique
    .filter((major) => majorGroupKey(major).includes(query))
    .sort((a, b) => {
      const aStarts = majorGroupKey(a).startsWith(query) ? 0 : 1;
      const bStarts = majorGroupKey(b).startsWith(query) ? 0 : 1;
      return aStarts - bStarts || a.localeCompare(b);
    })
    .slice(0, limit);
}

/**
 * The standings a class-year group also goes by (#5786), most senior first.
 * `@Seniors` reaches the same members as the class year it stands for.
 */
export const CLASS_STANDINGS = [
  "Seniors",
  "Juniors",
  "Sophomores",
  "Freshmen",
] as const;

export type ClassStanding = (typeof CLASS_STANDINGS)[number];

/**
 * The month (0-based, UTC) the academic year turns over and every class
 * moves up a standing (#5786): June 1, after spring graduations. A fixed
 * date rather than the chapter's semester rollover, which an officer runs by
 * hand twice a year and can't say which of the two ends the year.
 */
export const ACADEMIC_YEAR_ROLLOVER_MONTH = 5;

/**
 * The graduation year of this academic year's seniors: the calendar year
 * the academic year ends in. 2027 from June 1, 2026 through May 31, 2027.
 */
export function seniorClassYear(now: Date = new Date()): number {
  const year = now.getUTCFullYear();
  return now.getUTCMonth() >= ACADEMIC_YEAR_ROLLOVER_MONTH ? year + 1 : year;
}

/**
 * The standing a graduation year has now (#5786), or `null` for a year more
 * than three out (not in college yet) or already past (alumni, or a
 * fifth-year who hasn't moved their graduation year on). Those keep only
 * their "Class of" group.
 */
export function classStanding(
  classYear: number | null | undefined,
  now: Date = new Date(),
): ClassStanding | null {
  if (classYear == null || !Number.isInteger(classYear)) return null;
  return CLASS_STANDINGS[classYear - seniorClassYear(now)] ?? null;
}

/**
 * A group's name as the Groups settings lists it: a class year with a
 * standing reads "Sophomores · Class of 2029"
 * (in 2026-27), anything else its own name.
 */
export function groupDisplayName(
  group: { kind: string; name: string; class_year?: number | null },
  now: Date = new Date(),
): string {
  if (group.kind !== "class_year") return group.name;
  const standing = classStanding(group.class_year, now);
  return standing ? `${standing} · ${group.name}` : group.name;
}
