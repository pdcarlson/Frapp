import { meetingDayLabel } from "./meeting-copy";

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
  /**
   * A task made from minutes names them by the meeting's id (#5562), so the
   * task screens read its name as it is now: "Minutes" over the meeting's
   * name, a link to them, on the web's panel and the phone's task screen
   * alike ("From" already names who assigned it). Shown only to someone who
   * may read those minutes.
   */
  taskMinutes: "Minutes",
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
  /**
   * The card's ⋯ menu: Change before creating, Add to next meeting's agenda,
   * Dismiss, Report this.
   */
  more: "More",
  /**
   * Instead of a task, the action item goes onto the agenda of the next
   * meeting with the same people (#5790; Shawn, 2026-11-20).
   */
  toAgenda: "Add to next meeting's agenda",
  /** What happened, said in the toast (web) or above the list (phone). */
  toAgendaPlaced: (meeting: string) => `Added to ${meeting}`,
  toAgendaPlacedNext: "Added to the next meeting's agenda",
  toAgendaOffered: (meeting: string) => `Suggested on ${meeting}`,
  toAgendaOfferedNext: "Suggested on the next meeting",
  toAgendaOfferedBody: "It's under Suggested there, for an officer to add.",
  toAgendaWaiting: (name: string) =>
    `Will be added to the next ${name} when it's scheduled`,
  toAgendaWaitingBody: "If none is scheduled in 30 days, it's dropped.",
  toAgendaOpen: "Open",
  undo: "Undo",
  undone: "Put back in suggested tasks",
  undoFailed: "Couldn't undo that",
  toAgendaFailed: "Couldn't send that to the next meeting's agenda",
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
  /** The due chip while no day is set. */
  when: "When?",
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
  "ai.suggestion.not_handled_here":
    "These minutes' meeting was deleted, so there's no next meeting to add it to.",
};

/** The line for a refusal code, or null for one this build has no words for. */
export function aiSuggestionRefusalLine(
  code: string | null | undefined,
): string | null {
  return REFUSALS[code ?? ""] ?? null;
}

/** Where Add to next meeting's agenda put an item (#5790). */
export const NEXT_AGENDA_OUTCOMES = ["placed", "offered", "waiting"] as const;
export type NextAgendaOutcomeKind = (typeof NEXT_AGENDA_OUTCOMES)[number];

/**
 * What Add to next meeting's agenda says it did (#5790), the same on web and
 * phone: "Added to Chapter Meeting, Sunday, November 22", "Suggested on …"
 * when it went under Suggested there (the officer can't edit that meeting,
 * or its agenda is full), or "Will be added to the next Chapter Meeting when
 * it's scheduled". A meeting the officer can't see is never named.
 */
export function nextAgendaOutcomeLines(
  outcome: {
    outcome: NextAgendaOutcomeKind;
    meeting: { name: string; start_time: string } | null;
    source_name: string;
  },
  now: Date = new Date(),
): { title: string; body: string | null } {
  const where = outcome.meeting
    ? [outcome.meeting.name, meetingDayLabel(outcome.meeting.start_time, now)]
        .filter(Boolean)
        .join(", ")
    : "";
  if (outcome.outcome === "placed") {
    return {
      title: where
        ? AI_SUGGESTION_COPY.toAgendaPlaced(where)
        : AI_SUGGESTION_COPY.toAgendaPlacedNext,
      body: null,
    };
  }
  if (outcome.outcome === "offered") {
    return {
      title: where
        ? AI_SUGGESTION_COPY.toAgendaOffered(where)
        : AI_SUGGESTION_COPY.toAgendaOfferedNext,
      body: AI_SUGGESTION_COPY.toAgendaOfferedBody,
    };
  }
  return {
    title: AI_SUGGESTION_COPY.toAgendaWaiting(outcome.source_name || "meeting"),
    body: AI_SUGGESTION_COPY.toAgendaWaitingBody,
  };
}
