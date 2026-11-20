/**
 * The welcome card: what a new member sees once in the chapter's default
 * channel, right after joining (#5627; Paul's pick 2026-11-19, "welcome
 * card, no tour"). It replaced the first-run tours on web and the phone.
 *
 * The card greets them by first name, lists what's next (the chapter's next
 * two events, dates written out), and offers **Finish your profile**: the
 * photo, the roles they can join and the chat display, which onboarding used
 * to ask up front and now holds here. The same card on web and the phone.
 */

export const WELCOME_CARD_COPY = {
  /** The heading over the next events. */
  comingUp: "Coming up",
  finishProfile: "Finish your profile",
  finishProfileHint: "2 minutes",
  close: "Close the welcome card",
  /** The Finish your profile sheet or dialog. */
  sheetTitle: "Finish your profile",
  sheetLede: "Your photo, the roles you're in and how chat looks to you.",
  photo: "Photo",
  roles: "Your roles",
  display: "Chat display",
  done: "Done",
} as const;

/** "Welcome to Phi Gamma Delta, Paul", or without the comma when unnamed. */
export function welcomeCardTitle(
  chapterName: string | null | undefined,
  displayName: string | null | undefined,
): string {
  const chapter = (chapterName ?? "").trim() || "your chapter";
  const first = (displayName ?? "").trim().split(/\s+/)[0] ?? "";
  return first ? `Welcome to ${chapter}, ${first}` : `Welcome to ${chapter}`;
}

export type WelcomeCardEventInput = {
  id: string;
  name: string;
  start_time: string;
  end_time?: string | null;
};

const MS_PER_DAY = 24 * 60 * 60 * 1000;

function startOfDay(date: Date): number {
  return new Date(
    date.getFullYear(),
    date.getMonth(),
    date.getDate(),
  ).getTime();
}

/**
 * When an event starts, written out: `Today, 7:00 PM`, `Tomorrow, 7:00 PM`,
 * `Sunday, 7:00 PM` within the week, then `Saturday, November 22` (with the
 * year when it isn't this one). No numeric dates (Paul's UI rules).
 */
export function welcomeCardEventWhen(startIso: string, now: Date): string {
  const start = new Date(startIso);
  if (Number.isNaN(start.getTime())) return "";
  const days = Math.round((startOfDay(start) - startOfDay(now)) / MS_PER_DAY);
  const time = start.toLocaleTimeString("en-US", {
    hour: "numeric",
    minute: "2-digit",
  });
  if (days <= 0) return `Today, ${time}`;
  if (days === 1) return `Tomorrow, ${time}`;
  if (days < 7) {
    return `${start.toLocaleDateString("en-US", { weekday: "long" })}, ${time}`;
  }
  return start.toLocaleDateString("en-US", {
    weekday: "long",
    month: "long",
    day: "numeric",
    ...(start.getFullYear() === now.getFullYear() ? {} : { year: "numeric" }),
  });
}

/**
 * The chapter's next events, soonest first: one still running counts, one
 * that ended doesn't. At most `limit`, two on the card.
 */
export function welcomeCardEvents<T extends WelcomeCardEventInput>(
  events: readonly T[] | null | undefined,
  now: Date,
  limit = 2,
): T[] {
  const at = now.getTime();
  return (events ?? [])
    .filter((event) => {
      const start = Date.parse(event.start_time);
      if (Number.isNaN(start)) return false;
      const end = event.end_time ? Date.parse(event.end_time) : start;
      return (Number.isNaN(end) ? start : end) >= at;
    })
    .sort((a, b) => Date.parse(a.start_time) - Date.parse(b.start_time))
    .slice(0, limit);
}
