import type { ChatReportReason, ChatReportStatus } from "@repo/hooks";
import { formatLocaleDate, parseInstant } from "@repo/formatting";

/**
 * Words for the officer report queue (`chat-reports-card.tsx`), in one module
 * so the card and its spec read the same strings. The approved state copy is
 * `spec/ui/design-system/writing.md` §7 "Chat Admin — reported messages".
 *
 * **This is copy, not a status vocabulary.** It exports no `*Kind` mapper and
 * does not join `components/shared/status-kind.spec.ts`'s `MAPPERS`: the card
 * badges the *reason*, which is metadata (the Hairline `outline` kind), and the
 * status is the tab the row sits under rather than a badge on it.
 */

/**
 * One label per `CreateChatReportDto.reason`. Typed as a total `Record` so a
 * reason the API adds is a compile error here rather than a raw token in the
 * queue.
 */
export const CHAT_REPORT_REASON_LABEL: Record<ChatReportReason, string> = {
  spam: "Spam",
  harassment: "Harassment",
  hate: "Hate speech",
  violence: "Violence or threats",
  sexual: "Sexual content",
  self_harm: "Self-harm",
  other: "Other",
};

export type ChatReportTab = {
  status: ChatReportStatus;
  /** The tab's label. A segmented option, not a CTA (`writing.md` §2). */
  label: string;
  /** "Dismissed by …" on a resolved row. Unused on `open`. */
  resolvedVerb: string;
  emptyTitle: string;
  emptyDescription: string;
};

/** Open first: it is the queue, and the other three are its history. */
export const CHAT_REPORT_TABS: readonly ChatReportTab[] = [
  {
    status: "open",
    label: "Open",
    resolvedVerb: "",
    emptyTitle: "No open reports",
    emptyDescription:
      "When a member reports a message, it lands here for officers to review.",
  },
  {
    status: "reviewed",
    label: "Reviewed",
    resolvedVerb: "Reviewed",
    emptyTitle: "No reviewed reports",
    emptyDescription: "Reports marked reviewed are kept here.",
  },
  {
    status: "actioned",
    label: "Actioned",
    resolvedVerb: "Actioned",
    emptyTitle: "No actioned reports",
    emptyDescription: "Reports whose message was removed are kept here.",
  },
  {
    status: "dismissed",
    label: "Dismissed",
    resolvedVerb: "Dismissed",
    emptyTitle: "No dismissed reports",
    emptyDescription: "Reports you dismiss are kept here.",
  },
];

export const chatReportCopy = {
  title: "Reported messages",
  description:
    "Messages members have reported, as they read when reported. Who reported them is never shown.",
  openHint:
    "Mark reviewed and Dismiss close a report and leave the message up. Only an open report can remove its message.",
  loading: "Loading reports...",
  errorTitle: "Couldn't load reports",
  errorDescription: "Confirm your chapter access and retry.",
  offlineTitle: "Reports unavailable offline",
  offlineDescription: "Reconnect to review reported messages.",
  noChapterTitle: "No chapter selected",
  noChapterDescription: "Pick an active chapter to review its reports.",
  deniedDescription:
    "Reviewing reported messages needs the members:view and channels:manage permissions. Ask your chapter president to grant access.",
  noContent: "This message had no text.",
  detailsLabel: "Reporter's note",
  messageGone: "The message no longer exists, so there's nothing to remove.",
  messageAlreadyDeleted:
    "The sender already deleted this message, so there's nothing to remove.",
  offlineWrite: "Reconnect to make changes.",
  removeConfirm: {
    title: "Remove this message?",
    description:
      "This removes this one message for everyone and marks the report actioned. Nothing else in the conversation changes, and a direct message stays private: officers can't open it. This cannot be undone.",
    confirmLabel: "Remove message",
  },
  toast: {
    reviewed: "Report marked reviewed.",
    dismissed: "Report dismissed.",
    removed: "Message removed. The report is marked actioned.",
    reviewedFailed: "Couldn't mark the report reviewed.",
    dismissedFailed: "Couldn't dismiss the report.",
    removeFailed: "Couldn't remove the message.",
  },
} as const;

const SECOND = 1_000;
const MINUTE = 60 * SECOND;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;
/** Past this a relative age stops helping, and a date says more. */
const RELATIVE_LIMIT = 30 * DAY;

/**
 * How long ago a report was filed or resolved: "5 minutes ago", "yesterday".
 *
 * Takes `now` rather than reading the clock so it is pure — the card feeds it
 * `useNow()`, which is legal to read during render and ticks every 30s. A
 * timestamp in the future (client clock behind the server's) reads as "just
 * now" rather than "in 2 minutes".
 */
export function reportAge(value: string, now: number): string {
  const instant = parseInstant(value);
  if (!instant) return "";
  const elapsed = Math.max(0, now - instant.getTime());
  if (elapsed < MINUTE) return "just now";
  if (elapsed >= RELATIVE_LIMIT) return formatLocaleDate(value);
  const format = new Intl.RelativeTimeFormat(undefined, { numeric: "auto" });
  if (elapsed < HOUR)
    return format.format(-Math.floor(elapsed / MINUTE), "minute");
  if (elapsed < DAY) return format.format(-Math.floor(elapsed / HOUR), "hour");
  return format.format(-Math.floor(elapsed / DAY), "day");
}
