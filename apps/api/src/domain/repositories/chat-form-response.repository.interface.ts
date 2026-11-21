import type { ChatFormResponse } from '../entities/chat.entity';

export const CHAT_FORM_RESPONSE_REPOSITORY = 'CHAT_FORM_RESPONSE_REPOSITORY';

/**
 * Why `save_chat_form_response` refused a save: the card is gone, deleted or
 * not a form (`missing`), or it takes no more answers (`closed`).
 */
export class FormResponseRefusedError extends Error {
  constructor(public readonly reason: 'missing' | 'closed') {
    super(`Form response refused: ${reason}`);
    this.name = 'FormResponseRefusedError';
  }
}

/**
 * Members' answers to form cards in chat (#3926 step 3).
 *
 * Every method but {@link IChatFormResponseRepository.findAllForCreator}
 * takes the member's id and filters on it: that filter is the privacy boundary, since the table has RLS on and no policies and the API
 * reads it through the service role.
 */
export interface IChatFormResponseRepository {
  /** The member's answers to one form, or `null` before they answer. */
  findOwn(messageId: string, userId: string): Promise<ChatFormResponse | null>;
  /**
   * Which of these forms the member has answered, and when they first did:
   * the ids among `messageIds` that have a row of theirs. Reads no answers,
   * so Activity can tell a form that still needs them, and one they answered
   * this week, without loading what they wrote.
   */
  findAnswered(
    messageIds: string[],
    userId: string,
  ): Promise<Pick<ChatFormResponse, 'message_id' | 'created_at'>[]>;
  /**
   * Write the member's answers (inserted, or replacing their last ones).
   * Throws {@link FormResponseRefusedError} when the card is missing or
   * closed, decided under a lock on the card. No chapter argument: the caller
   * has already authorized the member against the card's channel and checked
   * the answers against its questions.
   */
  save(
    messageId: string,
    userId: string,
    answers: Record<string, string | string[]>,
  ): Promise<ChatFormResponse>;
  /**
   * Every member's answers to one form, oldest first, for the form's creator
   * (#3926 step 4). The one read that is not filtered on a member: the caller
   * (`ChatFormService.getResponses`) must have checked that the reader is
   * the card's sender before calling it.
   */
  findAllForCreator(messageId: string): Promise<ChatFormResponse[]>;
}
