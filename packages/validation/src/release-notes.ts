/**
 * What's new, in members' words: the one list behind mobile Settings → What's
 * new, web's account menu → What's new, and the block Paul pastes to beta
 * testers (`npm run release-notes`).
 *
 * Newest first. Each entry is one batch of changes that reached members on
 * `date` (a store build or an over-the-air update; members never see which).
 *
 * How to write a line: say what a member can now do or will notice, the way
 * you'd tell a friend. No feature codes, issue numbers, version strings,
 * screen ids, or emojis. A bit vague is fine; wrong is not, so only list what
 * is merged and shipped. Five to eight lines a new entry, each one sentence.
 *
 * Mobile opens the newest entry by itself once after an update
 * (`apps/mobile/lib/whats-new.ts`), and a phone remembers how many lines it
 * showed ({@link releaseNoteVersion}). Dates are unique, so **a second release
 * on the same day appends lines to that day's entry, even past eight, and
 * never trims or merges the ones already there**: phones show it again only
 * when it has more lines than they saw. Rewording a line is fine but isn't
 * news, so it shows nothing. Deploy production warns when a release ships with
 * neither a new entry nor new lines, or when the day's entry got shorter
 * (`scripts/ci/release-notes-freshness.mjs`, which reads this file as text at
 * the deployed commit, so keep `date:` and `changes: [...]` literal, one
 * string per line).
 */
export type ReleaseNote = {
  /** The day it reached members, as `YYYY-MM-DD`. */
  readonly date: string;
  /** One short line that names the batch. */
  readonly title: string;
  readonly changes: readonly string[];
};

export const RELEASE_NOTES: readonly ReleaseNote[] = Object.freeze([
  {
    date: "2026-11-09",
    title: "Easier check-in, live unread counts, and what's new on your phone",
    changes: [
      "On your phone, what's new now opens on its own once after an update, so you don't have to go looking for it.",
      "Check-in opens 10 minutes before an event starts and then shows you're in, with your points, and hosts get Host check-in right on the event.",
      "Unread counts and your Messages list stay in step across your phone and computer, the app catches up the moment you come back to it, and reading a chat clears its notifications.",
      "You can post in the channels your chapter brought over from Discord, unless they were read-only there.",
      "Edit and Reply open the keyboard straight away, with room for a long message, and closing a sheet you opened from another sheet takes you back to the first.",
      "Handing over the presidency no longer locks the old president out, and changing roles asks first if it would take away someone's access.",
      "Only officers who can do something about it are pinged when someone new joins, and Add to calendar is gone until calendar sync arrives.",
      "On the web, an invite sent to your email shows up when you sign in, ready to join in one tap, and signing in with Google or Apple tells you if it just made a new account.",
      "On the web, Chat in the menu lights up as soon as a new message arrives, whatever page you're on, and getting back to your channel list is easier: a bigger back button, Esc, or your browser's Back.",
    ],
  },
  {
    date: "2026-11-07",
    title: "Faster photos, a new message menu, and calmer notifications",
    changes: [
      "Photos send right away. Pick several at once, watch them go out, and they load faster the next time you scroll past.",
      "Press and hold a message for a new menu: react with any emoji, mention the person, copy the text, or report and block.",
      "Tap someone's name or photo in a chat to open their profile, and profile photos now show up across the app.",
      "Notifications from the same chat stack together and go away once you've read the chat.",
      "Unread counts are more accurate, and messages that mention you stand out. You can also @ a whole role.",
      "The chat home is cleaner: one line per channel, with direct messages one tap away.",
      "You can swipe back from any screen, and officers can edit or delete an event from their phone.",
      "New members get a short tour and are asked for their name and photo when they join.",
    ],
  },
]);

/**
 * Which version of an entry a phone has shown: its date and how many lines it
 * had, as `date#lines`. Lines appended later (a second release the same day)
 * make a newer version; rewording one doesn't.
 */
export function releaseNoteVersion(note: ReleaseNote): string {
  return `${note.date}#${note.changes.length}`;
}

export interface ReleaseNoteVersion {
  readonly date: string;
  readonly lines: number;
}

/** A stored {@link releaseNoteVersion}, read back. An unreadable count is 0. */
export function parseReleaseNoteVersion(version: string): ReleaseNoteVersion {
  const [date = "", lines = ""] = version.split("#");
  const count = Number.parseInt(lines, 10);
  return { date, lines: Number.isFinite(count) ? count : 0 };
}

/**
 * Whether `candidate` is news to someone who has seen `seen`: a later day, or
 * the same day with more lines.
 */
export function isNewerReleaseNoteVersion(
  candidate: ReleaseNoteVersion,
  seen: ReleaseNoteVersion,
): boolean {
  return (
    candidate.date > seen.date ||
    (candidate.date === seen.date && candidate.lines > seen.lines)
  );
}

const MONTHS = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
] as const;

/**
 * `"2026-11-07"` → `"November 7, 2026"`. Written out per the product's date
 * rule (no "Nov 7"), and computed from the string itself so it reads the same
 * day in every time zone and on every JavaScript engine.
 */
export function formatReleaseNoteDate(date: string): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
  const month = match ? MONTHS[Number(match[2]) - 1] : undefined;
  if (!match || !month) return date;
  return `${month} ${Number(match[3])}, ${match[1]}`;
}

/**
 * A plain-text block for a text message, group chat, TestFlight's "What to
 * Test", or Play's release notes: the title, then one dash line per change.
 */
export function releaseNoteText(note: ReleaseNote): string {
  return [
    `What's new in Frapp (${formatReleaseNoteDate(note.date)})`,
    "",
    note.title,
    "",
    ...note.changes.map((change) => `- ${change}`),
  ].join("\n");
}
