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

/**
 * The most text one draft reads from every note-taker and the transcript
 * together (#4935). Matches the table's backstop on what a draft stores
 * (`meeting_drafts_notes_len`).
 */
export const MEETING_DRAFT_SOURCES_MAX_LENGTH = 200_000;

/** The prompt this build ships, stamped on the usage ledger. */
export const MEETING_DRAFT_PROMPT_VERSION = "minutes-draft@v8";

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
 *
 * Since #4935 a draft reads several sources (each note-taker's notes and the
 * recording's transcript), each named in the prompt ("S1", "S2"). `source`
 * names the one an item's quote is from. `conflicts` is where two sources
 * say different things about the same item; Frapp, not the model, picks
 * which version goes into the minutes. Both are optional so a reply to a
 * one-source prompt that leaves them out still fits.
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
      source: z.string().optional(),
    }),
  ),
  action_items: z.array(
    z.object({
      text: z.string(),
      /** The owner's full name as the roster writes it, or null. */
      owner: z.string().nullable(),
      due_date: DueDate,
      quote: z.string(),
      source: z.string().optional(),
    }),
  ),
  /**
   * Matters the meeting tabled (#5522), each with the line where it was
   * tabled, kept only when that line is in a source, as a decision is.
   */
  tabled: z.array(
    z.object({
      text: z.string(),
      quote: z.string(),
      source: z.string().optional(),
    }),
  ),
  officer_reports: z.string(),
  old_business: z.string(),
  new_business: z.string(),
  discussion_log: z.string(),
  /**
   * The TL;DR (#5523): a few plain "- " bullets for a member who reads
   * nothing else. Last of the sections, so a model writing in order writes
   * it after the decisions and action items it has listed. Not checked
   * against the sources: the API asks the officer to compare it when the
   * checks took an item out or settled a conflict.
   */
  tldr: z.string(),
  /** What the notes leave unsaid, one plain sentence each. */
  open_questions: z.array(z.string()),
  /**
   * Items two or more sources disagree about (a vote count, who owns an
   * action, what was decided). Each version is one source's account, in its
   * own words and with its own quote. A contested item is not also listed in
   * `decisions` or `action_items`.
   */
  conflicts: z
    .array(
      z.object({
        kind: z.enum(["decision", "action_item"]),
        /** What the disagreement is about, in a few words. */
        about: z.string(),
        versions: z.array(
          z.object({
            source: z.string(),
            quote: z.string(),
            text: z.string(),
            vote: z
              .object({
                for: z.number(),
                against: z.number(),
                abstain: z.number(),
              })
              .nullable(),
            owner: z.string().nullable(),
            due_date: DueDate,
          }),
        ),
      }),
    )
    .optional(),
  /**
   * What tonight's sources say about each item the prompt's background
   * carries from earlier minutes (#5477): last meeting's open action items
   * ("F1"…) and the standing reports ("R1"…). A status other than
   * `not_mentioned` stands only with a quote Frapp finds in a source;
   * otherwise Frapp reads it as `not_mentioned`. Optional, so a prompt with
   * no background, or a reply that leaves it out, still fits.
   */
  follow_ups: z
    .array(
      z.object({
        id: z.string(),
        status: z.enum(["done", "carried", "given", "not_mentioned"]),
        quote: z.string().nullable(),
        source: z.string().nullable(),
      }),
    )
    .optional(),
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
  consent_required: "Turn on Frapp AI to draft from your notes.",
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
  /**
   * Whose line it is: a note-taker's name, or "Recording" (#4935). Absent
   * on a draft written before several note-takers.
   */
  from: z.string().optional(),
});
export type MeetingDraftSource = z.infer<typeof MeetingDraftSourceSchema>;

/** How a disagreement between sources was settled (#4935). */
export const MEETING_DRAFT_SETTLED_BY = [
  /** The recording's transcript covered the moment. */
  "recording",
  /** The note-taker with more authority: the author, then `meetings:edit`, then role tier. */
  "authority",
  /** The author picked a version. */
  "author",
] as const;
export type MeetingDraftSettledBy = (typeof MEETING_DRAFT_SETTLED_BY)[number];

/** One source's account of a contested item, checked like any drafted item. */
export const MeetingDraftVersionSchema = z.object({
  from: z.string(),
  quote: z.string(),
  text: z.string(),
  vote: z
    .object({
      for: z.number().int(),
      against: z.number().int(),
      abstain: z.number().int(),
    })
    .nullable(),
  owner_user_id: z.string().nullable(),
  due_date: z.string().nullable(),
});
export type MeetingDraftVersion = z.infer<typeof MeetingDraftVersionSchema>;

/**
 * Two or more sources disagreed about one item. `chosen` is the version in
 * the minutes, or null when nothing settled it and the author must pick
 * (the item is then not in the minutes yet).
 */
export const MeetingDraftConflictSchema = z.object({
  kind: z.enum(["decision", "action_item"]),
  about: z.string(),
  versions: z.array(MeetingDraftVersionSchema).min(2),
  chosen: z.number().int().min(0).nullable(),
  settled_by: z.enum(MEETING_DRAFT_SETTLED_BY).nullable(),
});
export type MeetingDraftConflict = z.infer<typeof MeetingDraftConflictSchema>;

/** The most disagreements one draft lists. */
export const MEETING_DRAFT_CONFLICTS_MAX = 12;

/**
 * Where an item carried from earlier minutes stands tonight (#5477).
 * `done` and `carried` are an action item someone reported on tonight;
 * `given` is a standing report given tonight; `not_mentioned` is nothing in
 * tonight's sources, for the secretary to confirm.
 */
export const MEETING_FOLLOW_UP_STATUSES = [
  "done",
  "carried",
  "given",
  "not_mentioned",
] as const;
export type MeetingFollowUpStatus = (typeof MEETING_FOLLOW_UP_STATUSES)[number];

/**
 * One item the draft carried from earlier minutes (#5477): an open action
 * item from the last meeting, or a standing report. Its text is from those
 * minutes, never from tonight; `quote` and `from` are tonight's line about
 * it, and are null when nothing tonight mentions it.
 */
export const MeetingDraftFollowUpSchema = z.object({
  kind: z.enum(["action_item", "report"]),
  /** The action item's text, or the office that reports, as earlier minutes wrote it. */
  text: z.string(),
  owner_user_id: z.string().nullable(),
  /**
   * When the meeting whose minutes it comes from started (ISO), for a
   * screen to show as a day in the reader's own time; the server's UTC day
   * is a day off for an evening meeting west of Greenwich.
   */
  from_meeting_start_time: z.string(),
  status: z.enum(MEETING_FOLLOW_UP_STATUSES),
  quote: z.string().nullable(),
  from: z.string().nullable(),
});
export type MeetingDraftFollowUp = z.infer<typeof MeetingDraftFollowUpSchema>;

/**
 * What the officer checks a draft against: what the notes left unsaid, the
 * line each decision and action item came from, and how many drafted lines
 * were left out because they matched nothing in the notes.
 */
export const MeetingDraftReviewSchema = z.object({
  gaps: z.array(z.string()),
  sources: z.array(MeetingDraftSourceSchema),
  left_out: z.number().int().min(0),
  /** Where sources disagreed, and how each was settled (#4935). */
  conflicts: z.array(MeetingDraftConflictSchema).default([]),
  /**
   * What the draft carried from earlier minutes, and where each stands
   * tonight (#5477). Empty on a draft with no earlier minutes to read, and
   * on one written before this.
   */
  follow_ups: z.array(MeetingDraftFollowUpSchema).default([]),
});
export type MeetingDraftReview = z.infer<typeof MeetingDraftReviewSchema>;

export const EMPTY_MEETING_DRAFT_REVIEW: MeetingDraftReview = Object.freeze({
  gaps: [],
  sources: [],
  left_out: 0,
  conflicts: [],
  follow_ups: [],
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
  review: Pick<MeetingDraftReview, "sources"> | null | undefined,
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

/**
 * Whose line a drafted item came from ("Sam Abernathy", "Recording"), while
 * its text is still the drafted text; null on a draft from before several
 * note-takers, or once the officer rewrites the item.
 */
export function meetingDraftSourceFor(
  review: Pick<MeetingDraftReview, "sources"> | null | undefined,
  kind: MeetingDraftSource["kind"],
  text: string,
): string | null {
  const wanted = text.trim();
  if (!review || !wanted) return null;
  return (
    review.sources.find(
      (source) => source.kind === kind && source.text === wanted,
    )?.from ?? null
  );
}
