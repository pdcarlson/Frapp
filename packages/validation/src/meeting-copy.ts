import {
  MEETING_SECTIONS,
  type MeetingSectionKey,
  type MeetingType,
  type MeetingVote,
} from "./meetings";
import { ordinal } from "./recurrence";

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

/**
 * Where a tabled matter came from (#5522): "Tabled from Tuesday, November 11
 * · 2nd time", or nothing when these minutes tabled it first.
 */
export function meetingTabledFromLabel(
  item: { first_start_time: string | null; times: number },
  now: Date = new Date(),
): string {
  const day = meetingDayLabel(item.first_start_time, now);
  const parts = [
    day ? `Tabled from ${day}` : "",
    item.times > 1 ? `${ordinal(item.times)} time` : "",
  ].filter(Boolean);
  return parts.join(" · ");
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
 * starting point; the officer picks. A name that says no type is Other with
 * no label, never Chapter: Chapter minutes read the last chapter meeting's
 * action items, so "Ben Cunningham Meeting" filed as Chapter carried fifteen
 * of them in (Paul, 2026-11-19).
 */
export function guessMeetingType(eventName: string): MeetingType {
  const name = eventName.toLowerCase();
  if (/\bexec|executive|e-board|eboard|officer/.test(name)) return "exec";
  if (/committee|\bchair/.test(name)) return "committee";
  if (/\bchapters?\b|\bgeneral (body )?meeting\b|\bgb?m\b/.test(name)) {
    return "chapter";
  }
  return "other";
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
  record: "Record minutes",
  alreadyStartedTitle: "These minutes are already started",
  alreadyStartedBody:
    "Someone else started minutes for this meeting. They show here once they are posted.",
  startFailed: "Couldn't start the minutes",
} as const;

/** The list of a chapter's minutes. */
export const MEETING_LIST_COPY = {
  title: "Minutes",
  /**
   * Meetings, tied to their events (Paul, 2026-11-19): meetings on the
   * calendar that ended with no minutes, drafts, then what was posted, with
   * the next meeting at the foot.
   */
  needsMinutes: "Needs minutes",
  startMinutes: "Start minutes",
  nextUp: "Next up",
  openEvent: "Open event",
  drafts: "In progress",
  posted: "Minutes",
  none: "Minutes show here once a secretary posts them.",
  loadFailedTitle: "Couldn't load the minutes",
  loadFailedBody: "Check your connection and try again.",
  /** A draft that isn't the reader's own names whose it is. */
  draftOf: (name: string) => `${name}'s draft`,
  /** The list's grouping and finding (#5290). */
  search: "Search minutes",
  allTypes: "All",
  types: "Meeting types",
  series: "Series",
  nothingMatches: "No minutes match.",
  newMinutes: "New minutes",
  newMinutesHint: "Records a meeting, or starts minutes to type.",
  recorded: "Recorded",
  decisions: (count: number) =>
    count === 1 ? "1 decision" : `${count} decisions`,
  actionItems: (count: number) =>
    count === 1 ? "1 action item" : `${count} action items`,
  minutesCount: (count: number) =>
    count === 1 ? "1 meeting" : `${count} meetings`,
  lastOn: (day: string) => `last ${day}`,
  /** The series screen (#5290). */
  seriesActions: "Open action items",
  seriesActionsFrom: (day: string) => `from ${day}`,
  seriesActionsNone: "Nothing open from these meetings.",
  noOwner: "Nobody named",
  /** Present, Late and Excused: who checked in to the meeting's event. */
  present: "Present",
  late: "Late",
  excused: "Excused",
} as const;

/** Reading and posting minutes. */
export const MEETING_COPY = {
  /** The row that opens posted minutes' transcript (#5410). */
  transcript: "Transcript",
  /** Its own screen, opened for a transcript that has since gone. */
  /** Web: opens the transcript in a new tab. */
  openTranscript: "Open transcript",
  transcriptHint: "Opens the transcript on its own screen.",
  transcriptMissing: "There's no transcript for these minutes.",
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
  post: "Post minutes",
  posted_toast: "Minutes posted",
  postFailed: "Couldn't post the minutes",
  stale:
    "Someone else saved these minutes since you opened them. Copy anything you want to keep, then load their version.",
  loadTheirs: "Load their version",
  tryAgain: "Try again in a moment.",
  /**
   * Where the chapter doesn't draft minutes from notes, the phone's note is
   * the minutes' Summary (#5288); the other sections are written on the web
   * until the phone has a section editor (#4412).
   */
  summaryPlaceholder: "Type what was said and decided.",
  restOnWeb: "The TL;DR, decisions and action items are added on the web.",
  /**
   * The TL;DR's box (#5523): a draft fills it; without drafting the
   * minute-taker writes it, as they write the Summary.
   */
  tldrPlaceholder:
    "Two or three short lines for every member: the gist. Dates, decisions and action items have lists of their own.",
  /** A decision's short outcome, bold over its detail (#5562). */
  decisionHeadline: "Headline (optional)",
  decisionHeadlinePlaceholder: "The outcome in a few words",
  /** Coming up, written by hand (#5562). */
  dateDay: "Day",
  dateWhat: "What happens",
  dateWhatPlaceholder: "What happens that day",
  /** Under a Coming up row with words and no day: it is not kept without one. */
  dateNeedsDay: "Pick a day, or this line is not kept.",
  removeDate: "Remove date",
  addDate: "Add a date",
  saveFailed: "Not saved yet. It tries again as you type.",
  suggestedTasks: "Suggested tasks",
} as const;

/**
 * Marking who was at a meeting by hand, when nobody checked in (Paul,
 * 2026-11-16; `events.md` § Marking attendance by hand).
 */
export const MEETING_ATTENDANCE_COPY = {
  title: "Who was there",
  body: "This fills in the event's attendance for anyone not marked yet. Officer marks don't add points.",
  statusLabel: "Mark them as",
  find: "Find a member",
  pickEveryone: "Everyone not marked yet",
  pickShown: (count: number) => `All ${count} shown`,
  alreadyMarked: "Marked",
  save: (count: number, status: "PRESENT" | "LATE" | "EXCUSED") => {
    const as =
      status === "PRESENT" ? "present" : status === "LATE" ? "late" : "excused";
    return count === 0 ? `Mark ${as}` : `Mark ${count} ${as}`;
  },
  marked: (count: number) =>
    count === 1 ? "Marked 1 member" : `Marked ${count} members`,
  notInvited: (count: number) =>
    count === 1
      ? "1 wasn't invited to this event, so they weren't marked."
      : `${count} weren't invited to this event, so they weren't marked.`,
  failed: "Couldn't mark attendance",
} as const;

/** Drafting minutes from an officer's notes (`meetings.md` § Drafting from notes). */
export const MEETING_NOTES_COPY = {
  heading: "Your notes",
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
  idle: "Your notes go to an AI provider to write the draft. Nothing is posted until you post it.",
  toFillIn: "To fill in",
  /** Under the questions: what answering them does. */
  toFillInHint:
    "Answer what you can and the draft is written again with your answers. Leave the rest blank.",
  answerPlaceholder: "Your answer",
  updateDraft: "Update the draft",
  /** The block a set of answers adds to the officer's notes. */
  answersHeading:
    "Answers from the minutes author to the draft's open questions (these correct anything above):",
  hide: "Hide",
  leftOut: (count: number) =>
    count === 1
      ? "One drafted line was left out because nothing in your notes backed it."
      : `${count} drafted lines were left out because nothing in your notes backed them.`,
} as const;

/**
 * Several members taking notes on one meeting (`meetings.md` § Several
 * note-takers, #4935). Web and phone say the same words.
 */
export const MEETING_NOTE_TAKERS_COPY = {
  heading: "Notes for this meeting",
  /** The author's draft button once anyone else's notes or a transcript are in. */
  draftAll: "Draft from all notes",
  draftingAll: "Drafting minutes from everyone's notes",
  saved: "Saved",
  saving: "Saving…",
  saveFailed: "Couldn't save your notes. Keep this page open and try again.",
  read: "Read",
  hide: "Hide",
  remove: "Remove",
  removeTitle: (name: string) => `Remove ${name} as a note-taker?`,
  removeBody:
    "Their notes are deleted, and so is a draft written from them. What is in the minutes stays.",
  add: "Add a note-taker",
  addLabel: "Member",
  addPlaceholder: "Pick a member",
  addHint:
    "Anyone invited to this meeting can take notes. They're told, and their notes go into the draft.",
  addFailed: "Couldn't add them. Try again.",
  notInAudience:
    "They aren't invited to this meeting, so they can't take notes on it.",
  author: "Author",
  you: "You",
  added: "Added",
  noNotesYet: "Nothing written yet",
  lines: (count: number) => (count === 1 ? "1 line" : `${count} lines`),
  recording: "Recording",
  /** How the phone sheet names the transcript among what a draft reads. */
  recordingSource: "the recording",
  /** The phone's one line saying what else the draft reads. */
  alsoReads: (sources: readonly string[]) =>
    `The draft also reads ${sources.length === 1 ? sources[0] : `${sources.slice(0, -1).join(", ")} and ${sources[sources.length - 1]}`}.`,
  recordingWhat: (speakers: number | null) =>
    speakers && speakers > 1
      ? `Transcript, ${speakers} speakers`
      : "Transcript",
  heldConsent: "Left out until they turn on Frapp AI",
  /** A note-taker's own view, on someone else's minutes. */
  takeNotes: "Take notes",
  takingNotes: "Taking notes",
  noteTakerTitle: (event: string) => `Your notes on ${event}`,
  noteTakerHint: (author: string) =>
    `Only you and ${author}, who's writing the minutes, can read these. They go into the draft with everyone else's notes.`,
  noteTakerOthers: (count: number) =>
    count === 0
      ? "Nobody else is taking notes yet."
      : count === 1
        ? "1 other person is taking notes."
        : `${count} other people are taking notes.`,
  noteTakerConsent:
    "Turn on Frapp AI so your notes go into the draft. Until then they're saved here but left out.",
  leave: "Stop taking notes",
  leaveTitle: "Stop taking notes?",
  leaveBody: "Your notes are deleted, and so is a draft written from them.",
  posted: "These minutes are posted, so notes are closed.",
  missing:
    "These notes aren't here any more, or you can't take notes on this meeting.",
  /** The Meetings page's list for a note-taker. */
  listHeading: "Taking notes",
  listItem: (author: string) => `Minutes by ${author}`,
  /** Notes disagreed (#4935). */
  disagreed: "Notes disagreed",
  settledBy: {
    recording: "Settled by the recording",
    authority: "Settled by who wrote it",
    author: "You picked",
  },
  youDecide: "You decide",
  tieBody:
    "Neither the recording nor who wrote it settles this, so it isn't in the minutes yet.",
  takeVersion: (from: string, mine = false) =>
    mine ? "Use yours instead" : `Use ${from}'s instead`,
  pickVersion: (from: string, mine = false) =>
    mine ? "Use yours" : `Use ${from}'s`,
  inMinutes: "In the minutes",
  chooseFailed: "Couldn't change it. Reload and try again.",
  from: (from: string, mine = false) =>
    mine
      ? "From your notes"
      : from === "Recording"
        ? "From the recording"
        : `From ${from}'s notes`,
  /** Linking an event (#4935). */
  noEvent:
    "These minutes aren't linked to an event, so nobody but editors can read them.",
  linkEvent: "Link an event",
  linkTitle: "Link these minutes to an event",
  linkHint:
    "The event decides who reads the minutes. Pick the meeting's event, or make one for it.",
  linkPick: "Which meeting?",
  linkNone: "No recent events without minutes.",
  linkMake: "It isn't on the calendar",
  linkFailed: "Couldn't link the event. Try again.",
} as const;
