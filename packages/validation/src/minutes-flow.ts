import {
  MEETING_SECTION_KEYS,
  meetingSectionHasContent,
  shownMeetingSections,
  type MeetingContent,
  type MeetingSectionKey,
} from "./meetings";
import { meetingRecorderClock } from "./meeting-recording";
import { notesLookLikeTranscript } from "./minutes-read";

/**
 * Minutes, drafted first (Paul, 2026-11-19: "The AI draft should be the
 * primary way we turn minutes into structured data. I'd rather not have 12
 * buttons and sections"). A draft's minutes go through three states on web
 * and phone alike, in the same words (`spec/behavior/meetings.md`
 * § Drafting from notes):
 *
 * 1. Start: one box for the notes or a transcript, and Draft minutes. No
 *    empty sections and no Post until there is something in them.
 * 2. Drafting: the steps so far, a clock, and a line saying the officer can
 *    leave and will get a notification.
 * 3. Review: only the sections the draft filled, a menu to add another, and
 *    Post as the one primary action.
 */
export const MINUTES_FLOW_COPY = {
  start: {
    heading: "How did the meeting go?",
    hint: "Paste your notes or a transcript. Rough is fine.",
    upload: "Upload a recording",
    byHand: "Write the minutes by hand",
  },
  drafting: {
    badge: "Drafting",
    steps: {
      notes: "Saved your notes",
      transcript: "Saved your transcript",
      recording: "Wrote out the recording",
      everyone: "Gathered everyone's notes",
      writing: "Writing the minutes",
      ready: "Ready for you to read",
    },
    leave:
      "You can leave this page. We'll send you a notification when it's ready.",
    stop: "Stop drafting",
  },
  review: {
    banner: (source: MinutesDraftSource) =>
      `Drafted from ${SOURCE_WORDS[source]}. Read it over and fix anything, then post.`,
    notes: "Notes and transcript",
    addSection: "Add a section",
  },
} as const;

/** What a draft is written from, as the officer would name it. */
export type MinutesDraftSource =
  "notes" | "transcript" | "recording" | "everyone";

const SOURCE_WORDS: Record<MinutesDraftSource, string> = {
  notes: "your notes",
  transcript: "your transcript",
  recording: "the recording",
  everyone: "everyone's notes",
};

/**
 * What the draft reads: everyone's notes once anyone else wrote some, else a
 * pasted transcript, else the uploaded recording when the box is empty, else
 * the officer's own notes.
 */
export function minutesDraftSource({
  notes,
  othersWrote,
  recordingReady,
}: {
  notes: string;
  /** Another note-taker's notes are in. */
  othersWrote: boolean;
  /** The meeting's recording is written out. */
  recordingReady: boolean;
}): MinutesDraftSource {
  if (othersWrote) return "everyone";
  if (notesLookLikeTranscript(notes)) return "transcript";
  if (recordingReady && !notes.trim()) return "recording";
  if (recordingReady) return "everyone";
  return "notes";
}

export type MinutesDraftStep = {
  label: string;
  state: "done" | "now" | "next";
};

/** The drafting checklist: what is done, what is under way, what is next. */
export function minutesDraftSteps(
  source: MinutesDraftSource,
): MinutesDraftStep[] {
  const steps = MINUTES_FLOW_COPY.drafting.steps;
  return [
    { label: steps[source], state: "done" },
    { label: steps.writing, state: "now" },
    { label: steps.ready, state: "next" },
  ];
}

/**
 * How long the draft has been written, "0:42" or "12:05", counted from when
 * it was asked for so a reload or the other device shows the same clock.
 * Null when the start is unknown.
 */
export function minutesDraftElapsed(
  requestedAt: string | null,
  now: number,
): string | null {
  if (!requestedAt) return null;
  const started = Date.parse(requestedAt);
  if (Number.isNaN(started)) return null;
  return meetingRecorderClock((now - started) / 1000);
}

/**
 * The sections the minutes editor shows. Written by hand, the template's
 * sections are laid out to fill in. Otherwise, after a draft or on coming
 * back to minutes already started, only the ones with something in them,
 * and any the officer added from Add a section, so a draft never arrives
 * wrapped in empty boxes.
 */
export function minutesEditorSections(
  template: readonly MeetingSectionKey[],
  content: MeetingContent,
  { byHand, added }: { byHand: boolean; added: readonly MeetingSectionKey[] },
): MeetingSectionKey[] {
  if (byHand) {
    const shown = new Set(shownMeetingSections(template, content));
    for (const key of added) shown.add(key);
    return MEETING_SECTION_KEYS.filter((key) => shown.has(key));
  }
  const extra = new Set(added);
  return MEETING_SECTION_KEYS.filter(
    (key) => extra.has(key) || meetingSectionHasContent(content, key),
  );
}

/** What Add a section offers: every section not on screen, in order. */
export function minutesAddableSections(
  shown: readonly MeetingSectionKey[],
): MeetingSectionKey[] {
  const on = new Set(shown);
  return MEETING_SECTION_KEYS.filter((key) => !on.has(key));
}
