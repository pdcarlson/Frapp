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
 * is merged and shipped. Five to eight lines an entry, each one sentence.
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
      "Check-in opens 10 minutes before an event starts, and once you're checked in the event says so, with your points.",
      "Hosts get Host check-in right on the event, and a second scan just tells you you're already in.",
      "Unread counts and your Messages list stay in step across your phone and computer, and the app catches up the moment you come back to it.",
      "You can post in the channels your chapter brought over from Discord, unless they were read-only there.",
      "Edit and Reply open the keyboard straight away, and a long message has room while you edit it.",
      "Handing over the presidency no longer locks the old president out, and changing roles asks first if it would take away someone's access.",
      "Only officers who can do something about it are pinged when someone new joins, and Add to calendar is gone until calendar sync arrives.",
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
