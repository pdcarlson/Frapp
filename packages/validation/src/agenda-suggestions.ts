import type { EventAgendaTabledFrom } from "./event-agenda";
import { meetingDayLabel, meetingTabledFromLabel } from "./meeting-copy";

/**
 * Suggested agenda items (#5534, `spec/behavior/events.md` § Suggested
 * agenda items): what an upcoming meeting's agenda may want, offered under
 * the agenda to whoever can edit the event, each with Add and Dismiss.
 *
 * - `tabled`: a matter earlier posted minutes of a meeting with the same
 *   audience tabled, and no later agenda has taken up. Always first.
 * - `minutes`: a suggested task from earlier posted minutes of a meeting
 *   with the same audience that an officer sent to the next meeting's agenda
 *   instead of making it a task (#5790). Listed with the tabled matters.
 * - `ai`: an item a small model wrote from recent same-audience minutes and
 *   the event's context.
 */
export const AGENDA_SUGGESTION_KINDS = ["tabled", "minutes", "ai"] as const;
export type AgendaSuggestionKind = (typeof AGENDA_SUGGESTION_KINDS)[number];

/** The most items the model may suggest for one event. */
export const AGENDA_SUGGESTIONS_AI_MAX = 5;
/** The most tabled matters offered for one event. */
export const AGENDA_SUGGESTIONS_TABLED_MAX = 10;

/** One suggestion, as both apps draw it. */
export interface AgendaSuggestion {
  id: string;
  kind: AgendaSuggestionKind;
  text: string;
  /** Where a tabled matter came from; null for any other kind. */
  tabled_from: EventAgendaTabledFrom | null;
  /**
   * The minutes a `minutes` item was sent from, for "From the minutes of
   * {day}"; null for any other kind.
   */
  from_minutes: AgendaSuggestionFromMinutes | null;
  /**
   * The posted minutes it was drawn from, for the link under it: for a
   * tabled matter the minutes that tabled it most recently.
   */
  source_meeting_id: string | null;
  /** Why the model suggested it, in a few words; null for a tabled one. */
  reason: string | null;
}

/** The posted minutes a `minutes` suggestion was sent from. */
export interface AgendaSuggestionFromMinutes {
  meeting_id: string;
  /** When that meeting started. */
  start_time: string;
}

/** The Suggested list for one event. */
export interface AgendaSuggestionList {
  suggestions: AgendaSuggestion[];
  /**
   * When the model last wrote suggestions for this event, or null when it
   * never has (the clients then ask for them once).
   */
  generated_at: string | null;
  /**
   * Whether the model can write suggestions for this member here: AI on,
   * the chapter's meeting-notes switch on and the member's own yes. Tabled
   * matters are listed either way.
   */
  ai_available: boolean;
}

/**
 * "Tabled from Tuesday, November 11 · 2nd time" for an agenda item or a
 * suggestion: the first meeting that tabled it, and how many have.
 */
export function agendaTabledFromLabel(
  from: EventAgendaTabledFrom,
  now: Date = new Date(),
): string {
  return meetingTabledFromLabel(
    { first_start_time: from.start_time, times: from.times },
    now,
  );
}

/**
 * "From the minutes of Tuesday, November 11" under a suggestion an officer
 * sent from those minutes' suggested tasks (#5790).
 */
export function agendaFromMinutesLabel(
  from: AgendaSuggestionFromMinutes,
  now: Date = new Date(),
): string {
  const day = meetingDayLabel(from.start_time, now);
  return day ? `From the minutes of ${day}` : "From earlier minutes";
}

/** The words both apps use for the Suggested section. */
export const AGENDA_SUGGESTION_COPY = {
  heading: "Suggested",
  add: "Add",
  dismiss: "Dismiss",
  refresh: "Suggest again",
  writing: "Writing suggestions…",
  refreshFailed: "Couldn't write new suggestions. Try again in a minute.",
  addFailed: "Couldn't add that to the agenda. Try again in a moment.",
  dismissFailed: "Couldn't dismiss that suggestion. Try again in a moment.",
  full: (max: number) =>
    `The agenda is full (${max} items). Remove one to add a suggestion.`,
  addLabel: (text: string) => `Add "${text}" to the agenda`,
  dismissLabel: (text: string) => `Dismiss "${text}"`,
} as const;
