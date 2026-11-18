/**
 * The words around suggested tasks (#4313, `spec/behavior/meetings.md`
 * § Suggested tasks), shared by web and mobile.
 */
export const AI_SUGGESTION_COPY = {
  heading: "Suggested tasks",
  /**
   * The phone's one list of everything waiting: suggested tasks and, since
   * #3930, events from this time last year.
   */
  listHeading: "Suggested",
  fromActionItems:
    "From the action items. Nothing is a task until you create it.",
  fromMinutesOf: "From the minutes of",
  aMeeting: "a meeting",
  meetingFallback: "Meeting minutes",
  /**
   * The button that makes the task for whoever it names. "Accept" read as
   * taking the task on yourself (Paul, 2026-11-18: "accept looks like a way
   * for me to say, oh, this is mine"), so it says what it does.
   */
  accept: "Create task",
  dismiss: "Dismiss",
  change: "Change before creating",
  accepting: "Creating…",
  acceptAll: (count: number) => `Create all ${count}`,
  acceptReady: (count: number) => `Create the ${count} that say who and when`,
  /** Where the officer is in the list, one suggestion at a time. */
  position: (at: number, of: number) => `${at} of ${of}`,
  previous: "Previous suggestion",
  next: "Next suggestion",
  /** Who or when filled in by Frapp rather than said in the meeting. */
  suggestedWho: "Suggested from the minutes",
  suggestedDue: "Suggested: a week after the meeting",
  who: "Who?",
  missingWho: "Pick who this is for.",
  created: "Task created",
  createdCount: (count: number) =>
    count === 1 ? "1 task created" : `${count} tasks created`,
  stillListed: (count: number) =>
    `${count} couldn't be created and ${count === 1 ? "is" : "are"} still listed.`,
  acceptFailed: "Couldn't create the task",
  acceptAllFailed: "Couldn't create the tasks",
  dismissFailed: "Couldn't dismiss the suggestion",
  tryAgain: "Try again in a moment.",
  /** The phone's one row on Tasks, and the title of the list it opens. */
  waiting: (count: number) =>
    count === 1 ? "1 suggested task" : `${count} suggested tasks`,
  empty:
    "Nothing is waiting. Suggested tasks show here after minutes are posted.",
  loadFailedTitle: "Couldn't load suggested tasks",
  loadFailedBody: "Check your connection and try again.",
} as const;

/** Why an accept or dismiss was refused, in words an officer can act on. */
const REFUSALS: Record<string, string> = {
  "ai.suggestion.decided": "Another officer already decided this one.",
  "ai.suggestion.expired": "This suggestion expired.",
  "ai.suggestion.accepting": "Another officer is accepting this one right now.",
  "ai.suggestion.not_found":
    "This suggestion is gone. What it came from changed.",
};

/** The line for a refusal code, or null for one this build has no words for. */
export function aiSuggestionRefusalLine(
  code: string | null | undefined,
): string | null {
  return REFUSALS[code ?? ""] ?? null;
}
