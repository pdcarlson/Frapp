import { z } from "zod";
import { formatAiAnswerDate, joinNames } from "./ai-copy";
import { askMentionQuestion } from "./mentions";

/**
 * Ask Frapp (#450, #451, `spec/behavior/ai.md`): the request, the streamed
 * answer's event format and the words both clients show.
 *
 * The format is versioned and defined once, here, for the API that writes it
 * and for web and mobile that read it (ADR-28, Consequences). The rules that
 * let an installed mobile build keep working when the format grows:
 *
 * - Every event carries `v`. A reader takes events whose `v` it knows and
 *   ignores the rest.
 * - A reader ignores an event `type` it does not know, and a key it does not
 *   know on an event it does. So adding an event type or a key is not a new
 *   version; changing what an existing key means is.
 * - A source's `kind` and `target.type` are open strings. A reader shows a
 *   source of a kind it does not know as plain text with no link.
 * - The answer is whatever `done` carries. Text deltas are a preview of
 *   `done.answer.text`: citations, and whether the answer stands at all, are
 *   decided by the server after the model stops writing, so a reader replaces
 *   what it streamed with `done`.
 */

export const ASK_STREAM_VERSION = 1;

/** The stream is Server-Sent Events over the POST's response body. */
export const ASK_STREAM_CONTENT_TYPE = "text/event-stream";

export const ASK_QUESTION_MAX_LENGTH = 1000;

/** The earlier turns of a conversation a client sends with a question. */
export const ASK_HISTORY_MAX_TURNS = 6;
/** An earlier answer is cut to this before it is sent back. */
export const ASK_HISTORY_ANSWER_MAX_LENGTH = 2000;

/**
 * One earlier turn of the conversation: what the member typed, and what
 * Frapp answered. `answer` is empty when the turn had no answer to carry (a
 * proposal, "couldn't find that") or one that must not be sent again (it
 * drew on channel messages; see `askHistory`).
 */
export const AskHistoryTurnSchema = z.object({
  question: z.string().trim().min(1).max(ASK_QUESTION_MAX_LENGTH),
  answer: z.string().max(ASK_HISTORY_ANSWER_MAX_LENGTH),
  /**
   * True when the member did not type this turn's question: they tapped an
   * opening suggestion that names a record someone else may have written
   * (#4700). The answer call still reads the turn; the request reading, which
   * is shown only what the member typed, does not.
   */
  suggested: z.boolean().optional(),
});
export type AskHistoryTurn = z.infer<typeof AskHistoryTurnSchema>;

/**
 * The doors a question can come through (#4713): Ask's own screen (`ask`),
 * or `@Frapp` typed in a chat composer and answered to the asker alone
 * (`chat_private`). A closed set, so it can be counted without saying
 * anything about the question.
 */
export const ASK_DOORS = ["ask", "chat_private"] as const;
export type AskDoor = (typeof ASK_DOORS)[number];

/**
 * How hard Frapp should work on a question: `default`, or `more` when the
 * member asked it to think harder. Open to more levels later.
 */
export const ASK_EFFORTS = ["default", "more"] as const;
export type AskEffort = (typeof ASK_EFFORTS)[number];

/**
 * What the member had open when they asked: a channel, an event or a task.
 * At most one is expected. The server looks each up as the asker and drops
 * one they cannot open, so an id here can show nothing they could not see.
 */
export const AskFromSchema = z.object({
  channel_id: z.string().uuid().optional(),
  event_id: z.string().uuid().optional(),
  task_id: z.string().uuid().optional(),
});
export type AskFrom = z.infer<typeof AskFromSchema>;

/** `POST /v1/ai/ask`. */
export const AskRequestSchema = z.object({
  question: z.string().trim().min(1).max(ASK_QUESTION_MAX_LENGTH),
  /**
   * The conversation so far, oldest first, so "and the one after that?"
   * means something. Nothing is kept on the server between questions: the
   * client holds the conversation and sends it (`ai.md` § One conversation).
   */
  history: z.array(AskHistoryTurnSchema).max(ASK_HISTORY_MAX_TURNS).optional(),
  /**
   * The client can show a proposal card. With it, a member who may have
   * Frapp act gets a `proposal` event instead of an answer when what they
   * typed asks for something to be done. Without it the stream only ever
   * answers, which is what every build before the conversation expects.
   */
  actions: z.boolean().optional(),
  /**
   * The client draws the cards an answer comes with (`AskAnswer.proposals`),
   * so one turn can be an answer with cards under it, or several cards.
   * Read only with `actions`, and only by a server that answers through the
   * tool loop (#4899). Without it a turn comes with at most one card, sent
   * as a `proposal` event in place of the answer, which is all a build from
   * before this can draw.
   */
  answer_cards: z.boolean().optional(),
  /**
   * The client showed the "answers are being saved" line before this
   * question was sent. An exchange is kept by the beta diagnostics window
   * only when this is true, so a client that does not know about the window
   * never has an answer saved (`ai.md` § Stored AI text).
   */
  saved_notice_shown: z.boolean().optional(),
  /**
   * Where the member asked from ({@link ASK_DOORS}). Counted, never read:
   * the answer is the same from every door. Left out by builds before #4713,
   * which only have the Ask screen.
   */
  door: z.enum(ASK_DOORS).optional(),
  /**
   * What the member had open ({@link AskFromSchema}), so "this channel" and
   * "this event" mean something. Unlike `door` it is read, by a server that
   * answers through the tool loop (#4899, `AskFromService`). No build sends
   * it yet (#4904 adds it), and Ask's own screen never will.
   */
  from: AskFromSchema.nullish(),
  /** {@link ASK_EFFORTS}. Left out means `default`. */
  effort: z.enum(ASK_EFFORTS).optional(),
});
export type AskRequest = z.infer<typeof AskRequestSchema>;

/**
 * What the server is doing while a turn works, each named when it happens
 * (`ai.md` § Ask Frapp, #4701):
 *
 * - `searching`: the index is being searched and the question read for which
 *   live records it needs.
 * - `reading`: something was found, or a live read was picked, and it is
 *   being read. Carries which reads (`reads`) and how many sources the
 *   search found (`found`). Not sent when there is nothing to read.
 * - `writing`: the first word of the answer has been written.
 * - `proposing`: the member's words were read as something to do, and the
 *   card's details are being looked up.
 *
 * Open on the wire: a build shows a step it does not know as `searching`.
 */
export const ASK_STEPS = [
  "searching",
  "reading",
  "writing",
  "proposing",
] as const;
export type AskStep = (typeof ASK_STEPS)[number];

/** What a `reading` step says is being read. */
export interface AskStepDetail {
  /**
   * The live reads being made, by the read's name (`roster`, `events`,
   * `my_tasks`): open strings, and a name this build has no words for is
   * left out of the line.
   */
  reads?: readonly string[] | undefined;
  /**
   * How many sources the search found for this question: documents, minutes
   * and conversations, each counted once.
   */
  found?: number | undefined;
  /**
   * The server's own words for the read that just started ("Searching
   * #general"), from a server that answers through the tool loop. Shown as
   * the whole line when present.
   */
  label?: string | undefined;
}

/**
 * How an ask ended.
 *
 * - `answered`: `text` stands, and every citation in it was checked.
 * - `not_found`: nothing in the chapter's sources answers it, or the model
 *   wrote something no source backs. `text` is empty; show the "couldn't
 *   find that" line.
 * - `refused`: the model provider declined the question.
 * - `unavailable`: no answer was attempted; `reason` says why.
 */
export const ASK_ANSWER_STATUSES = [
  "answered",
  "not_found",
  "refused",
  "unavailable",
] as const;
export type AskAnswerStatus = (typeof ASK_ANSWER_STATUSES)[number];

export const ASK_UNAVAILABLE_REASONS = [
  /** The member has not turned Frapp AI on. Show Meet Frapp AI. */
  "consent_required",
  /** The president turned Ask off. Hide the entry point. */
  "chapter_off",
  /** The chapter used its AI allowance for the month. */
  "chapter_limit",
  /** The member used their AI allowance for the day. */
  "member_limit",
  /** Frapp's own ceiling for the month, or no provider is set up. */
  "not_available",
] as const;
export type AskUnavailableReason = (typeof ASK_UNAVAILABLE_REASONS)[number];

/** The kinds of source this version of the server sends. Open on the wire. */
export const ASK_SOURCE_KINDS = [
  "document",
  "minutes",
  "chat",
  "roster",
  "events",
  "points",
  "dues",
  "tasks",
] as const;
export type AskSourceKind = (typeof ASK_SOURCE_KINDS)[number];

/** The live-data pages a source can open. */
export const ASK_SOURCE_PAGES = [
  "members",
  "events",
  "points",
  "dues",
  "tasks",
] as const;
export type AskSourcePage = (typeof ASK_SOURCE_PAGES)[number];

/**
 * Where a source opens. Open on the wire (`type` is any string), so a newer
 * server can add a target an older client shows without a link.
 */
export type AskSourceTarget =
  | { type: "document"; document_id: string; page: number | null }
  | { type: "meeting"; meeting_id: string }
  | { type: "message"; channel_id: string; message_id: string }
  | { type: "page"; page: AskSourcePage };

const AskSourceSchema = z.object({
  /** Stable within one answer; what a citation points at. */
  id: z.string(),
  kind: z.string(),
  /** A document's name, "Chapter meeting minutes", "#general", "Roster". */
  title: z.string(),
  /** The section or page inside the source, when it has one. */
  detail: z.string().nullable(),
  /** When the source is from (ISO), or null for live data read just now. */
  date: z.string().nullable(),
  target: z.looseObject({ type: z.string() }).nullable(),
  /**
   * Chat: the display name of whose message it is, for a chip that says
   * whose and when. Absent from older servers and on every other kind.
   */
  author: z.string().nullish(),
});
export type AskSource = z.infer<typeof AskSourceSchema>;

const AskCitationSchema = z.object({
  /** Index into `sources`. */
  source: z.number().int().min(0),
  /**
   * Offset into `text` (UTF-16 code units, as a JavaScript string counts)
   * where the citation's marker goes: the end of the sentence it backs.
   */
  at: z.number().int().min(0),
  /** The words quoted, which the server found in the source word for word. */
  quote: z.string(),
});
export type AskCitation = z.infer<typeof AskCitationSchema>;

/**
 * A member or a channel the answer names. The text carries the plain name
 * after `@` or `#`; a client links a name only when it is listed here, so a
 * name a model made up is never a link.
 */
export const AskEntitySchema = z.object({
  type: z.enum(["member", "channel"]),
  id: z.string(),
  /** Exactly as it follows the `@` or `#` in `text`. */
  name: z.string(),
});
export type AskEntity = z.infer<typeof AskEntitySchema>;

/** The most cards one answer can come with. */
export const ASK_PROPOSALS_MAX = 5;

export const AskAnswerSchema = z.object({
  status: z.enum(ASK_ANSWER_STATUSES),
  reason: z.string().nullable(),
  text: z.string(),
  /** Ordered by `at`. Only sources a citation names are in `sources`. */
  citations: z.array(AskCitationSchema),
  sources: z.array(AskSourceSchema),
  /**
   * Channel messages left out because their authors chose not to share
   * them with AI. A count, never whose.
   */
  left_out_messages: z.number().int().min(0),
  /**
   * Quotes the model gave that the server could not find in their source
   * and dropped. Above zero, part of the answer may rest on nothing shown.
   */
  unverified_citations: z.number().int().min(0),
  /** The answer hit the length limit and stops early. */
  truncated: z.boolean(),
  /** This exchange was kept by the beta diagnostics window. */
  saved: z.boolean(),
  /**
   * Channel messages were among what the model was given for this answer,
   * whether or not the answer cites one. A client never sends such an answer
   * back as `history` (`askHistory`). Absent from servers before
   * conversations existed.
   */
  read_chat: z.boolean().nullish(),
  /**
   * What "Report this" sends back (#4315): the exchange as the model saw it
   * and as the member was shown it, sealed by the server so only the server
   * can open it. Nothing is stored until the member reports. Null when the
   * server cannot keep reported text (no sealing key) or there is nothing
   * AI-made to report; absent from servers before reports existed.
   */
  report_receipt: z.string().nullish(),
  /**
   * The members and channels `text` names ({@link AskEntitySchema}). Absent
   * from servers before the tool loop.
   */
  entities: z.array(AskEntitySchema).nullish(),
  /**
   * Cards that came with this answer: the ids of suggestions waiting for
   * the asker's Confirm (`GET /v1/ai/suggestions/{id}`), at most
   * {@link ASK_PROPOSALS_MAX}. Nothing has been changed by any of them.
   * Sent only to a client that asked with `answer_cards`. An answer that is
   * cards and nothing else is `answered` with empty `text`: draw the cards.
   */
  proposals: z.array(z.string()).max(ASK_PROPOSALS_MAX).nullish(),
  /**
   * This ask's id, on an answer whose turn the server kept a record of, so
   * feedback can name it (`ask-feedback.ts`). Absent when there is no
   * record: a client offers no thumbs then.
   */
  ask_id: z.string().nullish(),
});
export type AskAnswer = z.infer<typeof AskAnswerSchema>;

const version = z.literal(ASK_STREAM_VERSION);

export const AskStreamEventSchema = z.discriminatedUnion("type", [
  z.object({ v: version, type: z.literal("start"), ask_id: z.string() }),
  z.object({
    v: version,
    type: z.literal("status"),
    step: z.string(),
    /** With `reading`: the live reads being made (`AskStepDetail`). */
    reads: z.array(z.string()).optional(),
    /** With `reading`: how many sources the search found. */
    found: z.number().int().nonnegative().optional(),
    /** With `reading`, from the tool loop: the read that just started. */
    tool: z.string().optional(),
    /** With `tool`: the line to show for it (`AskStepDetail.label`). */
    label: z.string().optional(),
  }),
  z.object({ v: version, type: z.literal("text"), delta: z.string() }),
  z.object({ v: version, type: z.literal("done"), answer: AskAnswerSchema }),
  /**
   * The member asked for something to be done. Ends the stream in place of
   * `done`, and only for a request sent with `actions`. `act` is the answer
   * `POST /v1/ai/act` gives (`ActResponseDto`): a card to confirm, a choice
   * of event, or what was left unsaid. Nothing has been changed.
   */
  z.object({
    v: version,
    type: z.literal("proposal"),
    act: z.looseObject({ status: z.string() }),
  }),
  /** The stream broke after it began. Nothing shown so far stands. */
  z.object({
    v: version,
    type: z.literal("error"),
    code: z.string(),
    retryable: z.boolean(),
  }),
]);
export type AskStreamEvent = z.infer<typeof AskStreamEventSchema>;

/** One event as its Server-Sent Events frame. */
export function encodeAskStreamEvent(event: AskStreamEvent): string {
  // One `data:` line: JSON.stringify never emits a raw newline.
  return `data: ${JSON.stringify(event)}\n\n`;
}

/** A comment frame, sent while nothing else is, so a proxy keeps the stream open. */
export const ASK_STREAM_KEEPALIVE = ": keepalive\n\n";

/**
 * An event from one frame's JSON, or null for anything this reader should
 * skip: another version, an unknown type, a frame that is not an event.
 */
export function parseAskStreamEvent(json: string): AskStreamEvent | null {
  let value: unknown;
  try {
    value = JSON.parse(json);
  } catch {
    return null;
  }
  const parsed = AskStreamEventSchema.safeParse(value);
  return parsed.success ? parsed.data : null;
}

/**
 * Reads the stream as it arrives. Feed it each decoded chunk of the response
 * body; it returns the events completed by that chunk. A frame split across
 * chunks is held until its blank line arrives.
 */
export function createAskStreamReader(): {
  feed(chunk: string): AskStreamEvent[];
} {
  let buffer = "";
  return {
    feed(chunk: string): AskStreamEvent[] {
      buffer += chunk.replace(/\r\n/g, "\n");
      const events: AskStreamEvent[] = [];
      let end = buffer.indexOf("\n\n");
      while (end !== -1) {
        const frame = buffer.slice(0, end);
        buffer = buffer.slice(end + 2);
        const data = frame
          .split("\n")
          .filter((line) => line.startsWith("data:"))
          .map((line) => line.slice(5).replace(/^ /, ""))
          .join("\n");
        if (data) {
          const event = parseAskStreamEvent(data);
          if (event) events.push(event);
        }
        end = buffer.indexOf("\n\n");
      }
      return events;
    },
  };
}

/**
 * `text` cut to `max` UTF-16 units without leaving half of a two-unit
 * character at the end. A lone half is not valid text to a provider, and a
 * turn carrying one would fail every question after it.
 */
function cutWhole(text: string, max: number): string {
  const cut = text.slice(0, max);
  const last = cut.charCodeAt(cut.length - 1);
  return last >= 0xd800 && last <= 0xdbff ? cut.slice(0, -1) : cut;
}

/**
 * What a client sends as `history`: the last few finished turns, oldest
 * first. An answer the model wrote with channel messages in front of it is
 * sent as its question only, cited or not (`read_chat`; a cited chat source
 * says the same for a server that sends no flag). Chat is checked against
 * each author's AI choice at the moment it is shown to a model (`ai.md`
 * § Chat as a source), and an answer already on screen cannot be checked
 * again, so its words are not sent a second time.
 */
export function askHistory(
  turns: readonly {
    question: string;
    answer: AskAnswer | null;
    /** The question was a tapped suggestion, not typed. */
    suggested?: boolean;
  }[],
): AskHistoryTurn[] {
  return turns
    .slice(-ASK_HISTORY_MAX_TURNS)
    .map(({ question, answer, suggested }) => {
      const carried =
        answer !== null &&
        answer.status === "answered" &&
        answer.read_chat !== true &&
        !answer.sources.some((source) => source.kind === "chat");
      return {
        question: cutWhole(question.trim(), ASK_QUESTION_MAX_LENGTH),
        answer: carried
          ? cutWhole(answer.text, ASK_HISTORY_ANSWER_MAX_LENGTH)
          : "",
        ...(suggested ? { suggested: true } : {}),
      };
    });
}

/** A source's target as a known shape, or null when this build has no page for it. */
export function askSourceTarget(source: AskSource): AskSourceTarget | null {
  const target = source.target as Record<string, unknown> | null;
  if (!target) return null;
  const text = (key: string): string | null =>
    typeof target[key] === "string" ? target[key] : null;
  switch (target.type) {
    case "document": {
      const id = text("document_id");
      const page = typeof target.page === "number" ? target.page : null;
      return id ? { type: "document", document_id: id, page } : null;
    }
    case "meeting": {
      const id = text("meeting_id");
      return id ? { type: "meeting", meeting_id: id } : null;
    }
    case "message": {
      const channel = text("channel_id");
      const message = text("message_id");
      return channel && message
        ? { type: "message", channel_id: channel, message_id: message }
        : null;
    }
    case "page": {
      const page = text("page");
      return (ASK_SOURCE_PAGES as readonly string[]).includes(page ?? "")
        ? { type: "page", page: page as AskSourcePage }
        : null;
    }
    default:
      return null;
  }
}

/**
 * What Ask opens on (#4700): a few things to ask, each built by the server
 * from what the member's own account holds at that moment (their next event,
 * their open tasks, their dues, minutes they can read, their points). There
 * is no fixed list: a member whose account holds nothing gets none.
 *
 * `request` is true for the one suggestion that asks for something to be
 * done. Its words hold nothing anyone else wrote (only days), so a tap sends
 * it as the member's own request. Every other suggestion names a record
 * another member may have written, so a tap sends it as a question only, and
 * it is never among the earlier messages the request reading is shown
 * (`docs/security/ai-prompt-injection.md` C3).
 */
export const ASK_SUGGESTION_KINDS = [
  "event",
  "tasks",
  "dues",
  "minutes",
  "points",
  "request",
] as const;
export type AskSuggestionKind = (typeof ASK_SUGGESTION_KINDS)[number];

/** At most this many questions, and one request after them. */
export const ASK_SUGGESTED_QUESTIONS_MAX = 3;

/**
 * A record's name is put in a suggestion only when it is this short. A
 * longer one is left out whole: cut, it would no longer name the record.
 */
export const ASK_SUGGESTION_NAME_MAX = 60;

export const AskSuggestionSchema = z.object({
  /** Open: a client shows a kind it does not know like any other. */
  kind: z.string(),
  /** What a tap sends, as the member would type it. */
  text: z.string(),
  request: z.boolean(),
});
export type AskSuggestion = z.infer<typeof AskSuggestionSchema>;

/**
 * A record's name as it goes into a suggestion: on one line, or null when it
 * is empty or too long to put in a sentence.
 */
export function askSuggestionName(
  name: string | null | undefined,
): string | null {
  const flat = (name ?? "").replace(/\s+/g, " ").trim();
  return flat.length > 0 && flat.length <= ASK_SUGGESTION_NAME_MAX
    ? flat
    : null;
}

/**
 * The words of each suggestion. One place, so web and the phone show the
 * same ones and the server that builds them is tested against the same text.
 * `day` and `date` are written out in full by the caller ("Saturday",
 * "November 9"), never abbreviated. An event's `when` is how a member would
 * say its day ("today", "tomorrow", "on Sunday", "on November 22"), so a
 * meeting that repeats is asked about on the right day.
 */
export const askSuggestionText = {
  event: (name: string, when: string) => `When and where is ${name} ${when}?`,
  task: (title: string) => `When is my task "${title}" due?`,
  tasks: (count: number) => `Which of my ${count} open tasks is due first?`,
  dues: (title: string) => `How much do I owe for ${title}?`,
  minutes: (name: string, date: string) =>
    `What was decided at ${name} on ${date}?`,
  points: () => "How many points do I have this semester?",
  request: (eventDay: string, dueDay: string) =>
    `Make a task for me to get ready for ${eventDay}'s event, due ${dueDay}`,
} as const;

/** The words Ask shows, shared so web and mobile cannot drift. */
export const ASK_COPY = {
  name: "Ask Frapp",
  close: "Close Ask Frapp",
  placeholder: "Ask Frapp anything",
  empty_title: "Ask about your chapter",
  empty_body:
    "Answers come from your chapter's documents, minutes and records, with a link to each source.",
  /** Added for a member Frapp can also act for. */
  empty_body_act:
    "Or say what needs doing. You'll see exactly what will happen, and nothing changes until you confirm.",
  steps: {
    searching: "Searching your chapter's sources",
    reading: "Reading what it found",
    writing: "Writing",
    proposing: "Working out what that would change",
  } satisfies Record<AskStep, string>,
  /**
   * What each live read is called in the reading line ("Reading the roster"),
   * by the read's name. `ask-tools.spec.ts` in the API holds every class in
   * `ASK_TOOL_CLASSES`, the list the server offers from, to an entry here.
   */
  reads: {
    roster: "the roster",
    events: "the events calendar",
    my_points: "your points",
    points_leaderboard: "the points standings",
    my_dues: "your dues",
    my_tasks: "your tasks",
  } as Record<string, string>,
  not_found:
    "I couldn't find that in your chapter's documents, minutes or records.",
  not_found_hint:
    "Ask can only answer from what your chapter has uploaded or posted in Frapp.",
  refused: "Ask can't help with that question.",
  failed: "That didn't go through. Try again.",
  truncated: "This answer was cut short. Ask a narrower question for the rest.",
  unverified:
    "Part of this answer could not be matched to a source. Check the sources before you rely on it.",
  sources: "Sources",
  unavailable: {
    consent_required: "Turn on Frapp AI to use Ask.",
    chapter_off: "Your chapter's president has turned Ask off.",
    chapter_limit:
      "Your chapter has used its AI allowance for this month. Ask comes back on the 1st.",
    member_limit:
      "You've reached today's limit for questions. Ask comes back tomorrow.",
    not_available: "Ask isn't available right now. Try again later.",
  } satisfies Record<AskUnavailableReason, string>,
  /** Live data is read at the moment of the answer, so it has no date. */
  live: "Read just now",
  /** What kind of source a row is, under its title. */
  kinds: {
    document: "Document",
    minutes: "Minutes",
    chat: "Channel message",
    roster: "Members",
    events: "Events",
    points: "Points",
    dues: "Dues",
    tasks: "Tasks",
  } satisfies Record<AskSourceKind, string>,
  send: "Send",
  try_again: "Try again",
  /** Clears the thread: the next question starts with nothing before it. */
  new_conversation: "New conversation",
  consent_action: "Turn on Frapp AI",
  /** Under a finished answer: copies its words, without the markers. */
  copy_answer: "Copy answer",
  copied_answer: "Copied",
  /** Under Frapp's name in a composer's mention list (#4713). */
  mention_hint: "Only you see the answer",
  /**
   * By the composer while its draft names `@Frapp`: what Send will do, said
   * before it does it.
   */
  only_you_hint: "Only you will see this question and Frapp's answer.",
  /** The same, where there is room for two words beside the private mark. */
  only_you_short: "Only you",
  /** On an answer drawn in a channel for the asker alone. */
  only_you: "Only you can see this",
  dismiss: "Dismiss",
  /** A second `@Frapp` question while the first is still being answered. */
  still_answering: "Frapp is still answering your last question.",
  /** `@Frapp` with files staged: a question carries words only. */
  no_attachments:
    "Frapp can't read attachments. Remove them, or take @Frapp out to post this.",
  /** `@Frapp` on a message longer than a question may be. */
  too_long: "That's too long for a question. Keep it under 1,000 characters.",
  /** `@Frapp` and nothing else. */
  no_question: "Type your question after @Frapp.",
  /** `@Frapp` in a reply inside a thread, where there is nowhere to answer. */
  not_in_reply: "Ask Frapp from the channel, not from a reply.",
  /**
   * `@Frapp` sent before the app knows whether this member has Ask (the
   * reads are in flight, or failed). Posting it could put a question meant
   * for Frapp in front of the channel, so it waits.
   */
  ask_unknown:
    "Still checking Ask Frapp. Try again in a moment, or take @Frapp out to post this.",
} as const;

/**
 * Whether this member has Ask, as a composer needs it: `unknown` while the
 * reads behind the answer are in flight or failed.
 */
export type AskAccess = "yes" | "no" | "unknown";

/** What Send does with a channel composer's text (#4713). */
export type ChannelAskReading =
  /** Not a question for Frapp: it is sent as a message. */
  | { kind: "post" }
  /** A question that can't be asked as it stands. The text is kept. */
  | { kind: "refused"; reason: string }
  | { kind: "ask"; question: string };

/**
 * What a channel's Send does with `text`, for both clients: post it, ask
 * Frapp, or refuse and say why. One reading, so web and the phone refuse the
 * same things in the same order.
 *
 * A message that names `@Frapp` is never posted by a member who has Ask, or
 * who might: while that is `unknown` the send is refused, because the two
 * ways to be wrong are not equal. A member without Ask posts it as ordinary
 * text, which pings nobody.
 */
export function readChannelAsk(input: {
  text: string;
  /** The chapter's spaced names (`spacedMentionNames`). */
  names: readonly string[];
  access: AskAccess;
  /** Files or photos staged on the message. */
  attachments: number;
  /** A question is already being answered. */
  busy: boolean;
}): ChannelAskReading {
  if (input.access === "no") return { kind: "post" };
  const question = askMentionQuestion(input.text, input.names);
  if (question === null) return { kind: "post" };
  const reason =
    input.access === "unknown"
      ? ASK_COPY.ask_unknown
      : input.attachments > 0
        ? ASK_COPY.no_attachments
        : question.length === 0
          ? ASK_COPY.no_question
          : question.length > ASK_QUESTION_MAX_LENGTH
            ? ASK_COPY.too_long
            : input.busy
              ? ASK_COPY.still_answering
              : null;
  return reason === null
    ? { kind: "ask", question }
    : { kind: "refused", reason };
}

/**
 * Why a thread's reply box refuses `text`, or `null` to send it. A thread
 * has nowhere private to draw an answer, so a reply naming `@Frapp` is
 * refused for a member with Ask, and while that is unknown.
 */
export function replyAskRefusal(
  text: string,
  names: readonly string[],
  access: AskAccess,
): string | null {
  if (access === "no") return null;
  if (askMentionQuestion(text, names) === null) return null;
  return access === "unknown" ? ASK_COPY.ask_unknown : ASK_COPY.not_in_reply;
}

/** An own entry only: the key is an open string from the wire. */
function ownWords(
  words: Readonly<Record<string, string>>,
  key: string,
): string | null {
  return Object.prototype.hasOwnProperty.call(words, key)
    ? (words[key] as string)
    : null;
}

/** What a `reading` step named, in words: the live reads, then the count of sources. */
function readParts(detail?: AskStepDetail | null): string[] {
  const parts = (detail?.reads ?? [])
    .map((name) => ownWords(ASK_COPY.reads, name))
    .filter((words): words is string => words !== null);
  const found = detail?.found ?? 0;
  if (found > 0) parts.push(found === 1 ? "1 source" : `${found} sources`);
  return parts;
}

/**
 * The one line under a working turn: what Frapp is doing at that moment, from
 * the step the server last named (#4701). Web and the phone both draw this,
 * so the words cannot drift.
 *
 * `reading` names what is being read when the server said: the live reads
 * this build has words for, then how many sources the search found ("Reading
 * the events calendar and 3 sources"). A step this build does not know reads
 * as searching, which every turn does first.
 */
export function askStepLine(
  step: string | null | undefined,
  detail?: AskStepDetail | null,
): string {
  if (step === "reading") {
    if (detail?.label) return detail.label;
    const parts = readParts(detail);
    return parts.length === 0
      ? ASK_COPY.steps.reading
      : `Reading ${joinNames(parts)}`;
  }
  // Every other step is its own words, so a step added to `ASK_COPY.steps`
  // needs nothing here.
  return (
    (step ? ownWords(ASK_COPY.steps, step) : null) ?? ASK_COPY.steps.searching
  );
}

/**
 * What Frapp read to write a finished answer: the reading line in the past
 * tense ("Read the events calendar and 3 sources"), kept under the answer
 * where the work line was (Paul, 2026-11-13: the conversation "should feel
 * more agentic"). ChatGPT keeps "Thought for 12s" and Perplexity its count of
 * sources the same way. Null when the turn named nothing it read, so a
 * refusal or an answer from the thread alone carries no line.
 */
export function askReadLine(detail?: AskStepDetail | null): string | null {
  const parts = readParts(detail);
  return parts.length === 0 ? null : `Read ${joinNames(parts)}`;
}

/** A source kind's label, or null for a kind this build does not know. */
export function askSourceKindLabel(kind: string): string | null {
  return (ASK_COPY.kinds as Record<string, string>)[kind] ?? null;
}

/**
 * The beta diagnostics window's words in Chapter settings (`ai.md` § Stored
 * AI text). Shown only to the one chapter the server offers it to.
 */
export const ASK_DIAGNOSTICS_COPY = {
  label: "Save Ask questions for the Frapp team",
  description:
    "For 14 days, questions members ask in Ask Frapp and the answers they get are saved, encrypted, so the Frapp team can fix wrong answers during the beta. Answers that used channel messages are never saved. It turns itself off on the end date and everything saved is deleted.",
  start: "Start saving",
  stop: "Stop and delete",
  on: (endsOn: string) => `Saving until ${endsOn}.`,
  off: "Not saving.",
  presidentOnly: "Only the chapter president can turn this on or off.",
  confirmStartTitle: "Save Ask questions for 14 days?",
  confirmStartBody: (endsOn: string) =>
    `Until ${endsOn}, each member sees a line in Ask saying their questions and answers are saved for the Frapp team. You can stop it sooner, which deletes everything saved. Your yes is recorded in the chapter's audit log.`,
  confirmStart: "Start saving",
  confirmStopTitle: "Stop saving and delete?",
  confirmStopBody:
    "Every saved question and answer is deleted now. This can't be undone.",
  confirmStop: "Stop and delete",
  cancel: "Cancel",
  started: "Ask questions are being saved",
  stopped: "Saving stopped and everything saved was deleted",
  failed: "That didn't save. Try again.",
} as const;

/** How long the window runs, for the confirm's end date before the server sets it. */
export const ASK_DIAGNOSTICS_DAYS = 14;

/** A run of an answer's text, or the marker of one citation inside it. */
export type AskAnswerSegment =
  | { type: "text"; text: string }
  | { type: "citation"; citation: AskCitation; index: number };

/**
 * An answer's text cut at its citations, in reading order, so a client draws
 * each marker where the server placed it. A citation past the end of the text
 * lands at the end; two of the same source at one place are one marker.
 * `index` is the citation's place in `answer.citations`.
 */
export function askAnswerSegments(
  answer: Pick<AskAnswer, "text" | "citations">,
): AskAnswerSegment[] {
  const text = answer.text;
  const placed = answer.citations
    .map((citation, index) => ({
      citation,
      index,
      at: Math.min(Math.max(citation.at, 0), text.length),
    }))
    .sort((a, b) => a.at - b.at || a.index - b.index);
  const segments: AskAnswerSegment[] = [];
  let cursor = 0;
  let seenHere = new Set<number>();
  for (const { citation, index, at } of placed) {
    if (at > cursor) {
      segments.push({ type: "text", text: text.slice(cursor, at) });
      cursor = at;
      seenHere = new Set();
    }
    if (seenHere.has(citation.source)) continue;
    seenHere.add(citation.source);
    segments.push({ type: "citation", citation, index });
  }
  if (cursor < text.length) {
    segments.push({ type: "text", text: text.slice(cursor) });
  }
  return segments;
}

/** The line under an answer that drew on channels holding left-out messages. */
export function askLeftOutLine(count: number): string {
  return count === 1
    ? "1 message from a member who opted out isn't included."
    : `${count} messages from members who opted out aren't included.`;
}

/** The line Ask shows while the beta diagnostics window is on. */
export function askSavedLine(endsOn: string): string {
  return `Questions and answers here are saved for the Frapp team until ${endsOn}, to fix problems during the beta.`;
}

/**
 * "Minutes · Budget · November 9, 2026": a source's kind, the place inside
 * it, and its date written out, as web and mobile both list it.
 */
export function askSourceMetaLine(source: AskSource): string {
  const kind = askSourceKindLabel(source.kind);
  return [
    // Live data's title is already its kind ("Events"), so it is said once.
    kind === source.title ? null : kind,
    source.detail,
    source.date ? formatAiAnswerDate(source.date) : ASK_COPY.live,
  ]
    .filter((part): part is string => !!part)
    .join(" · ");
}

/** What an unavailable answer says, with a fallback for a reason this build does not know. */
export function askUnavailableLine(reason: string | null): string {
  return (
    (ASK_COPY.unavailable as Record<string, string>)[reason ?? ""] ??
    ASK_COPY.unavailable.not_available
  );
}
