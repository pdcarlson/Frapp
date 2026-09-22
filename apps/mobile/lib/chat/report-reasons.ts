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
 * Where a report goes, stated as far as it is true today. The API files it into
 * the chapter's moderation queue (readable by `channels:manage` holders) and
 * strips the reporter from everything it serves — so this promises neither a
 * reviewer nor a response time.
 */
export const REPORT_SENT_TITLE = "Report sent";
export const REPORT_SENT_BODY =
  "It's in your chapter's moderation queue. Reports don't show who filed them.";

export const REPORT_FAILED_BODY =
  "Your report didn't send. Check your connection and try again.";
