import {
  FORM_DESCRIPTION_MAX_LENGTH,
  FORM_OPTION_LABEL_MAX_LENGTH,
  FORM_OPTIONS_MAX,
  FORM_QUESTION_TITLE_MAX_LENGTH,
  FORM_QUESTIONS_MAX,
  FORM_TITLE_MAX_LENGTH,
  SIGNUP_CLOSES_AT_MAX_AHEAD_DAYS,
  type FormQuestionType,
} from "@repo/validation";
import { isChoiceQuestion, type FormMessageInput } from "./forms";

/**
 * The New form builder's draft (#3926 step 3), shared by web's + card and the
 * phone's sheet so both build, check and post a form the same way. A form is a
 * title, optional details, an ordered list of questions, and optionally an end
 * time. The card it posts is `buildFormMessage`'s (`./forms`).
 */

/** Each question type as the builder names it, in the order it offers them. */
export const FORM_QUESTION_TYPE_CHOICES: readonly {
  id: FormQuestionType;
  label: string;
}[] = [
  { id: "multiple_choice", label: "Multiple choice" },
  { id: "checkboxes", label: "Checkboxes" },
  { id: "dropdown", label: "Dropdown" },
  { id: "short_answer", label: "Short answer" },
  { id: "paragraph", label: "Paragraph" },
  { id: "yes_no", label: "Yes or no" },
];

export function formQuestionTypeLabel(type: FormQuestionType): string {
  return (
    FORM_QUESTION_TYPE_CHOICES.find((choice) => choice.id === type)?.label ??
    type
  );
}

export interface FormOptionRow {
  key: string;
  label: string;
}

export interface FormQuestionRow {
  key: string;
  type: FormQuestionType;
  title: string;
  required: boolean;
  /**
   * Kept when the member switches to a type that takes none, so switching
   * back loses nothing; only a choice question posts them.
   */
  options: FormOptionRow[];
}

export interface FormDraft {
  title: string;
  description: string;
  questions: FormQuestionRow[];
  /** When the form closes, or `null` for one that stays open until closed. */
  closesAt: Date | null;
}

let nextRowKey = 0;
function rowKey(prefix: string): string {
  nextRowKey += 1;
  return `${prefix}-${nextRowKey}`;
}

function newOptionRow(): FormOptionRow {
  return { key: rowKey("option"), label: "" };
}

function newQuestionRow(
  type: FormQuestionType = "multiple_choice",
): FormQuestionRow {
  return {
    key: rowKey("question"),
    type,
    title: "",
    required: false,
    options: [newOptionRow(), newOptionRow()],
  };
}

/**
 * A new form starts with one multiple-choice question and two blank options,
 * as Google Forms starts with one.
 */
export function emptyFormDraft(): FormDraft {
  return {
    title: "",
    description: "",
    questions: [newQuestionRow()],
    closesAt: null,
  };
}

export function canAddFormQuestion(draft: FormDraft): boolean {
  return draft.questions.length < FORM_QUESTIONS_MAX;
}

export function canRemoveFormQuestion(draft: FormDraft): boolean {
  return draft.questions.length > 1;
}

/** A new question takes the type of the one before it, as Google Forms does. */
export function addFormQuestion(draft: FormDraft): FormDraft {
  if (!canAddFormQuestion(draft)) return draft;
  const last = draft.questions[draft.questions.length - 1];
  return {
    ...draft,
    questions: [...draft.questions, newQuestionRow(last?.type)],
  };
}

export function removeFormQuestion(draft: FormDraft, key: string): FormDraft {
  if (!canRemoveFormQuestion(draft)) return draft;
  return {
    ...draft,
    questions: draft.questions.filter((row) => row.key !== key),
  };
}

/** Moves a question one place up (`-1`) or down (`1`); a no-op at either end. */
export function moveFormQuestion(
  draft: FormDraft,
  key: string,
  by: -1 | 1,
): FormDraft {
  const from = draft.questions.findIndex((row) => row.key === key);
  const to = from + by;
  if (from < 0 || to < 0 || to >= draft.questions.length) return draft;
  const questions = [...draft.questions];
  const [row] = questions.splice(from, 1);
  questions.splice(to, 0, row!);
  return { ...draft, questions };
}

/**
 * Changes a question's type, text or required setting. A choice question
 * always has at least one option row to type in.
 */
export function setFormQuestion(
  draft: FormDraft,
  key: string,
  patch: Partial<Pick<FormQuestionRow, "type" | "title" | "required">>,
): FormDraft {
  return {
    ...draft,
    questions: draft.questions.map((row) => {
      if (row.key !== key) return row;
      const next = { ...row, ...patch };
      if (isChoiceQuestion(next.type) && next.options.length === 0) {
        next.options = [newOptionRow()];
      }
      return next;
    }),
  };
}

function patchQuestion(
  draft: FormDraft,
  key: string,
  change: (row: FormQuestionRow) => FormQuestionRow,
): FormDraft {
  return {
    ...draft,
    questions: draft.questions.map((row) =>
      row.key === key ? change(row) : row,
    ),
  };
}

export function canAddFormOption(question: FormQuestionRow): boolean {
  return question.options.length < FORM_OPTIONS_MAX;
}

export function canRemoveFormOption(question: FormQuestionRow): boolean {
  return question.options.length > 1;
}

export function addFormOption(
  draft: FormDraft,
  questionKey: string,
): FormDraft {
  return patchQuestion(draft, questionKey, (row) =>
    canAddFormOption(row)
      ? { ...row, options: [...row.options, newOptionRow()] }
      : row,
  );
}

export function removeFormOption(
  draft: FormDraft,
  questionKey: string,
  optionKey: string,
): FormDraft {
  return patchQuestion(draft, questionKey, (row) =>
    canRemoveFormOption(row)
      ? { ...row, options: row.options.filter((o) => o.key !== optionKey) }
      : row,
  );
}

export function setFormOption(
  draft: FormDraft,
  questionKey: string,
  optionKey: string,
  label: string,
): FormDraft {
  return patchQuestion(draft, questionKey, (row) => ({
    ...row,
    options: row.options.map((o) =>
      o.key === optionKey ? { ...o, label } : o,
    ),
  }));
}

export type FormDraftCheck =
  | { ok: true; input: FormMessageInput }
  /**
   * `problem` is what to tell the member, or `null` when the draft is only
   * unfinished (no title, no question written yet), which the held Post
   * button says well enough. `questionKey` points at the question it is about.
   */
  | { ok: false; problem: string | null; questionKey?: string };

export const FORM_END_PASSED_PROBLEM =
  "That end time has passed. Pick a later one, or none.";
export const FORM_END_TOO_FAR_PROBLEM =
  "A form can close at most a year from now.";

/** The API's furthest end time, less a day of slack (as sign-ups do). */
const FORM_END_MAX_AHEAD_MS =
  (SIGNUP_CLOSES_AT_MAX_AHEAD_DAYS - 1) * 24 * 60 * 60 * 1000;

/**
 * Whether the draft can be posted, and what it posts. A question with no
 * text and no option typed is skipped, as a blank poll option is; one with
 * options but no text reads as a question the member forgot to write. A
 * blank option is skipped. The limits are the API's (`normalizeFormCard`).
 */
export function checkFormDraft(
  draft: FormDraft,
  now: number = Date.now(),
): FormDraftCheck {
  const title = draft.title.trim();
  const description = draft.description.trim();
  if (title.length > FORM_TITLE_MAX_LENGTH) {
    return {
      ok: false,
      problem: `A title can be at most ${FORM_TITLE_MAX_LENGTH} characters.`,
    };
  }
  if (description.length > FORM_DESCRIPTION_MAX_LENGTH) {
    return {
      ok: false,
      problem: `Details can be at most ${FORM_DESCRIPTION_MAX_LENGTH} characters.`,
    };
  }
  const closesAt = draft.closesAt;
  if (closesAt) {
    if (Number.isNaN(closesAt.getTime()) || closesAt.getTime() <= now) {
      return { ok: false, problem: FORM_END_PASSED_PROBLEM };
    }
    if (closesAt.getTime() > now + FORM_END_MAX_AHEAD_MS) {
      return { ok: false, problem: FORM_END_TOO_FAR_PROBLEM };
    }
  }

  const questions: FormMessageInput["questions"][number][] = [];
  for (const row of draft.questions) {
    const text = row.title.trim();
    const choice = isChoiceQuestion(row.type);
    const options = choice
      ? row.options.map((o) => o.label.trim()).filter((label) => label !== "")
      : [];
    if (!text) {
      if (options.length > 0) {
        return {
          ok: false,
          problem: "Write this question, or remove it.",
          questionKey: row.key,
        };
      }
      continue;
    }
    if (text.length > FORM_QUESTION_TITLE_MAX_LENGTH) {
      return {
        ok: false,
        problem: `A question can be at most ${FORM_QUESTION_TITLE_MAX_LENGTH} characters.`,
        questionKey: row.key,
      };
    }
    if (choice) {
      if (options.length === 0) {
        return {
          ok: false,
          problem: "Give this question at least one option.",
          questionKey: row.key,
        };
      }
      const seen = new Set<string>();
      for (const label of options) {
        if (label.length > FORM_OPTION_LABEL_MAX_LENGTH) {
          return {
            ok: false,
            problem: `An option can be at most ${FORM_OPTION_LABEL_MAX_LENGTH} characters.`,
            questionKey: row.key,
          };
        }
        const folded = label.toLowerCase().replace(/\s+/g, " ");
        if (seen.has(folded)) {
          return {
            ok: false,
            problem: "Two options in this question are the same. Change one.",
            questionKey: row.key,
          };
        }
        seen.add(folded);
      }
    }
    questions.push({
      type: row.type,
      title: text,
      required: row.required,
      ...(choice ? { options } : {}),
    });
  }

  if (!title || questions.length === 0) return { ok: false, problem: null };
  return {
    ok: true,
    input: {
      title,
      ...(description ? { description } : {}),
      questions,
      ...(closesAt ? { closesAt } : {}),
    },
  };
}
