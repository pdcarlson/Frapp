import { statusOf } from "@repo/api-sdk";
import { CHAT_REPORT_REASONS, type ChatReportReason } from "@repo/hooks";

/**
 * Member-facing labels for the reasons `POST /v1/chat/reports` accepts.
 *
 * A `Record` over the SDK's union, so a reason the API adds is a compile error
 * here rather than a picker row with no label. The order is the hook's
 * `CHAT_REPORT_REASONS`, most specific first and "Something else" last.
 */
export const REPORT_REASON_LABELS: Record<ChatReportReason, string> = {
  harassment: "Harassment or bullying",
  hate: "Hate speech",
  violence: "Violence or threats",
  sexual: "Sexual content",
  self_harm: "Self-harm or suicide",
  spam: "Spam",
  other: "Something else",
};

export const REPORT_REASON_OPTIONS = CHAT_REPORT_REASONS.map((reason) => ({
  reason,
  label: REPORT_REASON_LABELS[reason],
}));

/**
 * Where a report goes, stated as far as it is true in every channel type. The
 * API files it into the chapter's moderation queue, readable by `channels:manage`
 * holders — the chapter's officers — and never tells the reported member. It
 * does not promise a reviewer or a response time, and it does not claim the
 * reporter is hidden from the officers who read the queue.
 */
export const REPORT_SENT_TITLE = "Report sent";
export const REPORT_SENT_BODY =
  "Your chapter's officers can see this report. The member you reported isn't told.";

/**
 * The API keeps one open report per member per message and hands the first one
 * back to a second attempt, so nothing new was filed (`alreadyReported` from
 * `useReportMessage`). "Report sent" would claim a second report.
 */
export const REPORT_ALREADY_TITLE = "Already reported";
export const REPORT_ALREADY_BODY =
  "You already reported this message, and that report is still open. Your chapter's officers can see it.";

export const REPORT_FAILED_TITLE = "Couldn't send your report";
export const REPORT_FAILED_BODY =
  "Your report didn't send. Check your connection and try again.";

/**
 * A refusal that trying again cannot change. `POST /v1/chat/reports` authorizes
 * a report as a read of the message's channel (`ChatReportService.fileReport`):
 * 403 when the member can no longer read that channel (removed from a private
 * channel or a DM), 404 when the message is gone or is not in their chapter.
 * "Check your connection" would send them round a loop that cannot succeed.
 */
export const REPORT_UNAVAILABLE_BODY =
  "This message can't be reported anymore. It may have been deleted, or you may no longer have access to where it was posted.";

/**
 * What a failed report says, by status: a permanent refusal (403 / 404) gets
 * {@link REPORT_UNAVAILABLE_BODY}; anything else — no response at all, a 5xx —
 * is worth another try and gets {@link REPORT_FAILED_BODY}.
 */
export function reportFailureBody(error: unknown): string {
  const status = statusOf(error);
  return status === 403 || status === 404
    ? REPORT_UNAVAILABLE_BODY
    : REPORT_FAILED_BODY;
}
