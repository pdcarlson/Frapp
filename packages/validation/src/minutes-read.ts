import {
  parseMinutesNotes,
  shownMeetingSections,
  meetingSectionHasContent,
  type MeetingActionItem,
  type MeetingContent,
  type MeetingSectionKey,
  type MinutesNoteLine,
} from "./meetings";
import { meetingSectionLabel } from "./meeting-copy";

/**
 * Minutes as both apps lay them out to read (#5562; Paul, 2026-11-19:
 * "Scrolling through the minutes, nothing stands out"). Each kind of thing
 * has its own shape, so a scroll says what it is before a word is read:
 * dates are tiles, decisions lead with a bold headline, action items are a
 * checklist, the notes are topics that open in place. Web
 * (`minutes-page.tsx`) and the phone (`minutes-body.tsx`) both read their
 * layout, words and counts from here, so switching between them never
 * feels like two systems (Paul, 2026-11-19).
 */

/** The words of the read view and its ⋯ menu, the same on web and phone. */
export const MINUTES_READ_COPY = {
  readSummary: "Read the full summary",
  hideSummary: "Hide the summary",
  showMore: (count: number) => `Show ${count} more`,
  showAll: (count: number) => `Show all ${count}`,
  showFewer: "Show fewer",
  allTopics: (count: number) => `Show all ${count} topics`,
  topics: (count: number) => (count === 1 ? "1 topic" : `${count} topics`),
  dates: (count: number) => (count === 1 ? "1 date" : `${count} dates`),
  mine: "Mine",
  all: (count: number) => `All ${count}`,
  noneMine: "None of these are yours.",
  done: (count: number) => `${count} done`,
  points: (count: number) => (count === 1 ? "1 point" : `${count} points`),
  nobodyNamed: "Nobody named yet",
  due: (day: string) => `Due ${day}`,
  yours: "Yours",
  attendance: "Attendance",
  attendanceNone: "Not taken",
  attended: (count: number) => `${count} attended`,
  /** The jump bar's label, for a screen reader. */
  jumpLabel: "Jump to a section",
  /** The ⋯ menu, in the order both apps draw it. */
  menu: {
    label: "More",
    editDetails: "Edit details",
    editMinutes: "Edit minutes",
    attendance: "Mark who was there",
    copyLink: "Copy link",
    openEvent: "Open event",
    transcript: "Transcript",
    delete: "Delete minutes",
  },
  linkCopied: "Link copied",
  /**
   * Notes that are a pasted transcript fold into a card (#5562; Paul,
   * 2026-11-19: a pasted Wispr Flow transcript made "the infinite scroll").
   */
  pastedTranscript: {
    title: "Pasted transcript",
    words: (count: number) =>
      count === 1 ? "1 word" : `${count.toLocaleString("en-US")} words`,
    view: "View",
    hide: "Hide",
    remove: "Remove",
    removeTitle: "Remove the pasted transcript?",
    removeBody: "Your notes box empties. A draft already written stays.",
  },
  /** Edit details: the meeting's facts in one form. */
  details: {
    title: "Details",
    name: "Name",
    when: "When",
    type: "Type",
    whoCanRead: "Who can read",
    starts: "Starts",
    ends: "Ends",
    everyone: "Everyone the event invites",
    someRoles: (roles: string) => `Members invited by role: ${roles}`,
    changeWho: "Change who's invited",
    otherLabel: "What kind of meeting (optional)",
    endBeforeStart: "End after it starts.",
    eventNote:
      "Name, time and who can read belong to the meeting's event, so changing them here changes the event too.",
    eventOnly:
      "You can change the type. The name, time and who can read belong to the event, which only someone who can edit events can change.",
    save: "Save",
    saved: "Details saved",
    saveFailed: "Couldn't save the details",
    nameRequired: "Give the meeting a name.",
  },
} as const;

/** How many of a list show before "Show all". */
export const MINUTES_PREVIEW = {
  decisions: 4,
  action_items: 4,
  announcements: 4,
  topics: 5,
} as const;

/**
 * The sections the read view draws as their own blocks, in order. The
 * Summary isn't one once there is a TL;DR: it opens under the TL;DR, behind
 * "Read the full summary", so the gist is said once (#5562). Attendees are a
 * row of their own, under the rest.
 */
export function minutesReadSections(
  template: readonly MeetingSectionKey[],
  content: MeetingContent,
): MeetingSectionKey[] {
  const hasTldr = meetingSectionHasContent(content, "tldr");
  return shownMeetingSections(template, content).filter(
    (key) =>
      key !== "attendees" &&
      meetingSectionHasContent(content, key) &&
      !(key === "summary" && hasTldr),
  );
}

/** A jump bar stop: a section and how many it holds. */
export interface MinutesJump {
  key: MeetingSectionKey;
  label: string;
  count: number;
}

/**
 * The jump bar's stops (#5562): the sections a member scrolls for, each with
 * its count, and only where there's something to jump to.
 */
export function minutesJumps(
  sections: readonly MeetingSectionKey[],
  content: MeetingContent,
): MinutesJump[] {
  const stops: MinutesJump[] = [];
  const add = (key: MeetingSectionKey, count: number) => {
    if (sections.includes(key)) {
      stops.push({ key, label: meetingSectionLabel(key), count });
    }
  };
  add("dates", content.dates.length);
  add("decisions", content.decisions.length);
  add("action_items", content.action_items.length);
  add("tabled", content.tabled.length);
  add("announcements", minutesLines(content.announcements));
  add("discussion_log", minutesTopics(content.discussion_log).length);
  return stops.length > 1 ? stops : [];
}

/** How many lines a text section holds. */
function minutesLines(text: string): number {
  return text.split("\n").filter((line) => line.trim().length > 0).length;
}

/** A dated item's tile: "NOV" over "28", and the weekday under the words. */
export interface MinutesDateTile {
  month: string;
  day: string;
  weekday: string;
}

/** `2026-11-28` as its tile, read as a calendar day wherever the reader is. */
export function minutesDateTile(date: string): MinutesDateTile {
  const [year, month, day] = date.split("-").map(Number);
  if (!year || !month || !day) return { month: "", day: "", weekday: "" };
  const at = new Date(year, month - 1, day, 12);
  return {
    month: at.toLocaleDateString("en-US", { month: "short" }).toUpperCase(),
    day: String(day),
    weekday: at.toLocaleDateString("en-US", { weekday: "long" }),
  };
}

/** One topic of the notes, with the lines under it. */
export interface MinutesTopic {
  /** Null for lines written before the first topic, or with no topics. */
  title: string | null;
  lines: MinutesNoteLine[];
}

/**
 * The notes outline as topics (#5562), each opened in place on both apps.
 * Notes typed by hand with no topics come back as one untitled topic.
 */
export function minutesTopics(text: string): MinutesTopic[] {
  const topics: MinutesTopic[] = [];
  for (const line of parseMinutesNotes(text, { outline: true })) {
    if (line.kind === "topic") {
      topics.push({ title: line.text, lines: [] });
      continue;
    }
    let current = topics[topics.length - 1];
    if (!current) {
      current = { title: null, lines: [] };
      topics.push(current);
    }
    current.lines.push(line);
  }
  return topics.filter((topic) => topic.title || topic.lines.length > 0);
}

/** An action item with its place in the stored list (which its task is keyed by). */
export interface MinutesActionRow {
  item: MeetingActionItem;
  index: number;
  mine: boolean;
}

/**
 * Action items as the checklist lists them (#5562): the reader's own first,
 * then the ones with a due day, soonest first, then the rest as written.
 * Each keeps its stored place, which its task is keyed by.
 */
export function minutesActionRows(
  items: readonly MeetingActionItem[],
  viewerId: string | null,
): MinutesActionRow[] {
  const rows = items.map((item, index) => ({
    item,
    index,
    mine: !!viewerId && item.owner_user_id === viewerId,
  }));
  const rank = (row: MinutesActionRow) => (row.mine ? 0 : row.item.due_date ? 1 : 2);
  return rows.sort(
    (a, b) =>
      rank(a) - rank(b) ||
      (a.item.due_date ?? "").localeCompare(b.item.due_date ?? "") ||
      a.index - b.index,
  );
}

/** Past this many characters, notes read as a pasted transcript. */
export const MINUTES_PASTED_TRANSCRIPT_CHARS = 3000;
/** "12:04" or "1:02:33" at the start of a line, the way transcripts mark time. */
const TIMESTAMPED_LINE = /^\s*\[?\(?\d{1,2}:\d{2}(?::\d{2})?\b/;

/**
 * Whether the notes are a pasted transcript rather than notes typed by hand
 * (#5562): long, or stamped with times line after line. Both apps fold such
 * notes into a card instead of a box that scrolls forever.
 */
export function notesLookLikeTranscript(text: string): boolean {
  if (text.length > MINUTES_PASTED_TRANSCRIPT_CHARS) return true;
  const lines = text.split("\n").filter((line) => line.trim().length > 0);
  const stamped = lines.filter((line) => TIMESTAMPED_LINE.test(line)).length;
  return stamped >= 3 && stamped >= lines.length / 2;
}

/** How many words the notes hold, for the transcript card. */
export function notesWordCount(text: string): number {
  return text.split(/\s+/).filter((word) => word.length > 0).length;
}
