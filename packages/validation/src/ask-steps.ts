import { joinNames } from "./ai-copy";
import { ASK_COPY, type AskStreamEvent } from "./ask";

/**
 * Ask's working state as a short list of steps (#5427, Paul 2026-11-17: "we
 * write instead of show"; `spec/behavior/ai.md` § Ask Frapp). Each read Frapp
 * makes is one step with an icon for its kind, a state, and what it found;
 * once the answer starts the list folds into one row. Web and the phone both
 * draw from these functions, so the words and the rules cannot drift.
 */

/**
 * What a step reads, for its icon. Open on the wire: a kind a build does not
 * know draws the plain mark (`other`).
 */
export const ASK_STEP_KINDS = [
  "chat",
  "channels",
  "records",
  "document",
  "minutes",
  "events",
  "attendance",
  "people",
  "tasks",
  "points",
  "dues",
  "hours",
  "backwork",
  "other",
] as const;
export type AskStepKind = (typeof ASK_STEP_KINDS)[number];

/** How many things a step names as chips. */
export const ASK_STEP_NAMES_MAX = 3;

/**
 * The kind of each read, by the read's name: the tool loop's tools and the
 * one-shot path's live reads. The server sends the kind with each read from
 * this map, so a tool added after a build shipped still gets its icon.
 */
const STEP_KINDS: Readonly<Record<string, AskStepKind>> = {
  search_messages: "chat",
  read_channel: "chat",
  list_channels: "channels",
  search_records: "records",
  read_document: "document",
  read_minutes: "minutes",
  list_meetings: "minutes",
  events: "events",
  open_event: "events",
  my_attendance: "attendance",
  event_attendance: "attendance",
  attendance_summary: "attendance",
  roster: "people",
  find_member: "people",
  my_tasks: "tasks",
  chapter_tasks: "tasks",
  my_points: "points",
  points_standings: "points",
  points_leaderboard: "points",
  my_standing: "points",
  my_dues: "dues",
  my_hours: "hours",
  service_hours: "hours",
  find_backwork: "backwork",
};

/** A read's kind by its name, or `other`. */
export function askStepKind(read: string | null | undefined): AskStepKind {
  if (!read || !Object.prototype.hasOwnProperty.call(STEP_KINDS, read)) {
    return "other";
  }
  return STEP_KINDS[read] as AskStepKind;
}

/** A kind from the wire, as one this build draws. */
export function askKnownStepKind(kind: string | null | undefined): AskStepKind {
  return (ASK_STEP_KINDS as readonly string[]).includes(kind ?? "")
    ? (kind as AskStepKind)
    : "other";
}

export type AskWorkStepState = "working" | "done" | "nothing" | "failed";

/** One step of a working turn. */
export interface AskWorkStep {
  /**
   * `call:<n>` for a tool-loop read; otherwise `search`, `read:<name>` or
   * `propose` (a card being worked out).
   */
  key: string;
  kind: AskStepKind;
  /** What it is doing, in the present tense: "Searching messages". */
  label: string;
  state: AskWorkStepState;
  /**
   * How many things it found, once the server said. Null for a step it
   * never counts (the one-shot path's live reads, a card being worked out),
   * which then shows no count rather than "Nothing found".
   */
  found: number | null;
  /** Up to `ASK_STEP_NAMES_MAX` things it found, by name. */
  names: readonly string[];
}

const PAST: readonly [string, string][] = [
  ["Searching ", "Searched "],
  ["Reading ", "Read "],
  ["Looking at ", "Looked at "],
  ["Looking up ", "Looked up "],
  ["Looking through ", "Looked through "],
  ["Adding up ", "Added up "],
  ["Opening ", "Opened "],
  ["Working out ", "Worked out "],
];

/**
 * A step's words once it is over: "Searching messages" becomes "Searched
 * messages". Words this build has no past tense for stay as they are.
 */
export function askStepPast(label: string): string {
  for (const [now, then] of PAST) {
    if (label.startsWith(now)) return then + label.slice(now.length);
  }
  return label;
}

/** A step's words as it is drawn: present while working, past after. */
export function askStepLabel(step: AskWorkStep): string {
  return step.state === "working" ? step.label : askStepPast(step.label);
}

const SEARCH_KEY = "search";
const PROPOSE_KEY = "propose";

function settle(step: AskWorkStep): AskWorkStep {
  return step.state === "working" ? { ...step, state: "done" } : step;
}

/**
 * The steps after one stream event. Pure: the hook keeps the list, and both
 * clients draw it.
 *
 * - `searching` opens the turn with one working step, the search, which every
 *   turn starts with.
 * - A tool-loop read (`status` with `call`) replaces that opening step the
 *   first time, since the loop's first round is the search, and then adds one
 *   working step per read, in the order they started.
 * - Its `step` event says how it ended and what it found.
 * - The one-shot path's `reading` (no `call`) ends the search with how many
 *   sources it found, then adds the live reads it picked, working.
 * - `proposing` adds one step for the card being worked out.
 * - Writing, a card or the answer: every step still working is over, with
 *   no count unless the server gave one. A search that never ended, because
 *   nothing was read at all, goes, so a turn that read nothing shows no list.
 * - An error: no list ({@link askStepsStopped}); the failure is the turn's.
 */
export function askStepsOn(
  steps: readonly AskWorkStep[],
  event: AskStreamEvent,
): AskWorkStep[] {
  if (event.type === "status") {
    if (event.step === "searching") {
      return steps.length === 0
        ? [
            {
              key: SEARCH_KEY,
              kind: "records",
              label: ASK_COPY.steps.searching,
              state: "working",
              found: null,
              names: [],
            },
          ]
        : [...steps];
    }
    // A tool-loop read. A server from before #5427 names the tool with no
    // number and never says how it ended: its row settles with no count.
    if (
      event.step === "reading" &&
      (event.call !== undefined || event.tool !== undefined)
    ) {
      const key =
        event.call !== undefined
          ? `call:${event.call}`
          : `tool:${steps.filter((step) => step.key.startsWith("tool:")).length + 1}`;
      if (steps.some((step) => step.key === key)) return [...steps];
      const kept = steps.filter(
        (step) => !(step.key === SEARCH_KEY && step.state === "working"),
      );
      return [
        ...kept,
        {
          key,
          kind: event.kind
            ? askKnownStepKind(event.kind)
            : askStepKind(event.tool),
          label: event.label ?? ASK_COPY.steps.reading,
          state: "working",
          found: null,
          names: [],
        },
      ];
    }
    if (event.step === "reading") {
      const found = event.found ?? 0;
      const ended = steps.map((step) =>
        step.key === SEARCH_KEY
          ? {
              ...step,
              state: (found > 0 ? "done" : "nothing") as AskWorkStepState,
              found,
            }
          : step,
      );
      const reads = (event.reads ?? []).flatMap((name) => {
        const words = Object.prototype.hasOwnProperty.call(ASK_COPY.reads, name)
          ? ASK_COPY.reads[name]
          : undefined;
        const key = `read:${name}`;
        if (!words || ended.some((step) => step.key === key)) return [];
        return [
          {
            key,
            kind: askStepKind(name),
            label: `Reading ${words}`,
            state: "working" as const,
            found: null,
            names: [],
          },
        ];
      });
      return [...ended, ...reads];
    }
    if (event.step === "proposing") {
      // A card is being worked out: one step for it, however many reads
      // led there, settled when the card or the answer arrives.
      if (steps.some((step) => step.key === PROPOSE_KEY)) return [...steps];
      return [
        ...steps.filter(
          (step) => !(step.key === SEARCH_KEY && step.state === "working"),
        ),
        {
          key: PROPOSE_KEY,
          kind: "tasks",
          label: ASK_COPY.steps.proposing,
          state: "working",
          found: null,
          names: [],
        },
      ];
    }
    // `writing`, or a step this build does not know.
    return event.step === "writing" ? over(steps) : [...steps];
  }
  if (event.type === "step") {
    const key = `call:${event.call}`;
    return steps.map((step) => {
      if (step.key !== key) return step;
      const state: AskWorkStepState =
        event.outcome === "failed"
          ? "failed"
          : event.found > 0
            ? "done"
            : "nothing";
      return {
        ...step,
        ...(event.kind ? { kind: askKnownStepKind(event.kind) } : {}),
        state,
        found: event.found,
        names: [...new Set(event.names)].slice(0, ASK_STEP_NAMES_MAX),
      };
    });
  }
  if (event.type === "done" || event.type === "proposal") return over(steps);
  // The turn broke: what it was doing did not end, so it is not drawn as
  // done or as nothing found. The failure is the turn's own words.
  if (event.type === "error") return askStepsStopped();
  return [...steps];
}

/**
 * The steps of a turn that ended without the server saying how its work
 * ended (a refusal before the stream, a stream that broke): none. Before
 * #5427 such a turn drew no working line either.
 */
export function askStepsStopped(): AskWorkStep[] {
  return [];
}

/** The answer has started or the turn ended: nothing is still working. */
function over(steps: readonly AskWorkStep[]): AskWorkStep[] {
  return steps
    .filter((step) => !(step.key === SEARCH_KEY && step.state === "working"))
    .map(settle);
}

function plural(n: number, one: string, many: string): string {
  return `${n} ${n === 1 ? one : many}`;
}

/**
 * The line under a step that ended: what it found, in words. Null while it
 * works, and for a step whose names say it all.
 *
 * - A read that failed: "Couldn't read this".
 * - Nothing: "Nothing found".
 * - Chat: how many messages and where ("3 messages in #exec-board").
 * - The search before the one-shot answer: how many sources.
 * - Anything else: how many, when it found more than its chips name.
 */
export function askStepFoundLine(step: AskWorkStep): string | null {
  if (step.state === "working") return null;
  if (step.state === "failed") return ASK_COPY.step_failed;
  if (step.state === "nothing") return ASK_COPY.step_nothing;
  // Over, but never counted: its words and its tick say it all.
  if (step.found === null || step.found === 0) return null;
  if (step.kind === "chat") {
    const count = plural(step.found, "message", "messages");
    if (step.names.length === 0) return count;
    return step.names.length <= 2
      ? `${count} in ${joinNames(step.names)}`
      : `${count} in ${step.names.length} channels`;
  }
  if (step.key === SEARCH_KEY) return plural(step.found, "source", "sources");
  if (step.names.length === 0 || step.found > step.names.length) {
    return `${step.found} found`;
  }
  return null;
}

/** The names a step shows as chips. Chat says where in its line instead. */
export function askStepChips(step: AskWorkStep): readonly string[] {
  if (step.state !== "done" || step.kind === "chat") return [];
  return step.names;
}

/**
 * The folded row's words once the answer has started: a single step is its
 * own words in the past tense; more read "Worked through 6 steps".
 */
export function askStepsSummary(steps: readonly AskWorkStep[]): string {
  if (steps.length === 1) return askStepLabel(steps[0] as AskWorkStep);
  return `Worked through ${steps.length} steps`;
}

/** What a screen reader hears for one step: its words, its state, what it found. */
export function askStepSpoken(step: AskWorkStep): string {
  const state =
    step.state === "working"
      ? "in progress"
      : step.state === "failed"
        ? "failed"
        : "done";
  return [
    askStepLabel(step),
    state,
    askStepFoundLine(step),
    askStepChips(step).join(", ") || null,
  ]
    .filter(Boolean)
    .join(", ");
}

/** The distinct kinds of a turn's steps, first seen first, for the folded row's icons. */
export function askStepKinds(
  steps: readonly AskWorkStep[],
  max = 4,
): AskStepKind[] {
  return [...new Set(steps.map((step) => step.kind))].slice(0, max);
}
