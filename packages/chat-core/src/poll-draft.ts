import { can, POLL_OPTIONS_MAX, POLL_OPTIONS_MIN } from "@repo/validation";
import { tokenizeQuotedArgs } from "./integrations/parsers";
import { type PollsGate } from "./polls";

/**
 * The model behind the New poll form on both clients: mobile's New poll sheet
 * (`apps/mobile/components/chat/new-poll-sheet.tsx`, #3701) and web's New poll
 * dialog (`apps/web/components/chat/new-poll-dialog.tsx`, #3865): who may open
 * it, the draft it edits, and what makes a draft postable. The card it posts
 * is built by `buildPollMessage` in `./polls`, the same builder `/poll` uses,
 * so a poll made in either form is the card every client already votes on.
 */

/** When voting stops, as More options offers it. */
export type PollCloseChoice = "1h" | "1d" | "3d" | "1w";

export const POLL_CLOSE_CHOICES: readonly {
  id: PollCloseChoice;
  label: string;
  minutes: number;
}[] = [
  { id: "1h", label: "1 hour", minutes: 60 },
  { id: "1d", label: "1 day", minutes: 60 * 24 },
  { id: "3d", label: "3 days", minutes: 60 * 24 * 3 },
  { id: "1w", label: "1 week", minutes: 60 * 24 * 7 },
];

/** A day, as web's `/poll` closes when it isn't told otherwise. */
export const DEFAULT_POLL_CLOSE: PollCloseChoice = "1d";

/**
 * One option row. `key` is the row's own and moves with it, so a row moved up
 * or down takes its text field (and the keyboard, if the member is typing in
 * it) along: a key by position would leave the caret in the slot the text
 * just left, and the next keystrokes would land in another option.
 */
export interface PollOptionRow {
  key: string;
  text: string;
}

export interface PollDraft {
  question: string;
  /** The option rows, as typed; blank rows are allowed while editing. */
  options: PollOptionRow[];
  closes: PollCloseChoice;
}

let nextRowKey = 0;
function newRow(): PollOptionRow {
  nextRowKey += 1;
  return { key: `option-${nextRowKey}`, text: "" };
}

/** A new poll starts with the two rows every poll needs. */
export function emptyPollDraft(): PollDraft {
  return {
    question: "",
    options: Array.from({ length: POLL_OPTIONS_MIN }, newRow),
    closes: DEFAULT_POLL_CLOSE,
  };
}

/**
 * Whether this member may start a poll here: their role grants `polls:create`
 * and the chapter has Polls on (#3701, `spec/behavior/polls.md`).
 *
 * `pollsGate` is the same Polls read the poll card's Vote takes (`pollsGateOf`
 * in `@repo/chat-core/polls`): only `"on"` offers a poll, so while the
 * chapter is still loading, or couldn't be read, the + offers photos only
 * rather than a poll the server may refuse. Permissions still loading read as
 * none, for the same reason.
 *
 * Only the module half is the server's too (#2993). The chat send route
 * doesn't check `polls:create` for a poll card, on this client's posts or
 * web's `/poll`: whether it should is #3007's open decision. Until then this
 * is a client-side offer, not enforcement.
 */
export function canCreatePoll({
  permissions,
  pollsGate,
}: {
  permissions: readonly string[] | undefined;
  pollsGate: PollsGate;
}): boolean {
  return pollsGate === "on" && can("polls:create", permissions);
}

export function closesAtFor(choice: PollCloseChoice, now: Date): Date {
  const minutes =
    POLL_CLOSE_CHOICES.find((each) => each.id === choice)?.minutes ??
    60 * 24;
  return new Date(now.getTime() + minutes * 60 * 1000);
}

export type PollDraftCheck =
  | { ok: true; question: string; options: string[] }
  /**
   * `problem` is what to tell the member, or `null` when the draft is only
   * unfinished (no question yet, a second option still to type), which the
   * held Post button says well enough on its own.
   */
  | { ok: false; problem: string | null };

export const DUPLICATE_OPTION_PROBLEM =
  "Two options say the same thing. Change one, or remove it.";

/**
 * Whether the draft can be posted, and what it posts: the question and the
 * filled option rows, trimmed, in the order shown. A blank row is skipped, so
 * a member who added one too many needn't remove it first. Two options that
 * differ only in case or spacing are refused rather than merged: `/poll`
 * merges them silently, but here the member can see both rows and fix one.
 */
export function checkPollDraft(draft: PollDraft): PollDraftCheck {
  const question = draft.question.trim();
  const options = draft.options
    .map((option) => option.text.trim())
    .filter((option) => option.length > 0);
  const seen = new Set<string>();
  for (const option of options) {
    const key = option.toLowerCase().replace(/\s+/g, " ");
    if (seen.has(key)) return { ok: false, problem: DUPLICATE_OPTION_PROBLEM };
    seen.add(key);
  }
  if (question.length === 0 || options.length < POLL_OPTIONS_MIN) {
    return { ok: false, problem: null };
  }
  // The rows stop at the maximum, so only a draft built elsewhere gets here.
  if (options.length > POLL_OPTIONS_MAX) {
    return {
      ok: false,
      problem: `A poll can have up to ${POLL_OPTIONS_MAX} options.`,
    };
  }
  return { ok: true, question, options };
}

export function canAddPollOption(draft: PollDraft): boolean {
  return draft.options.length < POLL_OPTIONS_MAX;
}

export function canRemovePollOption(draft: PollDraft): boolean {
  return draft.options.length > POLL_OPTIONS_MIN;
}

export function addPollOption(draft: PollDraft): PollDraft {
  if (!canAddPollOption(draft)) return draft;
  return { ...draft, options: [...draft.options, newRow()] };
}

export function removePollOption(draft: PollDraft, key: string): PollDraft {
  if (!canRemovePollOption(draft)) return draft;
  if (!draft.options.some((row) => row.key === key)) return draft;
  return {
    ...draft,
    options: draft.options.filter((row) => row.key !== key),
  };
}

export function setPollOption(
  draft: PollDraft,
  key: string,
  text: string,
): PollDraft {
  if (!draft.options.some((row) => row.key === key)) return draft;
  return {
    ...draft,
    options: draft.options.map((row) =>
      row.key === key ? { ...row, text } : row,
    ),
  };
}

/** Moves one row up (`-1`) or down (`1`); a move off either end does nothing. */
export function movePollOption(
  draft: PollDraft,
  key: string,
  step: -1 | 1,
): PollDraft {
  const index = draft.options.findIndex((row) => row.key === key);
  const target = index + step;
  if (index < 0) return draft;
  if (target < 0 || target >= draft.options.length) return draft;
  const options = [...draft.options];
  [options[index], options[target]] = [options[target]!, options[index]!];
  return { ...draft, options };
}

/**
 * A draft filled in from what was typed after a bare or unfinished `/poll`
 * (#3773 step 2), so the form opens on the member's own words: the first
 * token is the question and the rest are options, as the one-liner reads them.
 * A `closes=` token is dropped (the form's choices are coarser). Rows are
 * padded to the minimum and cut at the maximum; an unterminated quote reads as
 * the question alone, since that is what the member was still typing.
 */
export function pollDraftFromArgs(args: string): PollDraft {
  const draft = emptyPollDraft();
  const trimmed = args.trim();
  if (trimmed.length === 0) return draft;
  const tokens = tokenizeQuotedArgs(trimmed);
  if (tokens === null) {
    return { ...draft, question: trimmed.replace(/^"/, "").trim() };
  }
  const [question = "", ...rest] = tokens;
  const typed = rest
    .filter((token) => !token.startsWith("closes="))
    .map((token) => token.trim())
    .filter((token) => token.length > 0)
    .slice(0, POLL_OPTIONS_MAX);
  const options = draft.options.map((row, index) => ({
    ...row,
    text: typed[index] ?? "",
  }));
  for (const text of typed.slice(options.length)) {
    nextRowKey += 1;
    options.push({ key: `option-${nextRowKey}`, text });
  }
  return { ...draft, question: question.trim(), options };
}
