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
 * Every method takes the member's id and filters on it: that filter is the
 * privacy boundary, since the table has RLS on and no policies and the API
 * reads it through the service role.
 */
export interface IChatFormResponseRepository {
  /** The member's answers to one form, or `null` before they answer. */
  findOwn(messageId: string, userId: string): Promise<ChatFormResponse | null>;
  /**
   * Which of these forms the member has answered: the ids among
   * `messageIds` that have a row of theirs. Reads no answers, so Activity can
   * tell a form that still needs them without loading what they wrote.
   */
  findAnsweredMessageIds(
    messageIds: string[],
    userId: string,
  ): Promise<string[]>;
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
}
