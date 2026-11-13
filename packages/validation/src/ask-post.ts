/**
 * An Ask Frapp answer posted to a channel (#4713, `spec/behavior/ai.md`
 * § Posting an answer to the channel): the request, what the server says back, the posted
 * row's payload, and the words both clients show.
 *
 * Every answer comes to its asker first, and only the asker's answer row
 * offers to post it. The server checks, when it is posted and not before,
 * whether everyone who can read the channel could open what the answer drew
 * on, and the asker is told what they could not before anything is written.
 */
import { z } from "zod";
import { AI_REPORT_RECEIPT_MAX_LENGTH } from "./ai-report";
import type { AskSourceKind } from "./ask";

/** The `chat_messages.kind` of a posted answer. */
export const ASK_ANSWER_KIND = "ask_answer";

export const ASK_POSTED_ANSWER_VERSION = 1;

/** How long after an answer it may still be posted. */
export const ASK_POST_MAX_AGE_MS = 24 * 60 * 60 * 1000;

/** `POST /v1/ai/ask/posts`. */
export const AskPostRequestSchema = z.object({
  channel_id: z.string().uuid(),
  /** The answer's `report_receipt`, exactly as the server sent it. */
  receipt: z.string().min(1).max(AI_REPORT_RECEIPT_MAX_LENGTH),
  /**
   * False asks only what posting would show and warn about: nothing is
   * written. True posts, when `acknowledged` covers every warning.
   */
  confirm: z.boolean(),
  /** The `key` of each warning the asker was shown and accepted. */
  acknowledged: z.array(z.string().max(200)).max(100).optional(),
});
export type AskPostRequest = z.infer<typeof AskPostRequestSchema>;

/** Something the answer drew on that not everyone in the channel can open. */
export interface AskPostRestricted {
  /** Stable for the same source, so an acknowledgement can name it. */
  key: string;
  kind: string;
  /** The source's name, or the records' ("Your tasks"). */
  title: string;
}

export interface AskPostOutcome {
  posted: boolean;
  /**
   * What not everyone in the channel can open, as of this call. With
   * `posted` false and `confirm` sent true, the list changed since the
   * asker was shown it, and they are shown this one.
   */
  restricted: AskPostRestricted[];
}

/** The refusals `POST /v1/ai/ask/posts` names, by `code`. */
export const ASK_POST_REFUSALS = {
  "ai.ask.post.receipt_invalid":
    "This answer could not be matched. Ask again, then post the new answer.",
  "ai.ask.post.too_old":
    "This answer is too old to post. Ask again, then post the new answer.",
  "ai.ask.post.not_an_answer": "Only an answer can be posted.",
  "ai.ask.post.read_chat":
    "This answer read chat messages, so it stays with you.",
  "ai.ask.post.follow_up":
    "This answer followed earlier questions, so it stays with you.",
  "ai.ask.post.already_posted": "This answer was already posted here.",
} as const;
export type AskPostRefusalCode = keyof typeof ASK_POST_REFUSALS;

/** The sentence for a refusal `code`, or null for one this build doesn't know. */
export function askPostRefusalCopy(code: string | null | undefined) {
  return code && code in ASK_POST_REFUSALS
    ? ASK_POST_REFUSALS[code as AskPostRefusalCode]
    : null;
}

const AskPostedSourceSchema = z.object({
  kind: z.string(),
  title: z.string(),
  detail: z.string().nullable(),
  date: z.string().nullable(),
  /** Null for the asker's own records: a reader's page would be their own. */
  target: z.looseObject({ type: z.string() }).nullable(),
  /** Not everyone in the channel could open it when it was posted. */
  limited: z.boolean().optional(),
  /** The asker's own records (their points, dues, tasks). */
  own: z.boolean().optional(),
});
export type AskPostedSource = z.infer<typeof AskPostedSourceSchema>;

/**
 * A posted answer's `payload`. The answer's words are the row's `content`,
 * so a build from before this kind shows them as a plain message from
 * Frapp; `at` in a citation is an offset into that `content`.
 */
export const AskPostedAnswerSchema = z.object({
  v: z.number().int(),
  ask_id: z.string(),
  /** The member who asked and posted. Written by the server. */
  asked_by: z.string(),
  question: z.string(),
  citations: z.array(
    z.object({
      source: z.number().int().min(0),
      at: z.number().int().min(0),
    }),
  ),
  sources: z.array(AskPostedSourceSchema),
  truncated: z.boolean().optional(),
});
export type AskPostedAnswer = z.infer<typeof AskPostedAnswerSchema>;

/**
 * Whether `userId` is the member who posted this Ask Frapp answer. The row
 * is the Frapp sender's, so a sender check is false for everyone; the server
 * writes who posted it in `payload.asked_by` and no client can send the
 * kind, so it is as trustworthy as `sender_id`. The API and both clients
 * read it here, so who may delete one (and may not report one) is one rule.
 */
export function isAskAnswerPostedBy(
  message: { kind?: string | null; payload?: unknown },
  userId: string | null | undefined,
): boolean {
  if (!userId || message.kind !== ASK_ANSWER_KIND) return false;
  const payload = message.payload;
  return (
    typeof payload === "object" &&
    payload !== null &&
    (payload as { asked_by?: unknown }).asked_by === userId
  );
}

/** A posted answer's payload, or null for one this build can't read. */
export function readAskPostedAnswer(payload: unknown): AskPostedAnswer | null {
  const read = AskPostedAnswerSchema.safeParse(payload);
  return read.success ? read.data : null;
}

/** What the asker's own records are called to everyone else, by kind. */
const OWN_RECORDS: Partial<Record<AskSourceKind, string>> = {
  points: "points",
  dues: "dues",
  tasks: "tasks",
};

/**
 * A posted source's name as a reader sees it. The asker's own records were
 * "Your tasks" to them; to the channel they are "Sam Abernathy's tasks", or
 * "The asker's tasks" when the name is not known.
 */
export function askPostedSourceTitle(
  source: Pick<AskPostedSource, "kind" | "title" | "own">,
  askerName: string | null,
): string {
  if (!source.own) return source.title;
  const records = OWN_RECORDS[source.kind as AskSourceKind] ?? "records";
  return askerName ? `${askerName}'s ${records}` : `The asker's ${records}`;
}

/** At most this many names in the warning; the rest are counted. */
const WARNING_NAMES = 3;

/**
 * The warning's list of what not everyone can open: "Your tasks and Exec
 * minutes", "A, B, C and 2 more".
 */
export function askPostRestrictedList(
  restricted: readonly Pick<AskPostRestricted, "title">[],
): string {
  const names = restricted.slice(0, WARNING_NAMES).map((item) => item.title);
  const more = restricted.length - names.length;
  if (more > 0) return `${names.join(", ")} and ${more} more`;
  if (names.length <= 1) return names.join("");
  return `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
}

export const ASK_POST_COPY = {
  /** Under a finished answer only its asker can see. */
  action: "Post for everyone here",
  checking: "Checking who can open the sources",
  /** What posting does, said before it does it. */
  confirm: "Everyone here will see your question and this answer.",
  /** Before the list of what not everyone in the channel can open. */
  warning: "Not everyone here can open",
  /** After a warned list changed between the check and the post. */
  changed: "Who can open the sources changed. Check the list again.",
  post: "Post",
  post_anyway: "Post anyway",
  posting: "Posting",
  cancel: "Cancel",
  failed: "That didn't post. Try again.",
  /** A posted answer's heading: who asked. `name` null when unknown. */
  asked: (name: string | null) =>
    name ? `${name} asked Frapp` : "A member asked Frapp",
  /** Under a posted answer's sources when some were not open to everyone. */
  limited: "Some of these may not open for you.",
  /** A reply preview and the like, where the card can't be drawn. */
  label: "Answer from Frapp",
} as const;
