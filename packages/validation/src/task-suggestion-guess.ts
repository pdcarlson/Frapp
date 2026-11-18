/**
 * What Frapp fills in on a suggested task the minutes left half-said, so an
 * officer confirms rather than types (Paul, 2026-11-18: "suggested person
 * assigned ... suggested due date ... based on those minutes and just have
 * one less thing to be entering in"). Each guess shows as a suggestion beside
 * its field, and nothing is a task until the officer creates it, so a guess
 * is never saved without someone seeing it (`meetings.md` § Suggested tasks).
 */

export interface GuessableMember {
  user_id?: string | null;
  display_name?: string | null;
}

function words(text: string): string[] {
  return text
    .normalize("NFKC")
    .split(/[^\p{L}\p{N}'’-]+/u)
    .filter(Boolean);
}

/**
 * The member an action item's own words name, when exactly one member fits:
 * "Jake to call the caterer" names Jake when the chapter has one Jake. A full
 * name settles two Jakes; a first name two members share is the officer's
 * pick, never a guess, as is a line that names two different members.
 * Matching is on capitalized whole words, so "mark the date" never names
 * Mark.
 */
export function suggestTaskOwner(
  text: string,
  members: readonly GuessableMember[],
): string | null {
  const said = words(text);
  const capitalized = new Set(said.filter((word) => /^\p{Lu}/u.test(word)));
  const joined = ` ${said.join(" ").toLowerCase()} `;
  const named = members.filter(
    (member) => member.user_id && member.display_name,
  );

  const fullMatches = named.filter((member) => {
    const full = words(member.display_name!).join(" ").toLowerCase();
    return full.includes(" ") && joined.includes(` ${full} `);
  });
  const fullIds = new Set(fullMatches.map((member) => member.user_id!));
  if (fullIds.size === 1) return [...fullIds][0]!;
  if (fullIds.size > 1) return null;

  const byFirst = new Map<string, string[]>();
  for (const member of named) {
    const first = words(member.display_name!)[0];
    if (!first || first.length < 2) continue;
    byFirst.set(first, [...(byFirst.get(first) ?? []), member.user_id!]);
  }
  const hits = [...capitalized]
    .map((word) => byFirst.get(word))
    .filter((ids): ids is string[] => !!ids);
  if (hits.length !== 1) return null;
  const ids = new Set(hits[0]);
  return ids.size === 1 ? [...ids][0]! : null;
}

function isoDay(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

/**
 * A due day for an action item the meeting gave none: a week after the
 * meeting, which is when a chapter that meets weekly asks how it went. None
 * for minutes old enough that the day has gone by, since a due date already
 * passed is no help to anyone.
 */
export function suggestTaskDue(
  meetingStart: string | null | undefined,
  now: Date = new Date(),
): string | null {
  if (!meetingStart) return null;
  const start = new Date(meetingStart);
  if (Number.isNaN(start.getTime())) return null;
  const due = new Date(start);
  due.setDate(due.getDate() + 7);
  const day = isoDay(due);
  return day < isoDay(now) ? null : day;
}
