import { z } from "zod";
import { askLeftOutLine } from "./ask";

/**
 * Catch me up (#3946, `spec/behavior/ai.md` § Catch me up): a member asks for
 * the short version of a channel's new messages, or of one thread, and gets a
 * few points, each tied to the message it came from.
 *
 * The request, the answer and the words both clients show are defined once,
 * here. The answer is plain JSON, not a stream: a summary is short, and
 * nothing in it stands until the server has checked every point's quote
 * against its message, so there is no honest preview to stream.
 *
 * The same forward-compatibility rules as Ask's format: a reader ignores a
 * key it does not know, shows a point of a `kind` it does not know under the
 * last group, and treats a `status` or `reason` it does not know as "not
 * available".
 */

/** A stretch with fewer readable messages than this is not summarized. */
export const CHAT_CATCH_UP_MIN_MESSAGES = 5;
/** The most messages one summary reads: the newest ones of a longer stretch. */
export const CHAT_CATCH_UP_MAX_MESSAGES = 300;
/** How far back a stretch may start. */
export const CHAT_CATCH_UP_MAX_DAYS = 30;
/** The most points a summary holds. */
export const CHAT_CATCH_UP_MAX_POINTS = 12;
/**
 * A channel opened with at least this many new messages offers the summary
 * above the timeline. Fewer is quicker to read than to summarize.
 */
export const CHAT_CATCH_UP_OFFER_AT = 20;
/** The largest unread count a request may name. */
export const CHAT_CATCH_UP_MAX_UNREAD = 5000;

/**
 * `POST /v1/ai/catch-up`. Exactly one of `thread_root_id`, `since` and
 * `unread` says what to read:
 *
 * - `thread_root_id`: one thread, its first message and every reply.
 * - `since`: the channel's messages from that moment on.
 * - `unread`: the stretch that was new when the member opened the channel.
 *   Opening a channel marks it read, so by the time a member asks, the
 *   server's read marker has moved. The client says how many messages were
 *   new and when it opened the channel, and the server finds where that
 *   stretch starts.
 */
export const ChatCatchUpRequestSchema = z
  .object({
    channel_id: z.uuid(),
    thread_root_id: z.uuid().optional(),
    since: z.iso.datetime({ offset: true }).optional(),
    unread: z
      .object({
        count: z.number().int().min(1).max(CHAT_CATCH_UP_MAX_UNREAD),
        as_of: z.iso.datetime({ offset: true }),
      })
      .optional(),
  })
  .refine(
    (request) =>
      [request.thread_root_id, request.since, request.unread].filter(
        (part) => part !== undefined,
      ).length === 1,
    { message: "Give exactly one of thread_root_id, since and unread." },
  );
export type ChatCatchUpRequest = z.infer<typeof ChatCatchUpRequestSchema>;

/**
 * What a point is, which is also the order the groups are shown in.
 *
 * - `for_you`: something asked of, assigned to or owed by the reader.
 * - `decision`: something the conversation settled.
 * - `date`: a deadline, a time or a reminder that applies to the channel.
 * - `topic`: something discussed that fits none of the above.
 */
export const CHAT_CATCH_UP_POINT_KINDS = [
  "for_you",
  "decision",
  "date",
  "topic",
] as const;
export type ChatCatchUpPointKind = (typeof CHAT_CATCH_UP_POINT_KINDS)[number];

/**
 * How a request ended.
 *
 * - `summarized`: `points` stands; every point's quote is in its message.
 * - `nothing_new`: the stretch holds no messages.
 * - `too_little`: it holds too few messages the summary may read to be worth
 *   shortening. `left_out_messages` says whether consent is why.
 * - `not_found`: the model wrote nothing a message backs.
 * - `refused`: the model provider declined.
 * - `unavailable`: nothing was attempted; `reason` says why.
 */
export const CHAT_CATCH_UP_STATUSES = [
  "summarized",
  "nothing_new",
  "too_little",
  "not_found",
  "refused",
  "unavailable",
] as const;
export type ChatCatchUpStatus = (typeof CHAT_CATCH_UP_STATUSES)[number];

export const CHAT_CATCH_UP_UNAVAILABLE_REASONS = [
  /** The member has not said yes on the AI sheet. Show the sheet. */
  "consent_required",
  /** The president has Ask and summaries turned off. */
  "chapter_off",
  /** The president has not turned on channel messages as a source. */
  "chat_off",
  "chapter_limit",
  "member_limit",
  "not_available",
] as const;
export type ChatCatchUpUnavailableReason =
  (typeof CHAT_CATCH_UP_UNAVAILABLE_REASONS)[number];

const ChatCatchUpPointSchema = z.object({
  kind: z.string(),
  /** One sentence, plain text. */
  text: z.string(),
  /** The message the point rests on, which the point opens. */
  message_id: z.string(),
  /** Set when that message is a thread reply: the thread to open. */
  thread_root_id: z.string().nullable(),
  /** Who wrote it, for the client to name from its roster. */
  author_id: z.string().nullable(),
  /** When it was sent (ISO). */
  sent_at: z.string(),
  /** The words of that message the point rests on, checked by the server. */
  quote: z.string(),
});
export type ChatCatchUpPoint = z.infer<typeof ChatCatchUpPointSchema>;

export const ChatCatchUpSchema = z.object({
  status: z.string(),
  reason: z.string().nullable(),
  points: z.array(ChatCatchUpPointSchema),
  /** Messages the summary read. */
  messages_read: z.number(),
  /**
   * Messages in the stretch that the summary could have read: more than
   * `messages_read` when the stretch was longer than one summary reads.
   */
  messages_total: z.number(),
  /** Messages left out because their author has not agreed. Never whose. */
  left_out_messages: z.number(),
  /** Points dropped because their quote was not in the message they named. */
  unverified_points: z.number(),
  /** When the oldest and newest message read were sent, or null with none. */
  covers_from: z.string().nullable(),
  covers_to: z.string().nullable(),
  /**
   * This summary's id, for "Report this" (`ai-report.ts`, subject
   * `chat_summary`). Set only when `points` stands; nothing is stored under
   * it unless the member reports the summary.
   */
  summary_id: z.string().nullish(),
  /**
   * The exchange, sealed by the server and opaque to clients, handed back
   * unchanged with a report. Null when the server cannot keep reported text
   * (no sealing key).
   */
  report_receipt: z.string().nullish(),
});
export type ChatCatchUp = z.infer<typeof ChatCatchUpSchema>;

/** The ranges a member can pick when the channel had nothing new. */
export const CHAT_CATCH_UP_RANGES = ["unread", "day", "week"] as const;
export type ChatCatchUpRange = (typeof CHAT_CATCH_UP_RANGES)[number];

export const CHAT_CATCH_UP_COPY = {
  name: "Catch me up",
  close: "Close the summary",
  /** Under the title: who sees it and what becomes of it. */
  private: "Only you can see this. It isn't saved.",
  thread_title: "Catch me up on this thread",
  thread_action: "Summarize thread",
  ranges: {
    unread: "New messages",
    day: "Last 24 hours",
    week: "Last 7 days",
  } satisfies Record<ChatCatchUpRange, string>,
  range_label: "What to summarize",
  start: "Summarize",
  again: "Summarize again",
  working: "Reading the conversation",
  groups: {
    for_you: "For you",
    decision: "Decided",
    date: "Dates and reminders",
    topic: "Also discussed",
  } satisfies Record<ChatCatchUpPointKind, string>,
  open_message: "Open the message",
  nothing_new: "There are no messages here in that time.",
  not_found:
    "The summary couldn't be matched to the messages, so it isn't shown. Try again, or read the conversation.",
  refused: "This conversation can't be summarized.",
  failed: "That didn't go through. Try again.",
  try_again: "Try again",
  unverified:
    "Part of the summary could not be matched to a message and was left out.",
  consent_action: "Answer the AI question",
  unavailable: {
    consent_required: "Answer the AI question in Settings to use summaries.",
    chapter_off: "Your chapter's president has turned summaries off.",
    chat_off:
      "Your chapter's president hasn't turned on channel messages for AI, so there is nothing a summary may read.",
    chapter_limit:
      "Your chapter has used its AI allowance for this month. Summaries come back on the 1st.",
    member_limit:
      "You've reached today's limit for AI. Summaries come back tomorrow.",
    not_available: "Summaries aren't available right now. Try again later.",
  } satisfies Record<ChatCatchUpUnavailableReason, string>,
  /** The strip above a channel opened with many new messages. */
  offer_action: "Catch me up",
  offer_dismiss: "Dismiss",
} as const;

function count(n: number, one: string, many: string): string {
  return `${n.toLocaleString("en-US")} ${n === 1 ? one : many}`;
}

/** "140 new messages since you were last here." */
export function chatCatchUpOfferLine(unread: number): string {
  return `${count(unread, "new message", "new messages")} since you were last here.`;
}

/** A group's heading, or the last group's for a kind this build does not know. */
export function chatCatchUpGroupOf(kind: string): ChatCatchUpPointKind {
  return (CHAT_CATCH_UP_POINT_KINDS as readonly string[]).includes(kind)
    ? (kind as ChatCatchUpPointKind)
    : "topic";
}

/** What an unavailable summary says, with a fallback for an unknown reason. */
export function chatCatchUpUnavailableLine(reason: string | null): string {
  return (
    (CHAT_CATCH_UP_COPY.unavailable as Record<string, string>)[reason ?? ""] ??
    CHAT_CATCH_UP_COPY.unavailable.not_available
  );
}

/**
 * Why a stretch was not worth summarizing. With messages left out, it says
 * so: the member should know consent, not silence, is why.
 */
export function chatCatchUpTooLittleLine(
  summary: Pick<ChatCatchUp, "messages_read" | "left_out_messages">,
): string {
  const readable = summary.messages_read;
  if (summary.left_out_messages > 0) {
    return readable === 0
      ? "None of the messages here can be summarized."
      : `Only ${count(readable, "message", "messages")} here can be summarized, which is too few to shorten.`;
  }
  return `There ${readable === 1 ? "is" : "are"} only ${count(readable, "message", "messages")} here, so there is nothing to shorten.`;
}

/**
 * The lines under a summary, each only when true: what was read, what was
 * not, and what was dropped.
 */
export function chatCatchUpNotes(
  summary: Pick<
    ChatCatchUp,
    | "status"
    | "messages_read"
    | "messages_total"
    | "left_out_messages"
    | "unverified_points"
  >,
): string[] {
  const notes: string[] = [];
  if (summary.status === "summarized") {
    notes.push(
      summary.messages_total > summary.messages_read
        ? `From the most recent ${summary.messages_read.toLocaleString("en-US")} of ${count(summary.messages_total, "message", "messages")}.`
        : `From ${count(summary.messages_read, "message", "messages")}.`,
    );
    if (summary.unverified_points > 0) {
      notes.push(CHAT_CATCH_UP_COPY.unverified);
    }
  }
  if (summary.left_out_messages > 0) {
    notes.push(askLeftOutLine(summary.left_out_messages));
  }
  return notes;
}

/** The request for a range picked in the panel, as of `now`. */
export function chatCatchUpSince(
  range: Exclude<ChatCatchUpRange, "unread">,
  now: Date,
): string {
  const hours = range === "day" ? 24 : 24 * 7;
  return new Date(now.getTime() - hours * 3_600_000).toISOString();
}

/**
 * When a point's message was sent, written out where the reader is:
 * "Today, 5:00 PM", otherwise "Tuesday, November 10, 5:00 PM", with the year
 * when it is not this one. No short forms, per the product's date rule.
 */
export function chatCatchUpWhen(iso: string, now: Date): string {
  const at = new Date(iso);
  if (Number.isNaN(at.getTime())) return "";
  const clock = at.toLocaleTimeString("en-US", {
    hour: "numeric",
    minute: "2-digit",
  });
  const sameDay =
    at.getFullYear() === now.getFullYear() &&
    at.getMonth() === now.getMonth() &&
    at.getDate() === now.getDate();
  if (sameDay) return `Today, ${clock}`;
  const day = at.toLocaleDateString("en-US", {
    weekday: "long",
    month: "long",
    day: "numeric",
    ...(at.getFullYear() === now.getFullYear() ? {} : { year: "numeric" }),
  });
  return `${day}, ${clock}`;
}
