import {
  can,
  isModuleEnabled,
  POLL_OPTIONS_MAX,
  POLL_OPTIONS_MIN,
} from "@repo/validation";

/**
 * The model behind s05's New poll sheet (`components/chat/new-poll-sheet.tsx`,
 * #3701): who may open it, the draft it edits, and what makes a draft
 * postable. The card it posts is built by `buildPollMessage` in
 * `@repo/chat-core/polls`, the same builder web's `/poll` uses, so a poll made
 * on the phone is the card web members already vote on.
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

export interface PollDraft {
  question: string;
  /** One entry per option row, as typed; blank rows are allowed while editing. */
  options: string[];
  closes: PollCloseChoice;
}

/** A new poll starts with the two rows every poll needs. */
export function emptyPollDraft(): PollDraft {
  return {
    question: "",
    options: Array.from({ length: POLL_OPTIONS_MIN }, () => ""),
    closes: DEFAULT_POLL_CLOSE,
  };
}

/**
 * Whether this member may start a poll here: their role grants `polls:create`
 * and the chapter has Polls on (#3701, `spec/behavior/polls.md`). The module
 * gate is the server's too (#2993): a poll sent while Polls is off is refused.
 * Permissions still loading read as none, so the entry appears once they
 * answer rather than flickering in and out.
 */
export function canCreatePoll({
  permissions,
  enabledModules,
}: {
  permissions: readonly string[] | undefined;
  enabledModules: Record<string, boolean> | null | undefined;
}): boolean {
  return (
    isModuleEnabled(enabledModules, "polls") &&
    can("polls:create", permissions)
  );
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
    .map((option) => option.trim())
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
  return { ...draft, options: [...draft.options, ""] };
}

export function removePollOption(draft: PollDraft, index: number): PollDraft {
  if (!canRemovePollOption(draft)) return draft;
  if (index < 0 || index >= draft.options.length) return draft;
  return {
    ...draft,
    options: draft.options.filter((_, each) => each !== index),
  };
}

export function setPollOption(
  draft: PollDraft,
  index: number,
  text: string,
): PollDraft {
  if (index < 0 || index >= draft.options.length) return draft;
  const options = [...draft.options];
  options[index] = text;
  return { ...draft, options };
}

/** Moves one row up (`-1`) or down (`1`); a move off either end does nothing. */
export function movePollOption(
  draft: PollDraft,
  index: number,
  step: -1 | 1,
): PollDraft {
  const target = index + step;
  if (index < 0 || index >= draft.options.length) return draft;
  if (target < 0 || target >= draft.options.length) return draft;
  const options = [...draft.options];
  [options[index], options[target]] = [options[target]!, options[index]!];
  return { ...draft, options };
}
