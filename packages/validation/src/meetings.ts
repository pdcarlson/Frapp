import { z } from "zod";

/**
 * Meeting minutes (`spec/behavior/meetings.md`, #4312). One source for the
 * meeting types, the template's sections and the shape of the minutes
 * themselves, read by the API's DTOs and service, the web editor and, later,
 * the AI drafter (#449 reuses this schema rather than keeping its own).
 */

/**
 * The types an officer can start minutes for. Standards is a kind of meeting
 * a chapter holds, but none of the ways in offers it and the server refuses
 * it (`meetings.md` § Standards meetings), so it is not in this list.
 */
export const MEETING_TYPES = ["chapter", "exec", "committee", "other"] as const;
export type MeetingType = (typeof MEETING_TYPES)[number];

/** The refused type, named so the API and the picker can say why. */
export const STANDARDS_MEETING_TYPE = "standards";

export const MEETING_TYPE_LABELS: Readonly<Record<MeetingType, string>> = {
  chapter: "Chapter",
  exec: "Exec",
  committee: "Committee",
  other: "Other",
};

/** The one line where the type is picked (`meetings.md` § Standards meetings). */
export const STANDARDS_MEETING_NOTE =
  "Standards hearings aren't kept in Frapp. Write those by hand, outside the app, and don't file one under another type.";

/** The API's 400 for a request that names the Standards type. */
export const STANDARDS_MEETING_REFUSAL =
  "Standards minutes can't be kept in Frapp. Write them by hand, outside the app.";

export function isMeetingType(value: unknown): value is MeetingType {
  return (
    typeof value === "string" &&
    (MEETING_TYPES as readonly string[]).includes(value)
  );
}

export function meetingTypeLabel(
  type: MeetingType,
  otherLabel?: string | null,
): string {
  if (type === "other" && otherLabel?.trim()) return otherLabel.trim();
  return MEETING_TYPE_LABELS[type];
}

/**
 * The template's sections, in the order minutes show them
 * (`meetings.md` § Template). `attendees` has no text: it is the event's
 * check-ins, filled without anyone typing.
 */
export const MEETING_SECTIONS = [
  // The TL;DR leads: a few plain bullets for the average member, what was
  // decided, what they need to do and by when, and what's coming up, read
  // before anything else (Paul, 2026-11-18, #5523: "a more parsable version
  // of the minutes, just for your average brother to read").
  { key: "tldr", label: "TL;DR", defaultOn: true },
  // The opening paragraph. Read under the TL;DR, behind "Read the full
  // summary", once there is a TL;DR (#5562).
  { key: "summary", label: "Summary", defaultOn: true },
  // Then each kind of thing in its own shape, so a scroll says what it is
  // before a word is read (Paul, 2026-11-19, #5562: "Scrolling through the
  // minutes, nothing stands out"): the dates coming up, what was settled,
  // who owes what, what was put off, then the announcements and the notes.
  // Changed in #5562 from Paul's 2026-11-18 order ("summary, announcements,
  // decisions, and then action items"), at his ask.
  // The dates the meeting named (#5562): a day and a few words each, drawn
  // as date tiles. Empty unless a date was named, so it reads only where it
  // has something.
  { key: "dates", label: "Coming up", defaultOn: true },
  { key: "decisions", label: "Decisions", defaultOn: true },
  { key: "action_items", label: "Action items", defaultOn: true },
  // What the meeting put off to a later one (#5522; Paul, 2026-11-18: "it
  // should keep track of what items are tabled"), for a later meeting's
  // agenda to pick up (#5534). Empty unless something was tabled, so it
  // reads only where it has something.
  { key: "tabled", label: "Tabled", defaultOn: true },
  { key: "announcements", label: "Announcements", defaultOn: true },
  // The notes themselves: every topic with its detail. Always on, because
  // minutes without them lose what was said (Paul, 2026-11-17: "a 7-minute
  // meeting gets distilled into one sentence ... there's zero detail").
  { key: "discussion_log", label: "Notes", defaultOn: true },
  { key: "attendees", label: "Attendees", defaultOn: true },
  { key: "officer_reports", label: "Officer reports", defaultOn: false },
  { key: "old_business", label: "Old business", defaultOn: false },
  { key: "new_business", label: "New business", defaultOn: false },
] as const;

export type MeetingSectionKey = (typeof MEETING_SECTIONS)[number]["key"];

export const MEETING_SECTION_KEYS: readonly MeetingSectionKey[] =
  MEETING_SECTIONS.map((section) => section.key);

/** The sections a chapter with no saved template shows. */
export const DEFAULT_MEETING_SECTIONS: readonly MeetingSectionKey[] =
  MEETING_SECTIONS.filter((section) => section.defaultOn).map(
    (section) => section.key,
  );

/**
 * Sections every chapter's minutes carry, whatever its template says: the
 * TL;DR is what most members read (Paul, 2026-11-18, #5523: always on, so a
 * template saved before it still gets one), the dates coming up are what a
 * member scrolls for (#5562), what was tabled has to be found
 * by the next meeting (#5522), and the notes by topic are what minutes are
 * for, so no switch turns any of them off.
 */
export const ALWAYS_MEETING_SECTIONS: readonly MeetingSectionKey[] = [
  "tldr",
  "dates",
  "tabled",
  "discussion_log",
];

export function isMeetingSectionKey(
  value: unknown,
): value is MeetingSectionKey {
  return (
    typeof value === "string" &&
    (MEETING_SECTION_KEYS as readonly string[]).includes(value)
  );
}

/** A chapter's saved section list, cleaned: known keys, catalog order, once. */
export function normalizeMeetingSections(
  sections: readonly unknown[] | null | undefined,
): MeetingSectionKey[] {
  if (!sections) return [...DEFAULT_MEETING_SECTIONS];
  const wanted = new Set([
    ...sections.filter(isMeetingSectionKey),
    ...ALWAYS_MEETING_SECTIONS,
  ]);
  return MEETING_SECTION_KEYS.filter((key) => wanted.has(key));
}

/** The free-text sections, each one block of the officer's own words. */
export const MEETING_TEXT_SECTIONS = [
  "tldr",
  "summary",
  "announcements",
  "officer_reports",
  "old_business",
  "new_business",
  "discussion_log",
] as const satisfies readonly MeetingSectionKey[];
export type MeetingTextSection = (typeof MEETING_TEXT_SECTIONS)[number];

/**
 * One section's limit. A four-hour meeting's notes can run past it, and the
 * notes outline is then cut at a whole point (`notesOutline`). Raising it
 * widens a response field that shipped phone builds read, which the
 * shipped-contract check refuses, so it waits on #5418.
 */
export const MEETING_TEXT_MAX_LENGTH = 20_000;
export const MEETING_ITEM_TEXT_MAX_LENGTH = 1_000;
export const MEETING_LIST_MAX_ITEMS = 100;
export const MEETING_OTHER_LABEL_MAX_LENGTH = 60;
/** A vote count; no chapter seats more than this. */
export const MEETING_VOTE_MAX = 10_000;

const voteCount = z.number().int().min(0).max(MEETING_VOTE_MAX);

export const MeetingVoteSchema = z.object({
  for: voteCount,
  against: voteCount,
  abstain: voteCount,
});

/** A decision's headline: a few words, read before its full text. */
export const MEETING_DECISION_HEADLINE_MAX_LENGTH = 120;

export const MeetingDecisionSchema = z.object({
  text: z.string().trim().min(1).max(MEETING_ITEM_TEXT_MAX_LENGTH),
  /** Only when the notes give the count; never a guess. */
  vote: MeetingVoteSchema.nullable(),
  /**
   * The outcome in a few words, drawn bold over the full text (#5562), so a
   * scroll down the decisions reads as a list of outcomes. Absent on
   * decisions written before it, which show their text alone.
   */
  headline: z
    .string()
    .trim()
    .max(MEETING_DECISION_HEADLINE_MAX_LENGTH)
    .nullable()
    .optional(),
});

/** The most dates one meeting's minutes keep. */
export const MEETING_DATES_MAX_ITEMS = 30;

/**
 * A date the meeting named (#5562): the day, and what happens then in a few
 * words ("Officer installation at chapter"), for the Coming up tiles.
 */
export const MeetingDateItemSchema = z.object({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  text: z.string().trim().min(1).max(MEETING_ITEM_TEXT_MAX_LENGTH),
});

export const MeetingActionItemSchema = z.object({
  text: z.string().trim().min(1).max(MEETING_ITEM_TEXT_MAX_LENGTH),
  /** Only when someone was named for it; a wrong owner is worse than none. */
  owner_user_id: z.string().uuid().nullable(),
  /** A calendar day, `YYYY-MM-DD`, or none. */
  due_date: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .nullable(),
});

/** The most matters one meeting tables. */
export const MEETING_TABLED_MAX_ITEMS = 30;
/** How many meetings in a row can table the same matter, as counted. */
export const MEETING_TABLED_MAX_TIMES = 99;

/**
 * A matter the meeting tabled (#5522): what it is, in a few words a member
 * would put on an agenda, and, when an earlier meeting tabled it first,
 * which one and when, so it keeps its original date however often it is
 * tabled again.
 */
export const MeetingTabledItemSchema = z.object({
  text: z.string().trim().min(1).max(MEETING_ITEM_TEXT_MAX_LENGTH),
  /** The minutes that first tabled it; null when these minutes did. */
  first_meeting_id: z.string().uuid().nullable(),
  /** That meeting's start; null with `first_meeting_id`. */
  first_start_time: z.string().datetime({ offset: true }).nullable(),
  /** How many meetings have tabled it, this one included. */
  times: z.number().int().min(1).max(MEETING_TABLED_MAX_TIMES),
});

const sectionText = z.string().max(MEETING_TEXT_MAX_LENGTH);

/**
 * The minutes themselves. Every section is present on a read; a write may
 * send any subset, and a section left out keeps what is stored.
 */
export const MeetingContentSchema = z.object({
  tldr: sectionText,
  summary: sectionText,
  announcements: sectionText,
  decisions: z.array(MeetingDecisionSchema).max(MEETING_LIST_MAX_ITEMS),
  action_items: z.array(MeetingActionItemSchema).max(MEETING_LIST_MAX_ITEMS),
  tabled: z.array(MeetingTabledItemSchema).max(MEETING_TABLED_MAX_ITEMS),
  dates: z.array(MeetingDateItemSchema).max(MEETING_DATES_MAX_ITEMS),
  officer_reports: sectionText,
  old_business: sectionText,
  new_business: sectionText,
  discussion_log: sectionText,
});

export type MeetingVote = z.infer<typeof MeetingVoteSchema>;
export type MeetingDecision = z.infer<typeof MeetingDecisionSchema>;
export type MeetingActionItem = z.infer<typeof MeetingActionItemSchema>;
export type MeetingTabledItem = z.infer<typeof MeetingTabledItemSchema>;
export type MeetingDateItem = z.infer<typeof MeetingDateItemSchema>;
export type MeetingContent = z.infer<typeof MeetingContentSchema>;

export const EMPTY_MEETING_CONTENT: MeetingContent = Object.freeze({
  tldr: "",
  summary: "",
  announcements: "",
  decisions: [],
  action_items: [],
  tabled: [],
  dates: [],
  officer_reports: "",
  old_business: "",
  new_business: "",
  discussion_log: "",
}) as MeetingContent;

/**
 * A stored `content` value read as minutes: each section kept when it is the
 * right shape, emptied when it is not, so one bad item never blanks the rest.
 */
export function readMeetingContent(value: unknown): MeetingContent {
  const raw =
    value && typeof value === "object"
      ? (value as Record<string, unknown>)
      : {};
  const text = (key: MeetingTextSection): string => {
    const parsed = sectionText.safeParse(raw[key]);
    return parsed.success ? parsed.data : "";
  };
  const list = <T>(key: string, schema: z.ZodType<T>): T[] => {
    const items = Array.isArray(raw[key]) ? (raw[key] as unknown[]) : [];
    return items.flatMap((item) => {
      const parsed = schema.safeParse(item);
      return parsed.success ? [parsed.data] : [];
    });
  };
  return {
    tldr: text("tldr"),
    summary: text("summary"),
    announcements: text("announcements"),
    decisions: list("decisions", MeetingDecisionSchema),
    action_items: list("action_items", MeetingActionItemSchema),
    tabled: list("tabled", MeetingTabledItemSchema).slice(
      0,
      MEETING_TABLED_MAX_ITEMS,
    ),
    dates: list("dates", MeetingDateItemSchema).slice(
      0,
      MEETING_DATES_MAX_ITEMS,
    ),
    officer_reports: text("officer_reports"),
    old_business: text("old_business"),
    new_business: text("new_business"),
    discussion_log: text("discussion_log"),
  };
}

/** Whether a section has anything written in it. */
export function meetingSectionHasContent(
  content: MeetingContent,
  key: MeetingSectionKey,
): boolean {
  if (key === "attendees") return false;
  if (key === "decisions") return content.decisions.length > 0;
  if (key === "action_items") return content.action_items.length > 0;
  if (key === "tabled") return content.tabled.length > 0;
  if (key === "dates") return content.dates.length > 0;
  return content[key].trim().length > 0;
}

/** Whether nothing at all has been written yet. */
export function isMeetingContentEmpty(content: MeetingContent): boolean {
  return MEETING_SECTION_KEYS.every(
    (key) => !meetingSectionHasContent(content, key),
  );
}

/**
 * The sections a reader sees: the chapter's template, plus any section that
 * has words in it although the template has since dropped it, so turning a
 * section off never hides minutes already written.
 */
export function shownMeetingSections(
  template: readonly MeetingSectionKey[],
  content: MeetingContent,
): MeetingSectionKey[] {
  const on = new Set(template);
  return MEETING_SECTION_KEYS.filter(
    (key) => on.has(key) || meetingSectionHasContent(content, key),
  );
}

export const MEETING_STATUSES = ["draft", "posted"] as const;
export type MeetingStatus = (typeof MEETING_STATUSES)[number];

/** One line of a notes outline, as the minutes screens draw it. */
export type MinutesNoteLine =
  | { kind: "topic"; text: string }
  | { kind: "point"; depth: 0 | 1; text: string }
  /** A line that is neither: a paragraph, or an older "Topic: detail" line. */
  | { kind: "line"; head: string | null; text: string };

const BULLET = /^(\s*)[-•*]\s+(.*)$/;
/** "Rusty Pipes afterparty: approved for December 5" leads with its topic. */
const LEADING_TOPIC = /^([^:.]{2,60}):\s+(.+)$/;
const TOPIC_MAX_LENGTH = 90;

/**
 * A text section read as the notes outline the drafter writes (a topic on
 * its own line, its points under it as "- " bullets, two spaces deeper for
 * a sub-point), so web and phone draw the same structure. Text with no
 * bullets, typed by hand or written before the outline, reads line by line
 * as it always did, and so does every section but the notes
 * (`outline: false`): an officer's report that mixes "Treasurer: ..." lines
 * with a bullet is not an outline, and its lines are not topics.
 */
export function parseMinutesNotes(
  text: string,
  { outline = true }: { outline?: boolean } = {},
): MinutesNoteLine[] {
  const raw = text.split("\n").filter((line) => line.trim().length > 0);
  const outlined = outline && raw.some((line) => BULLET.test(line));
  return raw.map((line): MinutesNoteLine => {
    const bullet = BULLET.exec(line);
    if (bullet) {
      return {
        kind: "point",
        depth: (bullet[1] ?? "").replace(/\t/g, "  ").length >= 2 ? 1 : 0,
        text: (bullet[2] ?? "").trim(),
      };
    }
    const trimmed = line.trim();
    // "Treasurer: collected $1,200" leads with its topic and says something
    // after it, so it is a line, not a topic heading, even in an outline.
    const head = LEADING_TOPIC.exec(trimmed);
    if (head) {
      return { kind: "line", head: head[1] ?? null, text: head[2] ?? trimmed };
    }
    if (
      outlined &&
      trimmed.length <= TOPIC_MAX_LENGTH &&
      !/[.!?]$/.test(trimmed)
    ) {
      return { kind: "topic", text: trimmed.replace(/:$/, "") };
    }
    return { kind: "line", head: null, text: trimmed };
  });
}
