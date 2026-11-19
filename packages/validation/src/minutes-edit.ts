import { agendaMatterKey, type EventAgendaItem } from "./event-agenda";
import {
  MEETING_TABLED_MAX_TIMES,
  MEETING_VOTE_MAX,
  readMeetingContent,
  type MeetingActionItem,
  type MeetingContent,
  type MeetingDateItem,
  type MeetingDecision,
  type MeetingTabledItem,
  type MeetingType,
} from "./meetings";

/**
 * The minutes' section editor, shared by the web's page
 * (`apps/web/components/meetings/minutes-page.tsx`) and the phone's
 * (`apps/mobile/components/minutes/minutes-editor.tsx`, #4412), so the two
 * clean, compare and word a save the same way and never feel like two
 * systems (Paul, 2026-11-19).
 */

/**
 * How long typing rests before a draft saves itself, the way Google Docs and
 * Notion save (Paul, 2026-11-16: no Save button to chase): the section
 * editor's wait on both apps, and the phone's Summary note's.
 */
export const MINUTES_AUTOSAVE_MS = 1200;

/** What the editor holds: the minutes' type and their words. */
export type MinutesEditDraft = {
  meeting_type: MeetingType;
  other_label: string;
  content: MeetingContent;
};

/** Stored minutes as the editor holds them. */
export function minutesEditDraftOf(meeting: {
  meeting_type: string;
  other_label: string | null;
  content: unknown;
}): MinutesEditDraft {
  return {
    meeting_type: meeting.meeting_type as MeetingType,
    other_label: meeting.other_label ?? "",
    content: readMeetingContent(meeting.content),
  };
}

/** What a save sends: blank rows dropped and text trimmed at the ends. */
export function cleanMeetingContent(content: MeetingContent): MeetingContent {
  return {
    ...content,
    decisions: content.decisions
      .map((decision) => ({
        ...decision,
        text: decision.text.trim(),
        headline: decision.headline?.trim() || null,
      }))
      .filter((decision) => decision.text.length > 0),
    dates: content.dates
      .map((item) => ({ ...item, text: item.text.trim() }))
      .filter((item) => item.text.length > 0 && item.date.length > 0),
    action_items: content.action_items
      .map((item) => ({ ...item, text: item.text.trim() }))
      .filter((item) => item.text.length > 0),
    tabled: content.tabled
      .map((item) => ({ ...item, text: item.text.trim() }))
      .filter((item) => item.text.length > 0),
  };
}

/**
 * A draft as a save would store it: blank rows gone, ends trimmed. Two
 * drafts that only differ in a trailing space are the same, so a pause
 * after typing a space saves nothing and nothing typed is trimmed away.
 */
export function minutesStoredForm(draft: MinutesEditDraft): string {
  const content = cleanMeetingContent(draft.content);
  const text = Object.fromEntries(
    Object.entries(content).map(([key, value]) => [
      key,
      typeof value === "string" ? value.trim() : value,
    ]),
  );
  return JSON.stringify({
    meeting_type: draft.meeting_type,
    other_label: draft.meeting_type === "other" ? draft.other_label.trim() : "",
    content: text,
  });
}

/** Whether two drafts would store the same minutes. */
export function sameMinutesDraft(
  a: MinutesEditDraft,
  b: MinutesEditDraft,
): boolean {
  return minutesStoredForm(a) === minutesStoredForm(b);
}

/**
 * Whether a Coming up row has words and no day. A save drops it (Coming up
 * is days), so Done and Post stop and say so rather than lose it.
 */
export function minutesDatesMissingDay(content: MeetingContent): boolean {
  return content.dates.some(
    (item) => item.text.trim().length > 0 && item.date.length === 0,
  );
}

/**
 * The agenda items the Tabled section offers as one-tap chips (#5534): each
 * with words that isn't tabled already.
 */
export function minutesTablingOffers(
  agenda: readonly EventAgendaItem[],
  tabled: readonly MeetingTabledItem[],
): EventAgendaItem[] {
  const tabledWords = new Set(tabled.map((item) => agendaMatterKey(item.text)));
  return agenda.filter(
    (item) =>
      item.text.trim().length > 0 &&
      !tabledWords.has(agendaMatterKey(item.text)),
  );
}

/**
 * The Tabled row a chip adds. One carried from an earlier Tabled list keeps
 * its first meeting and counts once more.
 */
export function tabledRowFromAgenda(item: EventAgendaItem): MeetingTabledItem {
  const from = item.tabled_from;
  return {
    text: item.text,
    first_meeting_id: from?.meeting_id ?? null,
    first_start_time: from?.start_time ?? null,
    times: from ? Math.min(from.times + 1, MEETING_TABLED_MAX_TIMES) : 1,
  };
}

/** A vote count as typed: a whole number from 0 to the most a chapter seats. */
export function clampMeetingVote(value: string): number {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed) || parsed < 0) return 0;
  return Math.min(parsed, MEETING_VOTE_MAX);
}

/** The empty row each list's Add button puts at its foot. */
export const BLANK_MINUTES_ROW = {
  decision: (): MeetingDecision => ({ text: "", vote: null }),
  actionItem: (): MeetingActionItem => ({
    text: "",
    owner_user_id: null,
    due_date: null,
  }),
  date: (): MeetingDateItem => ({ date: "", text: "" }),
  tabled: (): MeetingTabledItem => ({
    text: "",
    first_meeting_id: null,
    first_start_time: null,
    times: 1,
  }),
} as const;

/** The editor's words, the same on the web and the phone. */
export const MINUTES_EDITOR_COPY = {
  saving: "Saving…",
  saved: "Saved",
  notSaved: "Not saved",
  save: "Save",
  cancel: "Cancel",
  done: "Done",
  saveFailedTitle: "Couldn't save the minutes",
  loadFailed: "Couldn't load their version",
  loadFailedBody: "Check your connection and try again.",
  savedToast: "Minutes saved",
  discardTitle: "Discard your changes?",
  discardBody: "What you changed in these minutes isn't saved.",
  discard: "Discard",
  keepEditing: "Keep editing",
  /** A draft's line from the officer's own notes, when no note-taker is named. */
  fromYourNotes: "From your notes",
  decision: {
    label: (n: number) => `Decision ${n}`,
    placeholder: "What was decided",
    remove: (n: number) => `Remove decision ${n}`,
    add: "Add a decision",
    addVote: "Add a vote count",
    removeVote: "Remove the count",
    for: "For",
    against: "Against",
    abstain: "Abstaining",
  },
  actionItem: {
    label: (n: number) => `Action item ${n}`,
    placeholder: "What needs doing",
    remove: (n: number) => `Remove action item ${n}`,
    add: "Add an action item",
    who: "Who",
    nobody: "Nobody named",
    due: "Due",
    noDue: "No date",
    addDue: "Add a due date",
    removeDue: "Remove the due date",
  },
  tabled: {
    label: (n: number) => `Tabled item ${n}`,
    placeholder: "What was put off",
    remove: (n: number) => `Remove tabled item ${n}`,
    add: "Table an item",
    fromAgenda: "From the agenda:",
    tableItem: (text: string) => `Table ${text}`,
  },
  date: {
    pick: "Pick a day",
  },
} as const;
