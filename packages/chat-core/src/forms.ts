import { formatDueLabel, parseInstant } from "@repo/formatting";
import {
  FORM_CHOICE_QUESTION_TYPES,
  FORM_PARAGRAPH_ANSWER_MAX_LENGTH,
  FORM_QUESTION_TYPES,
  FORM_SHORT_ANSWER_MAX_LENGTH,
  type FormQuestionType,
} from "@repo/validation";
import { serverMessageOf, type components } from "@repo/api-sdk";
import type { FrappApiClient } from "./chat-client";
import { canActOnMessage, isOwnMessage } from "./message-actions";
import { makePollOptionId } from "./polls";
import type { ChatMessage } from "./types";

/**
 * Form cards in chat (`kind: "form"`, #3926 step 3): a questionnaire, like a
 * Google Form, posted as a card. The card shows the title, how many questions
 * it asks and whether the viewer has answered; tapping it opens the full-page
 * form. Shared by web and the phone so both read, check and save a form the
 * same way.
 *
 * Answers are private: they are never on the card or in
 * `chat_message_actions`. Each member's are one row the API reads back to
 * them (`GET` / `PUT /v1/channels/messages/{id}/form-response`) and to the
 * form's creator, and to no one else (`GET …/form-responses`, #3926 step 4).
 * A member may change them until the form closes. The API checks every answer
 * against the card (`form-card-rules.ts`); {@link formAnswerProblems} is the
 * same check, run in the form so a member sees what to fix before sending.
 */

export { FORM_QUESTION_TYPES };
export type { FormQuestionType };

/** The two answers a yes/no question takes, as stored. */
export const FORM_YES = "yes";
export const FORM_NO = "no";

export interface FormOption {
  id: string;
  label: string;
}

/**
 * A yes/no question's two answers with their words, in the order the fill
 * page offers them and the creator's summary counts them.
 */
export const FORM_YES_NO_OPTIONS: readonly FormOption[] = [
  { id: FORM_YES, label: "Yes" },
  { id: FORM_NO, label: "No" },
];

export interface FormQuestion {
  id: string;
  type: FormQuestionType;
  title: string;
  required: boolean;
  /** Only on a multiple-choice, checkboxes or dropdown question. */
  options?: FormOption[];
}

export interface FormPayload {
  title: string;
  description?: string;
  questions: FormQuestion[];
  /** When the form stops taking answers on its own (ISO), or absent. */
  closes_at?: string;
  /** Set by the server when the form is closed early. */
  closed_at?: string;
  closed_by?: string | null;
}

/**
 * One member's answers, keyed by question id: text, an option id, a list of
 * option ids for checkboxes, or `"yes"` / `"no"`. A blank question has no key.
 */
export type FormAnswers = Record<string, string | string[]>;

/** Whether a question lists options to pick from. */
export function isChoiceQuestion(type: FormQuestionType): boolean {
  return FORM_CHOICE_QUESTION_TYPES.includes(type);
}

/** What a member wrote in the form builder. */
export interface FormMessageInput {
  title: string;
  description?: string;
  questions: readonly {
    type: FormQuestionType;
    title: string;
    required: boolean;
    /** Option labels, for a choice question. */
    options?: readonly string[];
  }[];
  /** When the form closes, or absent for one that stays open. */
  closesAt?: Date | null;
}

/**
 * The `kind: "form"` message a client posts: `content` is the title, which is
 * what a notification, the channel preview and search read, and `payload` is
 * the card. The API checks and rebuilds it on send (`normalizeFormCard`), so
 * this only shapes it.
 */
export function buildFormMessage(
  input: FormMessageInput,
  makeId: () => string = makePollOptionId,
): { content: string; payload: FormPayload } {
  const title = input.title.trim();
  const description = input.description?.trim();
  return {
    content: title,
    payload: {
      title,
      ...(description ? { description } : {}),
      questions: input.questions.map((q) => ({
        id: makeId(),
        type: q.type,
        title: q.title.trim(),
        required: q.required,
        ...(isChoiceQuestion(q.type)
          ? {
              options: (q.options ?? []).map((label) => ({
                id: makeId(),
                label: label.trim(),
              })),
            }
          : {}),
      })),
      ...(input.closesAt ? { closes_at: input.closesAt.toISOString() } : {}),
    },
  };
}

function readOptions(raw: unknown): FormOption[] {
  if (!Array.isArray(raw)) return [];
  const options: FormOption[] = [];
  for (const entry of raw) {
    if (!entry || typeof entry !== "object") continue;
    const { id, label } = entry as Record<string, unknown>;
    if (typeof id === "string" && typeof label === "string") {
      options.push({ id, label });
    }
  }
  return options;
}

/**
 * The card in a message, or `null` when it can't be drawn. A question this
 * client can't read (a type added later) is left out, so the form still
 * opens; the server, which knows every type, still holds a required one to
 * an answer.
 */
export function readFormPayload(message: ChatMessage): FormPayload | null {
  const raw = message.payload;
  if (!raw || typeof raw !== "object") return null;
  const { title, description, questions, closes_at, closed_at, closed_by } =
    raw as Record<string, unknown>;
  if (typeof title !== "string" || !Array.isArray(questions)) return null;
  const parsed: FormQuestion[] = [];
  for (const entry of questions) {
    if (!entry || typeof entry !== "object") continue;
    const q = entry as Record<string, unknown>;
    const type = q.type as FormQuestionType;
    if (
      typeof q.id !== "string" ||
      typeof q.title !== "string" ||
      !FORM_QUESTION_TYPES.includes(type)
    ) {
      continue;
    }
    const question: FormQuestion = {
      id: q.id,
      type,
      title: q.title,
      required: q.required === true,
    };
    if (isChoiceQuestion(type)) question.options = readOptions(q.options);
    parsed.push(question);
  }
  if (parsed.length === 0) return null;
  return {
    title,
    ...(typeof description === "string" && description.trim() !== ""
      ? { description }
      : {}),
    questions: parsed,
    ...(typeof closes_at === "string" && closes_at !== "" ? { closes_at } : {}),
    ...(typeof closed_at === "string" && closed_at !== ""
      ? {
          closed_at,
          closed_by: typeof closed_by === "string" ? closed_by : null,
        }
      : {}),
  };
}

/**
 * Whether the form takes no more answers: closed early, or its end time has
 * come. The API's answer (`isCardClosed`), including `<=` at the end time.
 */
export function isFormClosed(payload: FormPayload, now: number): boolean {
  if (payload.closed_at) return true;
  const deadline = parseInstant(payload.closes_at);
  return deadline ? deadline.getTime() <= now : false;
}

/**
 * Whether the viewer is offered Close form: it is on the server and not
 * deleted, still open, and the viewer posted it or holds `channels:manage`.
 * The same rule as Close sign-ups; the API enforces it
 * (`ChatService.closeCard`).
 */
export function canCloseForm(
  message: Pick<ChatMessage, "sender_id" | "_status" | "is_deleted">,
  payload: FormPayload,
  viewerId: string | null,
  now: number,
  canManageChannels: boolean,
): boolean {
  return (
    (isOwnMessage(message, viewerId) || (canManageChannels && !!viewerId)) &&
    canActOnMessage(message) &&
    !isFormClosed(payload, now)
  );
}

/** Close form asks first, in the same words on web and the phone. */
export const CLOSE_FORM_LABEL = "Close form";
export const CLOSE_FORM_CONFIRM_TITLE = "Close this form?";
export const CLOSE_FORM_CONFIRM_BODY =
  "Nobody can answer or change their answers after this. Answers already sent stay.";
export const CLOSE_FORM_CONFIRM_LABEL = "Close form";

/**
 * Who sees a member's answers, said on the form page above the questions.
 * One string for web and the phone: it is a privacy claim, so the two must
 * never disagree. It names the ceiling (the poster will read them in step 4's
 * responses view), not only who can read them today.
 */
export const FORM_PRIVACY_NOTE =
  "Your answers aren't posted in the chat. Only you and the person who posted this form can see them.";

/**
 * The form page's line above the questions: the privacy note on an open
 * form, and on a closed one whether these are the answers sent. `loaded` is
 * whether the viewer's answers have been read at least once, so a closed form
 * never says "You didn't answer it" before they load.
 */
export function formPageNotice(
  closed: boolean,
  loaded: boolean,
  answered: boolean,
): string {
  if (!closed) return FORM_PRIVACY_NOTE;
  if (!loaded) return "This form is closed.";
  return answered
    ? "This form is closed. These are the answers you sent."
    : "This form is closed. You didn't answer it.";
}

/** Above Send once it was pressed with questions still to answer. */
export function formProblemCountLine(count: number): string {
  return count === 1
    ? "One question needs an answer."
    : `${count} questions need an answer.`;
}

/**
 * Whether the card knows the viewer has answered: `undefined` until their
 * answers are first read. Keyed on the data, not the query's status, so a
 * failed background refetch, which keeps the data, doesn't turn an answered
 * card back into Open.
 */
export function formAnsweredState(
  data: OwnFormResponse | null | undefined,
): boolean | undefined {
  return data === undefined ? undefined : data !== null;
}

/** "3 questions", the card's count line. */
export function formQuestionCountLine(payload: FormPayload): string {
  const n = payload.questions.length;
  return `${n} ${n === 1 ? "question" : "questions"}`;
}

/**
 * The card's status line under the count: closed, or when it closes, or
 * nothing for a form that stays open.
 */
export function formDeadlineLine(
  payload: FormPayload,
  now: number,
): string | null {
  if (isFormClosed(payload, now)) return "Closed";
  const deadline = parseInstant(payload.closes_at);
  return deadline ? `Closes ${formatDueLabel(deadline, new Date(now))}` : null;
}

/**
 * The card's button, by whether the viewer has answered and whether the form
 * still takes answers. `undefined` while their answer hasn't loaded: the card
 * then shows Open, which is right whatever comes back.
 */
export function formCardAction(
  answered: boolean | undefined,
  closed: boolean,
): { label: string; done: boolean } {
  if (answered === true) {
    return {
      label: closed ? "View your answers" : "Edit your answers",
      done: true,
    };
  }
  if (answered === undefined) return { label: "Open", done: false };
  return { label: closed ? "View" : "Fill out", done: false };
}

/**
 * What's wrong with a member's answers, by question id, in a member's words:
 * a blank required question, or an answer longer than its question takes.
 * Empty when the form can be sent. The same rules the API holds the answers
 * to; the API also refuses an option the form doesn't list, which the form's
 * own controls can't produce.
 */
export function formAnswerProblems(
  questions: readonly FormQuestion[],
  answers: FormAnswers,
): Record<string, string> {
  const problems: Record<string, string> = {};
  for (const question of questions) {
    const answer = answers[question.id];
    const blank =
      answer === undefined ||
      (typeof answer === "string" && answer.trim() === "") ||
      (Array.isArray(answer) && answer.length === 0);
    if (blank) {
      if (question.required)
        problems[question.id] = "This question is required.";
      continue;
    }
    if (typeof answer === "string") {
      const max =
        question.type === "short_answer"
          ? FORM_SHORT_ANSWER_MAX_LENGTH
          : question.type === "paragraph"
            ? FORM_PARAGRAPH_ANSWER_MAX_LENGTH
            : null;
      if (max !== null && answer.trim().length > max) {
        problems[question.id] = `Keep it to ${max} characters.`;
      }
    }
  }
  return problems;
}

/**
 * The answers to send: text trimmed, blanks and questions the form no longer
 * asks left out, checkboxes in the card's order.
 */
export function formAnswersForSave(
  questions: readonly FormQuestion[],
  answers: FormAnswers,
): FormAnswers {
  const out: FormAnswers = {};
  for (const question of questions) {
    const answer = answers[question.id];
    if (answer === undefined) continue;
    if (Array.isArray(answer)) {
      const picked = (question.options ?? [])
        .map((o) => o.id)
        .filter((id) => answer.includes(id));
      if (picked.length > 0) out[question.id] = picked;
      continue;
    }
    const text = isChoiceQuestion(question.type) ? answer : answer.trim();
    if (text !== "") out[question.id] = text;
  }
  return out;
}

/**
 * The viewer's own answers to a form, as the API returns them: the generated
 * contract type, so a change to the route is a compile error here.
 */
export type OwnFormResponse = components["schemas"]["FormResponseDto"];

/** The query key for the viewer's own answers to one form card. */
export function formResponseKey(messageId: string): readonly unknown[] {
  return ["chat", "form-response", messageId] as const;
}

/**
 * The viewer's own answers to a form card, or `null` before they answer.
 * Throws the server's message on a refusal, for the caller's query to show.
 */
export async function fetchOwnFormResponse(
  apiClient: FrappApiClient,
  messageId: string,
): Promise<OwnFormResponse | null> {
  const { data, error } = await apiClient.GET(
    "/v1/channels/messages/{messageId}/form-response",
    { params: { path: { messageId } } },
  );
  if (error || !data) {
    throw new Error(serverMessageOf(error) ?? "Couldn't load your answers");
  }
  return data.response ?? null;
}

/**
 * Save the viewer's answers, replacing their last ones. Not queued like a
 * message: a form is sent while the member is on it, and a refusal (a form
 * that closed a moment ago, a required answer) has to reach them there.
 * Throws the server's message on a refusal.
 */
export async function saveFormResponse(
  apiClient: FrappApiClient,
  messageId: string,
  answers: FormAnswers,
): Promise<OwnFormResponse> {
  const { data, error } = await apiClient.PUT(
    "/v1/channels/messages/{messageId}/form-response",
    { params: { path: { messageId } }, body: { answers } },
  );
  if (error || !data) {
    throw new Error(serverMessageOf(error) ?? "Couldn't send your answers");
  }
  return data;
}
