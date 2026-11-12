import { z } from "zod";

/**
 * Report this (#4315, `spec/behavior/ai.md` § Stored AI text): a member flags
 * something the AI made (an Ask answer, a drafted set of minutes, a
 * suggested task, a channel summary) for the Frapp team. Defined once, here, for the API that
 * checks it and for web and mobile that ask it, so the reasons and the words
 * about what is kept cannot drift between clients.
 *
 * A report is the one place Frapp keeps AI text: that one exchange, sealed,
 * for 30 days, read by the Frapp team only. A chapter's officers never see
 * reports.
 */

/** What a report is about. Open on the wire: a newer server may add one. */
export const AI_REPORT_SUBJECTS = [
  "ask_answer",
  "meeting_draft",
  "ai_suggestion",
  "chat_summary",
] as const;
export type AiReportSubject = (typeof AI_REPORT_SUBJECTS)[number];

/** Why. Short, like reporting a message; the note says the rest. */
export const AI_REPORT_REASONS = [
  "wrong",
  "harmful",
  "private",
  "other",
] as const;
export type AiReportReason = (typeof AI_REPORT_REASONS)[number];

/** How long a report keeps what it holds. The database refuses longer. */
export const AI_REPORT_RETENTION_DAYS = 30;

export const AI_REPORT_NOTE_MAX_LENGTH = 500;

/**
 * Ask's receipt is opaque to clients: sealed by the server, handed back
 * unchanged. Its size is bounded by what Ask can hand a model.
 */
export const AI_REPORT_RECEIPT_MAX_LENGTH = 200_000;

/** `POST /v1/ai/reports`. */
export const AiReportRequestSchema = z.object({
  subject: z.enum(AI_REPORT_SUBJECTS),
  /**
   * The ask's id, the meeting's id (for its draft), the suggestion's id, or
   * the summary's id.
   */
  subject_id: z.string().uuid(),
  reason: z.enum(AI_REPORT_REASONS),
  note: z.string().trim().max(AI_REPORT_NOTE_MAX_LENGTH).optional(),
  /**
   * An Ask answer or a channel summary: its `report_receipt`, exactly as the
   * server sent it.
   */
  receipt: z.string().min(1).max(AI_REPORT_RECEIPT_MAX_LENGTH).optional(),
});
export type AiReportRequest = z.infer<typeof AiReportRequestSchema>;

/** What each subject attaches, in the member's words. */
const ATTACHED: Record<AiReportSubject, string> = {
  ask_answer:
    "your question, the answer, and the parts of your chapter's sources the AI read to write it",
  meeting_draft:
    "the notes the draft was written from and the draft itself, as it is now",
  ai_suggestion: "the suggestion and the words it came from",
  chat_summary: "the summary and the messages the AI read to write it",
};

/** The words both clients show. */
export const AI_REPORT_COPY = {
  /** The action, on every AI-made surface. */
  action: "Report this",
  reported: "Reported",
  titles: {
    ask_answer: "Report this answer",
    meeting_draft: "Report this draft",
    ai_suggestion: "Report this suggestion",
    chat_summary: "Report this summary",
  } satisfies Record<AiReportSubject, string>,
  prompt: "What's wrong with it?",
  reasons: {
    wrong: "It's wrong or made up",
    harmful: "It's offensive or harmful",
    private: "It shows something it shouldn't",
    other: "Something else",
  } satisfies Record<AiReportReason, string>,
  note_label: "Anything to add (optional)",
  /** Who reads it. Said before the member confirms, every time. */
  who_reads:
    "Reports go to the Frapp team, who use them to fix what the AI gets wrong. Your chapter's officers don't see them.",
  send: "Send report",
  cancel: "Cancel",
  sent_title: "Report sent",
  sent_body: "Thanks. The Frapp team will look at it.",
  already_title: "Already reported",
  already_body: "You reported this already. The Frapp team has it.",
  failed: "Your report didn't send. Check your connection and try again.",
  /** A receipt older than the server accepts. */
  too_old:
    "This answer is too old to report. Ask again, then report the new answer.",
  /** A receipt this server can no longer open (its key was replaced). */
  receipt_invalid:
    "This answer can't be reported any more. Ask again, then report the new answer.",
  /** The same two, for a summary. */
  summary_too_old:
    "This summary is too old to report. Summarize again, then report the new one.",
  summary_receipt_invalid:
    "This summary can't be reported any more. Summarize again, then report the new one.",
  /** The draft or suggestion went away while the sheet was open. */
  gone: "There's nothing to report here any more. It may have been changed or removed.",
  done: "Done",
} as const;

/**
 * What is attached and for how long, said before the member confirms
 * (`ai.md` § Stored AI text: "shown to the member before they confirm").
 * `keepsText` is the server's answer: with no sealing key it keeps only
 * the reason and the note, and says so.
 */
export function aiReportAttachedLine(
  subject: AiReportSubject,
  keepsText: boolean,
): string {
  if (!keepsText) {
    return `Only your reason and note are sent, and deleted after ${AI_REPORT_RETENTION_DAYS} days. The text itself isn't kept.`;
  }
  return `Sent with your report, encrypted: ${ATTACHED[subject]}. It is deleted after ${AI_REPORT_RETENTION_DAYS} days.`;
}

/** A reason's label, with a fallback for one this build does not know. */
export function aiReportReasonLabel(reason: string): string {
  return (
    (AI_REPORT_COPY.reasons as Record<string, string>)[reason] ??
    AI_REPORT_COPY.reasons.other
  );
}
