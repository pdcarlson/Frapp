import { z } from "zod";
import type { AiReportReason } from "./ai-report";

/**
 * A member's thumbs on an Ask answer, and the taps that say how an answer
 * landed (#4902, `spec/behavior/ai.md` § Feedback on an answer). Defined
 * once, here, for the API that checks it and for web and mobile that send
 * it, so the reasons and the words cannot drift between clients.
 *
 * None of it carries text. A thumbs is a rating and, on a down, one of four
 * reasons; a signal is one word from a closed set. The words of the question
 * and the answer are kept only when the member then chooses to send them,
 * through Report this and its own confirmation ({@link ASK_FEEDBACK_COPY}
 * `.send`).
 */

export const ASK_FEEDBACK_RATINGS = ["up", "down"] as const;
export type AskFeedbackRating = (typeof ASK_FEEDBACK_RATINGS)[number];

/** Why a thumbs down, in one tap. */
export const ASK_FEEDBACK_REASONS = [
  "wrong",
  "missed",
  "too_long",
  "other",
] as const;
export type AskFeedbackReason = (typeof ASK_FEEDBACK_REASONS)[number];

/** How long a turn's trace, and the thumbs on it, are kept. */
export const ASK_TRACE_RETENTION_DAYS = 90;

/** `PUT /v1/ai/ask/{ask_id}/feedback`. Sending it again changes the answer. */
export const AskFeedbackRequestSchema = z
  .object({
    rating: z.enum(ASK_FEEDBACK_RATINGS),
    /** With a `down` only. A down may be sent first and its reason after. */
    reason: z.enum(ASK_FEEDBACK_REASONS).nullish(),
  })
  .refine((value) => value.rating === "down" || value.reason == null, {
    path: ["reason"],
    message: "A reason goes with a thumbs down only.",
  });
export type AskFeedbackRequest = z.infer<typeof AskFeedbackRequestSchema>;

/** What the server holds for one answer, as it answers the PUT. */
export const AskFeedbackSchema = z.object({
  ask_id: z.string(),
  rating: z.enum(ASK_FEEDBACK_RATINGS),
  reason: z.string().nullable(),
  updated_at: z.string(),
});
export type AskFeedback = z.infer<typeof AskFeedbackSchema>;

/**
 * Taps under an answer that say something about it without a word of it.
 * Counted as analytics events only; no row is kept.
 *
 * - `retried`: Try again on this answer.
 * - `think_harder`: asked for the same question with more effort.
 * - `source_opened`: a source chip under the answer was opened.
 * - `card_confirmed` / `card_dismissed`: a card this answer proposed was
 *   confirmed or dismissed.
 *
 * "Asked again within a minute" is not here: the server sees that itself.
 */
export const ASK_SIGNALS = [
  "retried",
  "think_harder",
  "source_opened",
  "card_confirmed",
  "card_dismissed",
] as const;
export type AskSignal = (typeof ASK_SIGNALS)[number];

/** `POST /v1/ai/ask/{ask_id}/signals`. */
export const AskSignalRequestSchema = z.object({
  signal: z.enum(ASK_SIGNALS),
});
export type AskSignalRequest = z.infer<typeof AskSignalRequestSchema>;

/**
 * The reason Report this starts on when it is opened from a thumbs down, so
 * the member does not pick twice. Report this has its own, different list
 * (it also covers harmful and private); only "wrong" is in both.
 */
export function askFeedbackReportReason(
  reason: string | null | undefined,
): AiReportReason {
  return reason === "wrong" ? "wrong" : "other";
}

/** The words both clients show. */
export const ASK_FEEDBACK_COPY = {
  /** Accessible names for the two buttons; they are drawn as icons. */
  up: "Good answer",
  down: "Bad answer",
  /** Shown once a thumbs is in; tapping the same thumb again takes it back. */
  thanks: "Thanks for the feedback.",
  prompt: "What went wrong?",
  reasons: {
    wrong: "It's wrong",
    missed: "It missed something",
    too_long: "It's too long",
    other: "Something else",
  } satisfies Record<AskFeedbackReason, string>,
  /**
   * After a thumbs down. The thumbs itself sends none of the words; this
   * opens Report this, whose sheet says what is attached and for how long
   * before anything is sent.
   */
  send: {
    line: "Your rating doesn't include the question or the answer.",
    action: "Send this answer to the Frapp team",
    dismiss: "Not now",
  },
  failed: "Your feedback didn't send. Check your connection and try again.",
} as const;

/** A reason's label, with a fallback for one this build does not know. */
export function askFeedbackReasonLabel(reason: string): string {
  return (
    (ASK_FEEDBACK_COPY.reasons as Record<string, string>)[reason] ??
    ASK_FEEDBACK_COPY.reasons.other
  );
}
