import type { ChatReportReason, ChatReportStatus } from "@repo/hooks";
import {
  formatLocaleDate,
  formatLocaleDateTime,
  parseInstant,
} from "@repo/formatting";

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

/**
 * The removal's confirmation, which names the message it removes.
 *
 * The two sentences about the sender are the trade-off the owner accepted with
 * report-scoped removal (#2311, option 1, 2026-09-22), said before the officer
 * commits rather than discovered after: the sender sees their message replaced,
 * and in a 1:1 DM the only other reader is who must have reported it
 * (`spec/behavior/chat/README.md` § Officer action). The dialog cannot say
 * whether this message is in a DM — the report snapshots the message, not its
 * channel — so the second sentence is conditional.
 */
const REMOVE_CONFIRM_BODY =
  "This removes this one message for everyone and marks the report actioned. Nothing else in the conversation changes, and a direct message stays private: officers can't open it. The sender will see this message was removed. In a direct message they may be able to tell who reported it. This cannot be undone.";

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
  /**
   * Restates `CHAT_REPORT_QUEUE_PERMISSIONS` (`@repo/validation`) in words;
   * `chat-report-copy.spec.ts` fails if it stops naming one of them.
   */
  deniedDescription:
    "Reviewing reported messages needs the members:view and channels:manage permissions. Ask your chapter president to grant access.",
  noContent: "This message had no text.",
  detailsLabel: "Reporter's note",
  /**
   * An open report whose message was hard-deleted (`message_id` is null — a
   * channel delete, or the import purge). There is nothing to remove, so the
   * row offers Mark actioned instead. Says what happened, not who did it.
   */
  messageGone:
    "This message no longer exists, so there's nothing to remove. Mark actioned to close the report.",
  offlineWrite: "Reconnect to make changes.",
  removeConfirm: {
    /** Names the author, so the dialog says which message it removes. */
    title: (author: string) => `Remove the message from ${author}?`,
    description: (content: string | null | undefined) => {
      const excerpt = messageExcerpt(content);
      return excerpt
        ? `It reads “${excerpt}”. ${REMOVE_CONFIRM_BODY}`
        : REMOVE_CONFIRM_BODY;
    },
    confirmLabel: "Remove message",
  },
  toast: {
    reviewed: "Report marked reviewed.",
    dismissed: "Report dismissed.",
    actioned: "Report marked actioned.",
    removed: "Message removed. The report is marked actioned.",
    /**
     * The removal succeeded but the message was already gone
     * (`message_already_deleted`). Neutral on purpose: its sender, another
     * officer, or an earlier attempt could have removed it, and the queue
     * cannot tell which.
     */
    alreadyRemoved:
      "This message was already removed. The report is marked actioned.",
    reviewedFailed: "Couldn't mark the report reviewed.",
    dismissedFailed: "Couldn't dismiss the report.",
    actionedFailed: "Couldn't mark the report actioned.",
    /**
     * A 5xx or a transport failure on Mark reviewed / Dismiss / Mark actioned.
     * The PATCH is a conditional update that may have committed before its
     * answer was lost, so, like `removeUnconfirmed`, these say the
     * outcome is unknown rather than that it failed. The queue refetches
     * either way (`useResolveChatReport`'s `onSettled`), and a retry of one
     * that landed is answered 409, never applied twice.
     */
    reviewedUnconfirmed:
      "Couldn't confirm the report was marked reviewed. It may have gone through anyway. Refresh to check, and retry if the report is still open.",
    dismissedUnconfirmed:
      "Couldn't confirm the report was dismissed. It may have gone through anyway. Refresh to check, and retry if the report is still open.",
    actionedUnconfirmed:
      "Couldn't confirm the report was marked actioned. It may have gone through anyway. Refresh to check, and retry if the report is still open.",
    removeFailed: "Couldn't remove the message.",
    /**
     * A 5xx or a transport failure on the removal: the outcome is unknown, and
     * the removal may have landed (a response lost after the delete, or a
     * failure closing the other reports on the message after it). So it says
     * so, and how to find out, rather than "couldn't remove". A retry is safe
     * either way — the route is idempotent, and answers "already removed".
     */
    removeUnconfirmed:
      "Couldn't confirm the removal. The message may have been removed anyway. Refresh to check, and retry if the report is still open.",
  },
} as const;

/** Long enough to tell two reports by the same member apart, short enough to read aloud. */
const EXCERPT_LENGTH = 40;

/**
 * The start of a report's snapshot, whitespace collapsed, for an accessible
 * name or the confirmation. Null when the message had no text.
 */
export function messageExcerpt(
  content: string | null | undefined,
): string | null {
  const text = content?.replace(/\s+/g, " ").trim();
  if (!text) return null;
  // Counted in code points, not UTF-16 units, so the cut never splits an
  // emoji's surrogate pair and leaves half a character in an accessible name.
  const chars = Array.from(text);
  if (chars.length <= EXCERPT_LENGTH) return text;
  return `${chars
    .slice(0, EXCERPT_LENGTH - 1)
    .join("")
    .trimEnd()}…`;
}

/**
 * "message from Harper Lane, “You should quit the chapter…”" — what a row's
 * controls act on, so each control's accessible name says which message it
 * is for. Every row carries the same four verbs; without this a screen
 * reader's button list is a column of identical "Dismiss"es.
 */
export function reportedMessageSubject(
  author: string,
  content: string | null | undefined,
): string {
  const excerpt = messageExcerpt(content);
  return excerpt
    ? `message from ${author}, “${excerpt}”`
    : `message from ${author} with no text`;
}

/**
 * "Harassment, reported 9/22/2026, 11:55:00 AM, with a reporter's note" — what
 * tells one **report** apart from another on the same message.
 *
 * The subject alone names the message, and two members can report one message:
 * two rows then share an author and an excerpt, and two messages with no text
 * from one author share a subject outright. The reason, when it was filed and
 * whether the reporter left a note are what the rows differ by, so the names
 * carry them too.
 *
 * The time is the absolute one the row's "Reported …" text shows on hover
 * (`formatLocaleDateTime`), not the relative age: "5 minutes ago" is shared by
 * every report filed that minute, and would rename the controls on every tick.
 * An unparseable timestamp leaves it out rather than reading "reported —".
 * Two reports can still match on all of it; {@link reportDistinctions} numbers
 * those.
 */
export function reportDistinction(report: {
  reason: ChatReportReason;
  createdAt: string;
  hasNote: boolean;
}): string {
  const parts: string[] = [CHAT_REPORT_REASON_LABEL[report.reason]];
  if (parseInstant(report.createdAt)) {
    parts.push(`reported ${formatLocaleDateTime(report.createdAt)}`);
  }
  if (report.hasNote) parts.push("with a reporter's note");
  return parts.join(", ");
}

/**
 * Each row's {@link reportDistinction}, made unique across the list.
 *
 * Rows whose subject and distinction still match — the same message, reason
 * and second, both with or both without a note — get "report 2 of 3" appended,
 * numbered in list order, so no two controls in the queue share a name. A row
 * that is already unique is left as it is.
 */
export function reportDistinctions(
  rows: readonly { subject: string; distinction: string }[],
): string[] {
  const key = (row: { subject: string; distinction: string }) =>
    `${row.subject}\u0000${row.distinction}`;
  const totals = new Map<string, number>();
  for (const row of rows) totals.set(key(row), (totals.get(key(row)) ?? 0) + 1);
  const seen = new Map<string, number>();
  return rows.map((row) => {
    const total = totals.get(key(row)) ?? 1;
    if (total === 1) return row.distinction;
    const position = (seen.get(key(row)) ?? 0) + 1;
    seen.set(key(row), position);
    return `${row.distinction}, report ${position} of ${total}`;
  });
}

/**
 * Accessible names for a row's controls. Each starts with the visible label so
 * speech input ("click Dismiss") still finds it (WCAG 2.5.3, label in name),
 * then names the message ({@link reportedMessageSubject}) and the report
 * ({@link reportDistinction}) — the `Delete ${role.label}` convention the
 * roles table uses, with the report's own details in parentheses.
 */
export const chatReportActionLabel = {
  reviewed: (subject: string, report: string) =>
    `Mark reviewed: report on ${subject} (${report})`,
  dismissed: (subject: string, report: string) =>
    `Dismiss report on ${subject} (${report})`,
  actioned: (subject: string, report: string) =>
    `Mark actioned: report on ${subject} (${report})`,
  remove: (subject: string, report: string) => `Remove ${subject} (${report})`,
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
