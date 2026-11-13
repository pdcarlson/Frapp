import { z } from "zod";

/**
 * Minutes drafted from an officer's notes (`spec/behavior/meetings.md`
 * § Drafting from notes, #4312). One source for what the model is asked to
 * return, what the API hands the editor, and the words each state shows, read
 * by the API, the web editor and, later, mobile and the recording path (#449
 * reuses this schema rather than keeping its own).
 */

/**
 * The most notes one draft takes. Typed notes never come near it: it is sized
 * for the transcript of a two-hour recording (#712), which is about 18,000
 * spoken words, or 120,000 characters with its speaker labels. It was 40,000
 * until recordings arrived (2026-11-12). The table's own check is the
 * backstop (`meeting_drafts_notes_len`).
 */
export const MEETING_NOTES_MAX_LENGTH = 160_000;

/** The prompt this build ships, stamped on the usage ledger. */
export const MEETING_DRAFT_PROMPT_VERSION = "minutes-draft@v1";

const DueDate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .nullable();

/**
 * What the model returns, through the provider's structured output mode. No
 * length limits here, because a provider's schema mode does not enforce them:
 * the API clamps every field after its own checks.
 *
 * `quote` is the line of the notes an item came from, copied character for
 * character. The API keeps an item only when its quote is in the notes
 * (ADR-28 decision 4), so a decision the notes don't hold never reaches the
 * editor.
 */
export const MeetingDraftOutputSchema = z.object({
  summary: z.string(),
  announcements: z.string(),
  decisions: z.array(
    z.object({
      text: z.string(),
      /** Only when the notes give the count. */
      vote: z
        .object({ for: z.number(), against: z.number(), abstain: z.number() })
        .nullable(),
      quote: z.string(),
    }),
  ),
  action_items: z.array(
    z.object({
      text: z.string(),
      /** The owner's full name as the roster writes it, or null. */
      owner: z.string().nullable(),
      due_date: DueDate,
      quote: z.string(),
    }),
  ),
  officer_reports: z.string(),
  old_business: z.string(),
  new_business: z.string(),
  discussion_log: z.string(),
  /** What the notes leave unsaid, one plain sentence each. */
  open_questions: z.array(z.string()),
});
export type MeetingDraftOutput = z.infer<typeof MeetingDraftOutputSchema>;

/** Where a drafted request stands, as the editor reads it. */
export const MEETING_DRAFT_STATUSES = [
  /** Nothing has been asked for. */
  "none",
  "drafting",
  /** Written, but the minutes changed meanwhile, so it was not put in. */
  "ready",
  /** Written into the minutes. */
  "applied",
  "failed",
] as const;
export type MeetingDraftStatus = (typeof MEETING_DRAFT_STATUSES)[number];

export const MEETING_DRAFT_FAILURES = [
  /** The president has not turned meeting notes on. */
  "chapter_off",
  /** The officer has not turned Frapp AI on. */
  "consent_required",
  /** The chapter's, the member's or the platform's AI limit was reached. */
  "spend_limit",
  /** AI is off on this server, or has no provider configured. */
  "unavailable",
  /** The provider declined the notes under its own rules. */
  "refused",
  /** The officer can no longer edit these minutes. */
  "not_permitted",
  /** The officer stopped it. Not an error: the notes wait for another ask. */
  "stopped",
  /** Anything else: a provider outage, an answer that didn't fit. */
  "failed",
] as const;
export type MeetingDraftFailure = (typeof MEETING_DRAFT_FAILURES)[number];

/**
 * Each failure in plain words (principles P2: no codes on screen). The notes
 * are kept in every case, so each line says what to do next, not what broke.
 */
export const MEETING_DRAFT_FAILURE_COPY: Readonly<
  Record<MeetingDraftFailure, string>
> = {
  chapter_off:
    "Drafting from notes is turned off for your chapter. The president can turn it on in Chapter settings.",
  consent_required:
    "Turn on Frapp AI to draft from your notes.",
  spend_limit:
    "Your chapter has reached its AI limit for now. Your notes are saved, and you can write the minutes yourself below.",
  unavailable:
    "Drafting isn't available right now. Your notes are saved, and you can write the minutes yourself below.",
  refused:
    "The AI provider wouldn't draft from these notes. You can write the minutes yourself below.",
  not_permitted: "You can no longer edit these minutes.",
  stopped: "Stopped. Your notes are saved.",
  failed:
    "The draft didn't come through. Your notes are saved, so you can try again.",
};

export function isMeetingDraftFailure(
  value: unknown,
): value is MeetingDraftFailure {
  return (
    typeof value === "string" &&
    (MEETING_DRAFT_FAILURES as readonly string[]).includes(value)
  );
}

/** A drafted line and the line of the notes it came from. */
export const MeetingDraftSourceSchema = z.object({
  kind: z.enum(["decision", "action_item"]),
  /** The drafted text, as it went into the minutes. */
  text: z.string(),
  /** Word for word from the notes. */
  quote: z.string(),
});
export type MeetingDraftSource = z.infer<typeof MeetingDraftSourceSchema>;

/**
 * What the officer checks a draft against: what the notes left unsaid, the
 * line each decision and action item came from, and how many drafted lines
 * were left out because they matched nothing in the notes.
 */
export const MeetingDraftReviewSchema = z.object({
  gaps: z.array(z.string()),
  sources: z.array(MeetingDraftSourceSchema),
  left_out: z.number().int().min(0),
});
export type MeetingDraftReview = z.infer<typeof MeetingDraftReviewSchema>;

export const EMPTY_MEETING_DRAFT_REVIEW: MeetingDraftReview = Object.freeze({
  gaps: [],
  sources: [],
  left_out: 0,
}) as MeetingDraftReview;

/** The most gaps a draft lists, and how long each may run. */
export const MEETING_DRAFT_GAPS_MAX = 12;
export const MEETING_DRAFT_GAP_MAX_LENGTH = 240;

/**
 * The line of the notes a drafted item came from, while its text is still the
 * drafted text. Once the officer rewrites the item it is their own words, and
 * the line no longer vouches for it.
 */
export function meetingDraftQuoteFor(
  review: MeetingDraftReview | null | undefined,
  kind: MeetingDraftSource["kind"],
  text: string,
): string | null {
  const wanted = text.trim();
  if (!review || !wanted) return null;
  return (
    review.sources.find(
      (source) => source.kind === kind && source.text === wanted,
    )?.quote ?? null
  );
}
