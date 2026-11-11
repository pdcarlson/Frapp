import { POLL_OPTIONS_MAX, POLL_OPTIONS_MIN } from "@repo/validation";
import { tokenizeQuotedArgs } from "./integrations/parsers";

/**
 * The model behind the New poll form on both clients: mobile's New poll sheet
 * (`apps/mobile/components/chat/new-poll-sheet.tsx`, #3701) and web's New poll
 * dialog (`apps/web/components/chat/new-poll-dialog.tsx`, #3865): who may open
 * it, the draft it edits, and what makes a draft postable. The card it posts
 * is built by `buildPollMessage` in `./polls`, the same builder `/poll` uses,
 * so a poll made in either form is the card every client already votes on.
 */

/**
 * When voting stops, as the form offers it. `never` is a poll with no
 * deadline (#3896): it stays open until its creator closes it from the card
 * (Close poll, #3794).
 */
export type PollCloseChoice = "1h" | "1d" | "3d" | "1w" | "never";

export const POLL_CLOSE_CHOICES: readonly {
  id: PollCloseChoice;
  label: string;
  /** Minutes from posting to the deadline, or `null` for no deadline. */
  minutes: number | null;
}[] = [
  { id: "1h", label: "1 hour", minutes: 60 },
  { id: "1d", label: "1 day", minutes: 60 * 24 },
  { id: "3d", label: "3 days", minutes: 60 * 24 * 3 },
  { id: "1w", label: "1 week", minutes: 60 * 24 * 7 },
  { id: "never", label: "Doesn't close", minutes: null },
];

/**
 * The choices a form offers this member. **Doesn't close** is offered only to
 * a member who could end the poll: Close poll is the creator's alone and needs
 * `polls:create` (`canClosePoll` in `./polls`), which posting a card does not
 * (#3007), so without it an open-ended poll could only be ended by deleting
 * it. Pass `false` while the permission isn't known.
 */
export function pollCloseChoicesFor(canCloseEarly: boolean) {
  return canCloseEarly
    ? POLL_CLOSE_CHOICES
    : POLL_CLOSE_CHOICES.filter((choice) => choice.minutes !== null);
}

/**
 * What More options is set to, for mobile's collapsed row: "Closes in 1 day"
 * or "Doesn't close", then "more than one choice" when that is on (#3793).
 */
export function pollCloseSummary(
  choice: PollCloseChoice,
  multiple = false,
): string {
  const found =
    POLL_CLOSE_CHOICES.find((each) => each.id === choice) ??
    POLL_CLOSE_CHOICES.find((each) => each.id === DEFAULT_POLL_CLOSE)!;
  const closes =
    found.minutes === null ? found.label : `Closes in ${found.label}`;
  return multiple ? `${closes} · more than one choice` : closes;
}

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
  /** A member may pick more than one option (#3793). Off by default. */
  multiple: boolean;
}

export const POLL_MULTIPLE_LABEL = "Allow more than one choice";

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
    multiple: false,
  };
}

/** The deadline the choice sets, or `null` for a poll that doesn't close. */
export function closesAtFor(choice: PollCloseChoice, now: Date): Date | null {
  const found = POLL_CLOSE_CHOICES.find((each) => each.id === choice);
  const minutes = found ? found.minutes : 60 * 24;
  if (minutes === null) return null;
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
  // Adding stops at the maximum, but a `/poll` prefill keeps every option
  // typed (`pollDraftFromArgs`), so the member is told and trims one.
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
 *
 * - An unclosed quote is closed at the end of the line, so a forgotten
 *   closing quote costs nothing: `"Who is driving` is the question, and
 *   `"Who drives?" Sam "Alex Smith` reads Sam and Alex Smith.
 * - `closes=<minutes>` picks the form's choice nearest to it.
 * - Every typed option gets a row, past the maximum too: the form then says a
 *   poll can have up to ten, and the member chooses which to remove, rather
 *   than losing the last ones unseen.
 */
export function pollDraftFromArgs(args: string): PollDraft {
  const draft = emptyPollDraft();
  const trimmed = args.trim();
  if (trimmed.length === 0) return draft;
  // An unclosed quote is the member still typing inside it: close it.
  const tokens = tokenizeQuotedArgs(trimmed) ??
    tokenizeQuotedArgs(`${trimmed}"`) ?? [trimmed.replace(/"/g, "")];
  const [question = "", ...rest] = tokens;
  let closes = draft.closes;
  const typed: string[] = [];
  for (const token of rest) {
    if (token.startsWith("closes=")) {
      const minutes = Number(token.slice("closes=".length));
      if (Number.isFinite(minutes) && minutes > 0) {
        closes = nearestCloseChoice(minutes);
      }
      continue;
    }
    const text = token.trim();
    if (text.length > 0) typed.push(text);
  }
  const options = draft.options.map((row, index) => ({
    ...row,
    text: typed[index] ?? "",
  }));
  for (const text of typed.slice(options.length)) {
    nextRowKey += 1;
    options.push({ key: `option-${nextRowKey}`, text });
  }
  return { ...draft, question: question.trim(), options, closes };
}

/** The timed choice nearest to `minutes`; "Doesn't close" is never nearest. */
function nearestCloseChoice(minutes: number): PollCloseChoice {
  let best: { id: PollCloseChoice; distance: number } | null = null;
  for (const choice of POLL_CLOSE_CHOICES) {
    if (choice.minutes === null) continue;
    const distance = Math.abs(choice.minutes - minutes);
    if (!best || distance < best.distance) best = { id: choice.id, distance };
  }
  return best ? best.id : DEFAULT_POLL_CLOSE;
}
