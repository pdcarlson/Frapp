/**
 * A real question: one a member, a committee chair or an officer would
 * really ask, with what a right answer holds (#4903).
 *
 * The adversarial cases (`cases/`) grade the rules Frapp enforces around a
 * model. These grade the answer: did it know who asked, look in the right
 * places, get the facts right and stay short. They are asked of the term
 * chapter (`synthetic-chapter/term.ts`) at `EVAL_NOW`.
 */

export type QuestionGroup = 'member' | 'chair' | 'exec' | 'refuse';

export const QUESTION_GROUPS: readonly QuestionGroup[] = [
  'member',
  'chair',
  'exec',
  'refuse',
];

/**
 * The tools a question may be expected to use, by the plan's names (epic
 * #4898, "The tool catalog"). A tool slice that ships under another name
 * adds it to `TOOL_ALIASES` in `code-grader.ts`; the questions keep these.
 */
export const KNOWN_TOOLS = [
  'search_messages',
  'read_channel',
  'list_channels',
  'search_records',
  'read_minutes',
  'read_document',
  'list_meetings',
  'find_member',
  'roster',
  'my_tasks',
  'chapter_tasks',
  'events',
  'my_attendance',
  'event_attendance',
  'my_points',
  'points_standings',
  'my_standing',
  'my_hours',
  'service_hours',
  'polls',
  'propose_tasks',
  'propose_event',
  'propose_points',
] as const;

export type KnownTool = (typeof KNOWN_TOOLS)[number];

export interface QuestionExpectation {
  /**
   * The right answer is to decline: the asker may not see it, Frapp never
   * reads it, or the request is not a question. A decline still has to be
   * useful (say what it cannot do and, where there is one, where to look).
   */
  decline?: boolean;
  /**
   * Facts the answer must hold. Each entry is one fact, written as the ways
   * an answer might put it; any one of them counts. Matched without case.
   */
  facts: string[][];
  /** Words that must not be in the answer: a stale figure, a leak, a planted line. */
  never?: string[];
  /**
   * Words that must never be in anything sent to the model for this
   * question: a direct message, a phone number, a message whose author said
   * no, a channel the asker cannot open. Stronger than `never`: a model that
   * was shown a secret and kept quiet still fails.
   */
  neverShown?: string[];
  /**
   * The reads a good answer needs. Each entry is one need; calling any tool
   * in it meets the need. Empty when no particular read is expected.
   */
  tools: KnownTool[][];
  /** The answer may not run past this many words. Short is part of right. */
  maxWords: number;
  /**
   * Cards expected beside the answer. `max: 0` means none may be proposed
   * (a catch-up that turns a planted message into a task has failed).
   */
  cards?: { min: number; max: number };
  /** Facts the proposed cards must hold between them (title or owner), as `facts`. */
  cardFacts?: string[][];
}

export interface RealQuestion {
  id: string;
  group: QuestionGroup;
  /**
   * Where the question came from: the plan page's starting list, Paul's own
   * fifteen (`paul-questions.json`), or a miss in real use rewritten for the
   * synthetic chapter (`README.md`, "Turning a miss into a case").
   */
  origin: 'plan' | 'paul' | 'miss';
  /** A member of the synthetic chapter, by id. */
  askerId: string;
  /** The channel, event or task that was open when they asked. */
  from?: { channelId?: string; eventId?: string; taskId?: string };
  question: string;
  expect: QuestionExpectation;
  /**
   * What a right answer looks like, for the judge and for the person reading
   * a failure. Plain sentences: what it must say, what it must not, and what
   * a good one does that a passable one does not.
   */
  rightAnswer: string;
  /**
   * An answer that should pass every check, written by hand. It proves the
   * checks can be met, plays the model in the scripted run, and is a pass in
   * the judge's hand-graded sample. Optional on a question Paul adds.
   */
  reference?: string;
}
