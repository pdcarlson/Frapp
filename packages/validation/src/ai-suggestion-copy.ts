/**
 * The words around suggested tasks (#4313, `spec/behavior/meetings.md`
 * § Suggested tasks), shared by web and mobile.
 */
export const AI_SUGGESTION_COPY = {
  heading: "Suggested tasks",
  fromActionItems:
    "From the action items above. Nothing is a task until you accept it.",
  fromMinutesOf: "From the minutes of",
  aMeeting: "a meeting",
  meetingFallback: "Meeting minutes",
  accept: "Accept",
  dismiss: "Dismiss",
  change: "Change before accepting",
  accepting: "Accepting…",
  acceptAll: (count: number) => `Accept all ${count}`,
  acceptReady: (count: number) =>
    `Accept the ${count} with an assignee and a due date`,
  who: "Who?",
  missingWho: "Pick who this is for.",
  created: "Task created",
  createdCount: (count: number) =>
    count === 1 ? "1 task created" : `${count} tasks created`,
  stillListed: (count: number) =>
    `${count} couldn't be accepted and ${count === 1 ? "is" : "are"} still listed.`,
  acceptFailed: "Couldn't accept the suggestion",
  acceptAllFailed: "Couldn't accept the suggestions",
  dismissFailed: "Couldn't dismiss the suggestion",
  tryAgain: "Try again in a moment.",
  /** The phone's one row on Tasks, and the title of the list it opens. */
  waiting: (count: number) =>
    count === 1 ? "1 suggested task" : `${count} suggested tasks`,
  empty: "Nothing is waiting. Suggested tasks show here after minutes are posted.",
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
