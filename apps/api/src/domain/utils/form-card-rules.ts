import {
  FORM_CHOICE_QUESTION_TYPES,
  FORM_DESCRIPTION_MAX_LENGTH,
  FORM_OPTION_LABEL_MAX_LENGTH,
  FORM_OPTIONS_MAX,
  FORM_PARAGRAPH_ANSWER_MAX_LENGTH,
  FORM_QUESTION_TITLE_MAX_LENGTH,
  FORM_QUESTION_TYPES,
  FORM_QUESTIONS_MAX,
  FORM_SHORT_ANSWER_MAX_LENGTH,
  FORM_TITLE_MAX_LENGTH,
  type FormQuestionType,
} from '@repo/validation';
import { normalizeClosesAt } from './card-closing';

/**
 * Rules for a form card in chat (`kind: 'form'`, #3926 step 3): a
 * questionnaire, like a Google Form, posted as a card that opens a full-page
 * form.
 *
 * The card is a chat message a member composes, so it is checked and rebuilt
 * on send (`ChatService.sendMessage`), the way a sign-up card is: the answer
 * route reads its questions to check every answer, so a question without a
 * usable id or type would otherwise be stored and trusted.
 *
 * A member's answers are **not** on the card and not in
 * `chat_message_actions`, which every member of the channel reads. They are
 * one `chat_form_responses` row per member per form, read only through the
 * API by the member who wrote it (and, in step 4, the form's creator).
 *
 * A form shares a sign-up's end time (`closes_at`) and early close
 * (`closed_at` / `closed_by`, written only by `ChatService.closeCard`). A
 * member may change their answers until then.
 */

/** The longest question or option id a card may carry. Clients make 8. */
const ID_MAX_LENGTH = 32;

/** The two answers a yes/no question takes, as stored. */
export const FORM_YES = 'yes';
export const FORM_NO = 'no';

export interface FormOption {
  id: string;
  label: string;
}

export interface FormQuestion {
  id: string;
  type: FormQuestionType;
  title: string;
  required: boolean;
  /** Only on a multiple-choice, checkboxes or dropdown question. */
  options?: FormOption[];
}

export interface FormCard {
  title: string;
  /** Text under the title, or absent. */
  description?: string;
  questions: FormQuestion[];
  /** When the form stops taking answers on its own (ISO), or absent. */
  closes_at?: string;
  /** Set only by `ChatService.closeCard`; never taken from a client. */
  closed_at?: string;
  closed_by?: string;
}

/**
 * One member's answers, keyed by question id: the text for a short-answer or
 * paragraph question, the option id for a multiple-choice or dropdown one,
 * the option ids for checkboxes, and `'yes'` or `'no'`. A question left blank
 * has no key.
 */
export type FormAnswers = Record<string, string | string[]>;

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function isChoiceType(type: FormQuestionType): boolean {
  return FORM_CHOICE_QUESTION_TYPES.includes(type);
}

function normalizeOptions(
  raw: unknown,
): { options: FormOption[] } | { error: string } {
  if (!Array.isArray(raw) || raw.length === 0) {
    return { error: 'A choice question needs at least one option' };
  }
  if (raw.length > FORM_OPTIONS_MAX) {
    return {
      error: `A question can have at most ${FORM_OPTIONS_MAX} options`,
    };
  }
  const seen = new Set<string>();
  const options: FormOption[] = [];
  for (const entry of raw as unknown[]) {
    if (!isRecord(entry)) return { error: 'Each option needs an id and text' };
    const id = typeof entry.id === 'string' ? entry.id.trim() : '';
    const label = typeof entry.label === 'string' ? entry.label.trim() : '';
    if (!id || id.length > ID_MAX_LENGTH || !label) {
      return { error: 'Each option needs an id and text' };
    }
    if (seen.has(id)) return { error: 'Each option needs its own id' };
    seen.add(id);
    if (label.length > FORM_OPTION_LABEL_MAX_LENGTH) {
      return {
        error: `An option can be at most ${FORM_OPTION_LABEL_MAX_LENGTH} characters`,
      };
    }
    options.push({ id, label });
  }
  return { options };
}

function normalizeQuestion(
  entry: unknown,
): { question: FormQuestion } | { error: string } {
  if (!isRecord(entry)) {
    return { error: 'Each question needs an id, a type and a question' };
  }
  const id = typeof entry.id === 'string' ? entry.id.trim() : '';
  const title = typeof entry.title === 'string' ? entry.title.trim() : '';
  const type = entry.type as FormQuestionType;
  if (!id || id.length > ID_MAX_LENGTH || !title) {
    return { error: 'Each question needs an id, a type and a question' };
  }
  if (!FORM_QUESTION_TYPES.includes(type)) {
    return { error: 'Unknown question type' };
  }
  if (title.length > FORM_QUESTION_TITLE_MAX_LENGTH) {
    return {
      error: `A question can be at most ${FORM_QUESTION_TITLE_MAX_LENGTH} characters`,
    };
  }
  if (entry.required != null && typeof entry.required !== 'boolean') {
    return { error: 'A question’s required setting must be true or false' };
  }
  const question: FormQuestion = {
    id,
    type,
    title,
    required: entry.required === true,
  };
  if (isChoiceType(type)) {
    const checked = normalizeOptions(entry.options);
    if ('error' in checked) return checked;
    question.options = checked.options;
  }
  return { question };
}

/**
 * The card as it is stored, or the reason it can't be. Text is trimmed; a
 * blank description is dropped; options on a question that takes none are
 * dropped; any key the card doesn't define is left out, which includes a
 * client's attempt at server-written fields.
 */
export function normalizeFormCard(
  payload: unknown,
  now: number = Date.now(),
): { card: FormCard } | { error: string } {
  if (!isRecord(payload)) {
    return { error: 'A form needs a title and at least one question' };
  }

  const title = typeof payload.title === 'string' ? payload.title.trim() : '';
  if (!title) return { error: 'A form needs a title' };
  if (title.length > FORM_TITLE_MAX_LENGTH) {
    return {
      error: `A form’s title can be at most ${FORM_TITLE_MAX_LENGTH} characters`,
    };
  }

  let description: string | undefined;
  if (payload.description != null) {
    if (typeof payload.description !== 'string') {
      return { error: 'A form’s description must be text' };
    }
    const trimmed = payload.description.trim();
    if (trimmed.length > FORM_DESCRIPTION_MAX_LENGTH) {
      return {
        error: `A form’s description can be at most ${FORM_DESCRIPTION_MAX_LENGTH} characters`,
      };
    }
    if (trimmed) description = trimmed;
  }

  if (!Array.isArray(payload.questions) || payload.questions.length === 0) {
    return { error: 'A form needs at least one question' };
  }
  if (payload.questions.length > FORM_QUESTIONS_MAX) {
    return {
      error: `A form can have at most ${FORM_QUESTIONS_MAX} questions`,
    };
  }
  const seen = new Set<string>();
  const questions: FormQuestion[] = [];
  for (const entry of payload.questions as unknown[]) {
    const checked = normalizeQuestion(entry);
    if ('error' in checked) return checked;
    if (seen.has(checked.question.id)) {
      return { error: 'Each question needs its own id' };
    }
    seen.add(checked.question.id);
    questions.push(checked.question);
  }

  const closing = normalizeClosesAt(payload.closes_at, 'A form', now);
  if ('error' in closing) return closing;

  return {
    card: {
      title,
      ...(description ? { description } : {}),
      questions,
      ...(closing.closesAt ? { closes_at: closing.closesAt } : {}),
    },
  };
}

/**
 * The questions a stored card asks. The card was checked on send, so this
 * only guards against a row nobody could have sent (a hand-edited one): a
 * question it can't read is skipped rather than failing the whole form.
 */
export function formQuestions(payload: unknown): FormQuestion[] {
  if (!isRecord(payload) || !Array.isArray(payload.questions)) return [];
  const questions: FormQuestion[] = [];
  for (const entry of payload.questions as unknown[]) {
    const checked = normalizeQuestion(entry);
    if ('question' in checked) questions.push(checked.question);
  }
  return questions;
}

function answerFor(
  question: FormQuestion,
  raw: unknown,
): { answer: string | string[] | null } | { error: string } {
  if (raw == null) return { answer: null };
  const optionIds = new Set((question.options ?? []).map((o) => o.id));
  switch (question.type) {
    case 'short_answer':
    case 'paragraph': {
      if (typeof raw !== 'string') return { error: 'An answer must be text' };
      const text = raw.trim();
      const max =
        question.type === 'short_answer'
          ? FORM_SHORT_ANSWER_MAX_LENGTH
          : FORM_PARAGRAPH_ANSWER_MAX_LENGTH;
      if (text.length > max) {
        return { error: `An answer can be at most ${max} characters` };
      }
      return { answer: text || null };
    }
    case 'multiple_choice':
    case 'dropdown': {
      if (typeof raw !== 'string') {
        return { error: 'Pick one of the question’s options' };
      }
      if (raw === '') return { answer: null };
      if (!optionIds.has(raw)) {
        return { error: 'Pick one of the question’s options' };
      }
      return { answer: raw };
    }
    case 'checkboxes': {
      if (!Array.isArray(raw)) {
        return { error: 'Pick from the question’s options' };
      }
      const picked: string[] = [];
      for (const id of raw as unknown[]) {
        if (typeof id !== 'string' || !optionIds.has(id)) {
          return { error: 'Pick from the question’s options' };
        }
        if (!picked.includes(id)) picked.push(id);
      }
      // Kept in the card's order, so two saves of the same picks are equal.
      const ordered = (question.options ?? [])
        .map((o) => o.id)
        .filter((id) => picked.includes(id));
      return { answer: ordered.length > 0 ? ordered : null };
    }
    case 'yes_no': {
      if (raw === '') return { answer: null };
      if (raw !== FORM_YES && raw !== FORM_NO) {
        return { error: 'Answer yes or no' };
      }
      return { answer: raw };
    }
  }
}

/**
 * A member's answers as they are stored, or the reason they can't be. Each
 * answer is checked against its question; a blank answer is dropped; a
 * required question left blank, or an answer to a question the form doesn't
 * ask, is refused.
 */
export function normalizeFormAnswers(
  questions: readonly FormQuestion[],
  raw: unknown,
): { answers: FormAnswers } | { error: string } {
  if (!isRecord(raw)) return { error: 'Answers must be keyed by question' };
  const byId = new Map(questions.map((q) => [q.id, q]));
  for (const id of Object.keys(raw)) {
    if (!byId.has(id)) {
      return { error: 'An answer names a question the form doesn’t ask' };
    }
  }
  const answers: FormAnswers = {};
  for (const question of questions) {
    const checked = answerFor(question, raw[question.id]);
    if ('error' in checked) return checked;
    if (checked.answer === null) {
      if (question.required) {
        return { error: 'Answer every required question' };
      }
      continue;
    }
    answers[question.id] = checked.answer;
  }
  return { answers };
}
