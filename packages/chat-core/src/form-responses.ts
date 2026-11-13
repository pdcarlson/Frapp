import { serverMessageOf, type components } from "@repo/api-sdk";
import type { FrappApiClient } from "./chat-client";
import {
  FORM_YES_NO_OPTIONS,
  isChoiceQuestion,
  type FormPayload,
  type FormQuestion,
} from "./forms";
import { isOwnMessage } from "./message-actions";
import type { ChatMessage } from "./types";

/**
 * A form's responses, for the member who posted it (#3926 step 4): what the
 * creator's Responses view and its export read, shared by web and the phone.
 * Modeled on Google Forms' Responses tab: a summary per question, each
 * person's answers, and who hasn't answered yet.
 *
 * The API returns user ids only (`GET …/form-responses`, creator only). Each
 * surface turns an id into the label it shows everywhere else for a member
 * (`actorLabel` in `@repo/hooks`), so a person reads the same on the card,
 * in this view and in its export, and an unnamed member is never mistaken
 * for one who left.
 */

/**
 * One member's saved answers (`created_at` first answered, `updated_at` last
 * changed), and the whole read: `responses` first answered first, and
 * `not_responded`, who can read the channel now and hasn't answered, the
 * creator left out. The generated contract types, so a change to the route
 * is a compile error here.
 */
export type FormResponseEntry = components["schemas"]["FormResponseEntryDto"];
export type FormResponses = components["schemas"]["FormResponsesDto"];

/** Turns a user id into the label a surface shows for that member. */
export type MemberLabel = (userId: string) => string;

/** The card's button for its creator, and the view's title. */
export const VIEW_RESPONSES_LABEL = "Responses";

/**
 * Whether the viewer may open a form's responses: only the member who posted
 * it, as the API decides (`ChatFormService.getResponses`). No permission
 * reaches them, `channels:manage` included.
 */
export function isFormCreator(
  message: Pick<ChatMessage, "sender_id">,
  viewerId: string | null,
): boolean {
  return isOwnMessage(message, viewerId);
}

/** The query key for a form's responses. */
export function formResponsesKey(messageId: string): readonly unknown[] {
  return ["chat", "form-responses", messageId] as const;
}

/**
 * Every response to a form and who hasn't answered, for its creator. Throws
 * the server's message on a refusal (anyone but the creator gets a 403).
 */
export async function fetchFormResponses(
  apiClient: FrappApiClient,
  messageId: string,
): Promise<FormResponses> {
  const { data, error } = await apiClient.GET(
    "/v1/channels/messages/{messageId}/form-responses",
    { params: { path: { messageId } } },
  );
  if (error || !data) {
    throw new Error(serverMessageOf(error) ?? "Couldn't load the responses");
  }
  return data;
}

/** "3 responses", the view's count. */
export function formResponsesCountLine(count: number): string {
  return `${count} ${count === 1 ? "response" : "responses"}`;
}

/** "Not answered yet (4)", the list of who hasn't answered. */
export function formNotRespondedLabel(count: number): string {
  return `Not answered yet (${count})`;
}

/**
 * One answer as words: the text, an option's label, the labels of every box
 * ticked (joined with ", "), or Yes / No. Empty when blank. An option id the
 * form no longer lists can't come back from the API (answers are checked
 * against the stored card), but reads as nothing rather than as an id.
 */
export function formAnswerText(
  question: FormQuestion,
  answer: string | string[] | undefined,
): string {
  if (answer === undefined) return "";
  if (question.type === "yes_no") {
    return FORM_YES_NO_OPTIONS.find((o) => o.id === answer)?.label ?? "";
  }
  if (isChoiceQuestion(question.type)) {
    const ids = Array.isArray(answer) ? answer : [answer];
    return ids
      .map((id) => question.options?.find((o) => o.id === id)?.label)
      .filter((label): label is string => !!label)
      .join(", ");
  }
  return typeof answer === "string" ? answer : "";
}

export interface FormChoiceCount {
  id: string;
  label: string;
  count: number;
}

/** One question's summary, as Google Forms' Summary tab draws it. */
export interface FormQuestionSummary {
  question: FormQuestion;
  /** How many responses answered it. */
  answered: number;
  /**
   * A choice or yes/no question's options, each with how many picked it, in
   * the question's order. A checkboxes response counts once per box ticked.
   */
  choices: FormChoiceCount[] | null;
  /** A text question's answers, first answered first. */
  texts: string[] | null;
}

/** The choices a question counts: its options, or Yes and No. */
function countedChoices(question: FormQuestion): FormChoiceCount[] | null {
  const options =
    question.type === "yes_no"
      ? FORM_YES_NO_OPTIONS
      : isChoiceQuestion(question.type)
        ? (question.options ?? [])
        : null;
  if (!options) return null;
  return options.map((o) => ({
    id: o.id,
    label: o.label,
    count: 0,
  }));
}

/** Every question's summary, in the form's order. */
export function summarizeFormResponses(
  payload: FormPayload,
  responses: readonly FormResponseEntry[],
): FormQuestionSummary[] {
  return payload.questions.map((question) => {
    const choices = countedChoices(question);
    const texts: string[] | null = choices ? null : [];
    let answered = 0;
    for (const response of responses) {
      const answer = response.answers[question.id];
      if (answer === undefined) continue;
      if (choices) {
        const ids = Array.isArray(answer) ? answer : [answer];
        let counted = false;
        for (const id of ids) {
          const choice = choices.find((c) => c.id === id);
          if (choice) {
            choice.count += 1;
            counted = true;
          }
        }
        if (counted) answered += 1;
      } else if (typeof answer === "string" && answer.trim() !== "") {
        texts!.push(answer);
        answered += 1;
      }
    }
    return { question, answered, choices, texts };
  });
}

/** "2 of 5 answered", under a question's title in the summary. */
export function formQuestionAnsweredLine(
  answered: number,
  responses: number,
): string {
  return `${answered} of ${responses} answered`;
}

/**
 * A choice's share of the responses that answered its question, 0 to 100,
 * for the summary's bar. On a checkboxes question the shares can add up to
 * more than 100, as Google Forms' do.
 */
export function formChoicePercent(count: number, answered: number): number {
  return answered === 0 ? 0 : Math.round((count / answered) * 100);
}

/**
 * The column for a question in an export: its number and title ("2. Which
 * room?"). Numbered so two questions with the same title stay two columns,
 * and so no header is a bare integer, which a JavaScript object would move
 * to the front of the row.
 */
export function formExportColumn(
  question: FormQuestion,
  index: number,
): string {
  return `${index + 1}. ${question.title}`;
}

/** Each export row's fixed columns, before the questions. */
export const FORM_EXPORT_NAME_COLUMN = "Name";
export const FORM_EXPORT_ANSWERED_COLUMN = "Answered at";
export const FORM_EXPORT_UPDATED_COLUMN = "Last changed";

/**
 * A form's responses as spreadsheet rows, one per response, first answered
 * first: the responder's label, when they answered and last changed it (ISO,
 * which every spreadsheet reads as a time), then one column per question.
 * Cells are plain text; the writer that turns them into a file makes
 * formula-shaped text inert (`toCsvCell` in `@repo/formatting`).
 */
export function formResponsesExportRows(
  payload: FormPayload,
  responses: readonly FormResponseEntry[],
  labelOf: MemberLabel,
): Record<string, string>[] {
  const columns = payload.questions.map(formExportColumn);
  return responses.map((response) => {
    const row: Record<string, string> = {
      [FORM_EXPORT_NAME_COLUMN]: labelOf(response.user_id),
      [FORM_EXPORT_ANSWERED_COLUMN]: response.created_at,
      [FORM_EXPORT_UPDATED_COLUMN]: response.updated_at,
    };
    payload.questions.forEach((question, index) => {
      row[columns[index]!] = formAnswerText(
        question,
        response.answers[question.id],
      );
    });
    return row;
  });
}

/**
 * An export's file name stem from a card's kind and title:
 * `form-room-picks`, `signup-snack-sign-up`. Letters and digits only, so it
 * is safe as one path segment on any system.
 */
export function cardExportFilenamePrefix(
  kind: "form" | "signup",
  title: string,
): string {
  const slug = title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40)
    .replace(/-+$/, "");
  return slug ? `${kind}-${slug}` : kind;
}
