import {
  MEETING_SECTIONS,
  meetingTypeLabel,
  type MeetingSectionKey,
  type MeetingType,
  type MeetingVote,
} from "./meetings";

/**
 * Words the minutes screens share, on web and on the phone, so the two never
 * describe the same minutes differently. Dates are written out in full (Paul,
 * 2026-11-07: never "Tue" or "Nov 11"), with the year only when it isn't
 * this one.
 */

export function meetingDayLabel(
  value: string | null | undefined,
  now: Date = new Date(),
): string {
  if (!value) return "";
  const at = new Date(value);
  if (Number.isNaN(at.getTime())) return "";
  return at.toLocaleDateString(undefined, {
    weekday: "long",
    month: "long",
    day: "numeric",
    ...(at.getFullYear() === now.getFullYear() ? {} : { year: "numeric" }),
  });
}

/** "Tuesday, November 10 at 11:21 PM": when a meeting started, written out. */
export function meetingWhenLabel(
  value: string | null | undefined,
  now: Date = new Date(),
): string {
  const day = meetingDayLabel(value, now);
  if (!day || !value) return day;
  const time = new Date(value).toLocaleTimeString(undefined, {
    hour: "numeric",
    minute: "2-digit",
  });
  return `${day} at ${time}`;
}

/** A due day stored as `YYYY-MM-DD`, read in the reader's own calendar. */
export function meetingDueLabel(
  value: string | null | undefined,
  now: Date = new Date(),
): string {
  if (!value) return "";
  const [year, month, day] = value.split("-").map(Number);
  if (!year || !month || !day) return "";
  return meetingDayLabel(new Date(year, month - 1, day, 12).toISOString(), now);
}

export function meetingTitleLine(meeting: {
  meeting_type: string;
  other_label?: string | null;
  event_start_time: string;
}): string {
  const type = meetingTypeLabel(
    meeting.meeting_type as MeetingType,
    meeting.other_label,
  );
  return `${type} · ${meetingDayLabel(meeting.event_start_time)}`;
}

export function meetingSectionLabel(key: MeetingSectionKey): string {
  return MEETING_SECTIONS.find((section) => section.key === key)?.label ?? key;
}

/** "30 for, 2 against, 1 abstaining", only the counts the meeting recorded. */
export function meetingVoteLine(vote: MeetingVote | null): string {
  if (!vote) return "";
  return `${vote.for} for, ${vote.against} against, ${vote.abstain} abstaining`;
}

/**
 * The type an event's name suggests, so "Exec meeting" opens on Exec. Only a
 * starting point; the officer picks.
 */
export function guessMeetingType(eventName: string): MeetingType {
  const name = eventName.toLowerCase();
  if (/\bexec|executive|e-board|eboard|officer/.test(name)) return "exec";
  if (/committee|\bchair/.test(name)) return "committee";
  return "chapter";
}

/** `2026-11-09` for the calendar day `value` falls on where the reader is. */
export function meetingLocalDay(value: string): string {
  const date = new Date(value);
  const pad = (part: number) => String(part).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

/** The event's way into its minutes: one row, on the event sheet and screen. */
export const MEETING_ENTRY_COPY = {
  label: "Minutes",
  checking: "Checking",
  none: "Nobody has written them yet",
  draft: "A draft, not posted yet",
  posted: "Posted",
  open: "Open minutes",
  write: "Write minutes",
  alreadyStartedTitle: "These minutes are already started",
  alreadyStartedBody:
    "Someone else started minutes for this meeting. They show here once they are posted.",
  startFailed: "Couldn't start the minutes",
} as const;

/** The list of a chapter's minutes. */
export const MEETING_LIST_COPY = {
  title: "Minutes",
  drafts: "Drafts",
  posted: "Minutes",
  none: "Minutes show here once a secretary posts them.",
  loadFailedTitle: "Couldn't load the minutes",
  loadFailedBody: "Check your connection and try again.",
  /** A draft that isn't the reader's own names whose it is. */
  draftOf: (name: string) => `${name}'s draft`,
  /** Present, Late and Excused: who checked in to the meeting's event. */
  present: "Present",
  late: "Late",
  excused: "Excused",
} as const;

/** Reading and posting minutes. */
export const MEETING_COPY = {
  missingTitle: "These minutes aren't here",
  missingBody: "They were deleted, or they aren't shared with you.",
  loadFailedTitle: "Couldn't load the minutes",
  loadFailedBody: "Check your connection and try again.",
  nothingWritten: "Nothing has been written in these minutes yet.",
  draftBadge: "Draft",
  posted: (day: string) => `Posted ${day}`,
  attendeesGone: "The event is gone, so its check-ins are too.",
  attendeesNone:
    "Nobody has checked in yet. Who checked in to the event shows here.",
  postConfirmTitle: "Post these minutes?",
  postConfirmBody:
    "Everyone the meeting's event invites can read them, and each of them is told once. You can still edit them after.",
  post: "Post minutes",
  posted_toast: "Minutes posted",
  postFailed: "Couldn't post the minutes",
  stale:
    "Someone else saved these minutes since you opened them. Copy anything you want to keep, then load their version.",
  loadTheirs: "Load their version",
  tryAgain: "Try again in a moment.",
  /**
   * The phone reads minutes, drafts them from notes and posts them. Changing
   * a section's wording by hand is on the web for now.
   */
  editOnWeb: "To change the wording, open these minutes on the web.",
  writeOnWeb: "Open these minutes on the web to write them.",
  suggestedTasks: "Suggested tasks",
} as const;

/** Drafting minutes from an officer's notes (`meetings.md` § Drafting from notes). */
export const MEETING_NOTES_COPY = {
  heading: "Your notes",
  hint: "Rough is fine. The draft keeps only what your notes say, and lists what they leave out.",
  placeholder: "Paste or type what you wrote down during the meeting.",
  draft: "Draft minutes",
  draftAgain: "Draft again",
  stop: "Stop",
  useDraft: "Use the draft",
  clear: "Clear notes",
  empty: "Paste or type your notes first.",
  tooLong: (max: number, length: number) =>
    `Notes can be up to ${max.toLocaleString("en-US")} characters, and these are ${length.toLocaleString("en-US")}. Shorten them, or draft the meeting in two parts.`,
  consentCheckFailed: "Couldn't check your AI choice. Try again in a moment.",
  startFailed:
    "Couldn't start the draft. Your notes are still in the box, so try again.",
  stopFailed: "Couldn't stop the draft. Try again.",
  clearFailed: "Couldn't clear the notes. Try again.",
  useFailed: "Couldn't use the draft. Try again.",
  replaceTitle: "Replace what's written?",
  replaceBodyDraft:
    "The draft replaces the sections below with what it finds in your notes. Who checked in stays as it is.",
  replaceBodyUse:
    "The draft replaces the sections below with what it found in your notes. Who checked in stays as it is.",
  clearTitle: "Clear your notes?",
  clearBody:
    "The notes are removed for good. What is written in the minutes below stays.",
  /** Web, where clearing the notes also removes an uploaded recording. */
  clearBodyRecording:
    "The notes, the recording and its transcript are removed for good. What is written in the minutes below stays.",
  drafting: "Drafting minutes from your notes",
  waiting:
    "The minutes changed while the draft was being written, so it wasn't put in.",
  applied: "Drafted from your notes. Read it through before you post.",
  idle: "Your notes go to an AI provider to write the draft. Nothing is posted until you post it.",
  toFillIn: "To fill in",
  leftOut: (count: number) =>
    count === 1
      ? "One drafted line was left out because nothing in your notes backed it."
      : `${count} drafted lines were left out because nothing in your notes backed them.`,
} as const;
