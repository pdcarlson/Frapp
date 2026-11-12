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
  { key: "attendees", label: "Attendees", defaultOn: true },
  { key: "summary", label: "Summary", defaultOn: true },
  { key: "announcements", label: "Announcements", defaultOn: true },
  { key: "decisions", label: "Decisions", defaultOn: true },
  { key: "action_items", label: "Action items", defaultOn: true },
  { key: "officer_reports", label: "Officer reports", defaultOn: false },
  { key: "old_business", label: "Old business", defaultOn: false },
  { key: "new_business", label: "New business", defaultOn: false },
  { key: "discussion_log", label: "Discussion log", defaultOn: false },
] as const;

export type MeetingSectionKey = (typeof MEETING_SECTIONS)[number]["key"];

export const MEETING_SECTION_KEYS: readonly MeetingSectionKey[] =
  MEETING_SECTIONS.map((section) => section.key);

/** The sections a chapter with no saved template shows. */
export const DEFAULT_MEETING_SECTIONS: readonly MeetingSectionKey[] =
  MEETING_SECTIONS.filter((section) => section.defaultOn).map(
    (section) => section.key,
  );

export function isMeetingSectionKey(value: unknown): value is MeetingSectionKey {
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
  const wanted = new Set(sections.filter(isMeetingSectionKey));
  return MEETING_SECTION_KEYS.filter((key) => wanted.has(key));
}

/** The free-text sections, each one block of the officer's own words. */
export const MEETING_TEXT_SECTIONS = [
  "summary",
  "announcements",
  "officer_reports",
  "old_business",
  "new_business",
  "discussion_log",
] as const satisfies readonly MeetingSectionKey[];
export type MeetingTextSection = (typeof MEETING_TEXT_SECTIONS)[number];

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

export const MeetingDecisionSchema = z.object({
  text: z.string().trim().min(1).max(MEETING_ITEM_TEXT_MAX_LENGTH),
  /** Only when the notes give the count; never a guess. */
  vote: MeetingVoteSchema.nullable(),
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

const sectionText = z.string().max(MEETING_TEXT_MAX_LENGTH);

/**
 * The minutes themselves. Every section is present on a read; a write may
 * send any subset, and a section left out keeps what is stored.
 */
export const MeetingContentSchema = z.object({
  summary: sectionText,
  announcements: sectionText,
  decisions: z.array(MeetingDecisionSchema).max(MEETING_LIST_MAX_ITEMS),
  action_items: z.array(MeetingActionItemSchema).max(MEETING_LIST_MAX_ITEMS),
  officer_reports: sectionText,
  old_business: sectionText,
  new_business: sectionText,
  discussion_log: sectionText,
});

export type MeetingVote = z.infer<typeof MeetingVoteSchema>;
export type MeetingDecision = z.infer<typeof MeetingDecisionSchema>;
export type MeetingActionItem = z.infer<typeof MeetingActionItemSchema>;
export type MeetingContent = z.infer<typeof MeetingContentSchema>;

export const EMPTY_MEETING_CONTENT: MeetingContent = Object.freeze({
  summary: "",
  announcements: "",
  decisions: [],
  action_items: [],
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
    value && typeof value === "object" ? (value as Record<string, unknown>) : {};
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
    summary: text("summary"),
    announcements: text("announcements"),
    decisions: list("decisions", MeetingDecisionSchema),
    action_items: list("action_items", MeetingActionItemSchema),
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
