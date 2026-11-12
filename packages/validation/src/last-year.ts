/**
 * "This time last year" (#3930, `spec/behavior/ai.md` § This time last year):
 * the words an officer reads on a suggestion drawn from last year's record,
 * shared so web and mobile say the same thing.
 *
 * The tone is the feature (the owner's words, 2026-11-09): say what happened
 * last year, say it isn't on this year's record, and invite correction.
 * Never an assertion that something is missing, never an instruction.
 */
export const LAST_YEAR_COPY = {
  heading: "This time last year",
  /** Under the heading, once, above the rows. */
  intro:
    "The chapter did these around now last year, and I don’t see them this year. Correct me if I’m wrong.",
  /** Opens the ordinary event form, filled in from last year's event. */
  addEvent: "Add to calendar",
  /** One tap: the chapter is already on it. Dismisses the suggestion. */
  alreadyDoing: "Already planned",
  /** Not happening, or not useful. Dismisses the suggestion. */
  dismiss: "Not this year",
  eventAdded: "Added to the calendar",
  /** Last year's event could not be read to fill the form in. */
  openFailed:
    "Couldn’t open last year’s event. It may have been deleted. Try again in a moment.",
  /** The phone's one row on Events, leading to the list. */
  waiting: (count: number) =>
    count === 1
      ? "1 event from this time last year"
      : `${count} events from this time last year`,
} as const;

/**
 * The line under a suggested event's name. `day` is last year's date as the
 * reader's app writes dates, in full ("April 13, 2026").
 */
export function lastYearEventLine(day: string, times: number): string {
  return times > 1
    ? `Held ${times} times around now last year, starting ${day}. I don’t see it on this year’s calendar.`
    : `Held on ${day}. I don’t see it on this year’s calendar.`;
}

/** The line over a suggested task drawn from last year's task. */
export function lastYearTaskLine(day: string): string {
  return `This time last year: done by ${day}. I don’t see it on this year’s board. Correct me if it’s already handled.`;
}
