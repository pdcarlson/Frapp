/**
 * Who Frapp suggests for a task the minutes left half-said, so an officer
 * confirms rather than types (Paul, 2026-11-18: "suggested person assigned ...
 * based on those minutes and just have one less thing to be entering in").
 * The guess shows as a suggestion beside its field on the one card the
 * officer is looking at, and nothing is a task until the officer creates it,
 * so a guess is never saved without someone seeing it (`meetings.md`
 * § Suggested tasks). The suggested due day lives with the other due-day
 * helpers in `@repo/formatting` (`suggestTaskDue`).
 */

export interface GuessableMember {
  user_id?: string | null;
  display_name?: string | null;
}

interface Word {
  text: string;
  /** Lowercased, with a trailing possessive ('s) taken off. */
  key: string;
  /** First word of a sentence, where a capital says nothing about a name. */
  opensSentence: boolean;
}

function words(text: string): Word[] {
  const out: Word[] = [];
  let opensSentence = true;
  for (const token of text.normalize("NFKC").split(/\s+/)) {
    const text = token.replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}'’-]+$/gu, "");
    if (text) {
      out.push({
        text,
        key: text.toLowerCase().replace(/['’]s$/u, ""),
        opensSentence,
      });
    }
    if (text || /[.!?:;]$/.test(token)) opensSentence = /[.!?:;]$/.test(token);
  }
  return out;
}

/**
 * Words that follow a name when an action item opens with it ("Jake to call",
 * "Sam will book", "Mark and Chase sweep"), and never follow an opening verb
 * ("Mark the date", "Chase down the sponsor", "Grant access").
 */
const AFTER_A_NAME = new Set([
  "to",
  "will",
  "should",
  "needs",
  "need",
  "is",
  "has",
  "can",
  "and",
  "&",
  "volunteered",
  "offered",
  "agreed",
  "said",
]);

/**
 * The member an action item's own words name, when exactly one member fits:
 * "Jake to call the caterer" names Jake when the chapter has one Jake. A full
 * name settles two Jakes; a first name two members share is the officer's
 * pick, never a guess, as is a line that names two different members.
 * Matching is on capitalized words, and a sentence's opening word counts only
 * when a name's usual next word follows it, so neither "mark the date" nor
 * "Mark the formal on the calendar" names Mark.
 */
export function suggestTaskOwner(
  text: string,
  members: readonly GuessableMember[],
): string | null {
  const said = words(text);
  const joined = ` ${said.map((word) => word.key).join(" ")} `;
  const named = members.filter(
    (member) => member.user_id && member.display_name?.trim(),
  );

  const fullIds = new Set(
    named
      .filter((member) => {
        const full = words(member.display_name!)
          .map((word) => word.key)
          .join(" ");
        return full.includes(" ") && joined.includes(` ${full} `);
      })
      .map((member) => member.user_id!),
  );
  if (fullIds.size === 1) return [...fullIds][0]!;
  if (fullIds.size > 1) return null;

  const byFirst = new Map<string, Set<string>>();
  for (const member of named) {
    const first = words(member.display_name!)[0]?.key;
    if (!first || first.length < 2) continue;
    byFirst.set(first, (byFirst.get(first) ?? new Set()).add(member.user_id!));
  }

  const hits = new Set<string>();
  said.forEach((word, at) => {
    if (!/^\p{Lu}/u.test(word.text) || !byFirst.has(word.key)) return;
    const next = said[at + 1]?.key;
    if (word.opensSentence && next !== undefined && !AFTER_A_NAME.has(next)) {
      return;
    }
    hits.add(word.key);
  });
  if (hits.size !== 1) return null;
  const ids = byFirst.get([...hits][0]!)!;
  return ids.size === 1 ? [...ids][0]! : null;
}
