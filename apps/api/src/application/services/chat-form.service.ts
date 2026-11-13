import { BadRequestException, Inject, Injectable } from '@nestjs/common';
import type { ChatFormResponse } from '#domain/entities/chat.entity';
import {
  CHAT_FORM_RESPONSE_REPOSITORY,
  FormResponseRefusedError,
  type IChatFormResponseRepository,
} from '#domain/repositories/chat-form-response.repository.interface';
import { isCardClosed } from '#domain/utils/card-closing';
import {
  formQuestions,
  normalizeFormAnswers,
} from '#domain/utils/form-card-rules';
import { ChannelAccessService } from './channel-access.service';

/** The refusal on a form that takes no more answers, keyed by member copy. */
export const FORM_CLOSED = 'This form is closed';

/** The refusal on a message that is not a form card. */
const NOT_A_FORM = 'Message is not a form card';

/** What a member reads back of their own answers. */
export interface OwnFormResponse {
  answers: ChatFormResponse['answers'];
  updated_at: string;
}

/**
 * Members' answers to form cards in chat (#3926 step 3).
 *
 * A member reads and writes only their own answers. Reading them back is a
 * channel read. Saving is the `answer` check: anyone who can see the card can
 * answer it, as with a sign-up claim, but not in an archived channel or the
 * audit log, which take no writes (and where Close form is refused too). Nobody else's answers are reachable
 * here; the creator's responses view is step 4.
 */
@Injectable()
export class ChatFormService {
  constructor(
    @Inject(CHAT_FORM_RESPONSE_REPOSITORY)
    private readonly responseRepo: IChatFormResponseRepository,
    private readonly channelAccess: ChannelAccessService,
  ) {}

  /**
   * The member's answers to a form card, or `null` before they answer. A
   * deleted card reads as unanswered: its questions are gone with its
   * payload, so there is nothing to show the answers against.
   */
  async getOwnResponse(
    messageId: string,
    chapterId: string,
    userId: string,
  ): Promise<OwnFormResponse | null> {
    const message = await this.channelAccess.assertMessageAccess(
      messageId,
      chapterId,
      userId,
    );
    if (message.kind !== 'form') throw new BadRequestException(NOT_A_FORM);
    if (message.is_deleted) return null;
    const row = await this.responseRepo.findOwn(messageId, userId);
    return row ? { answers: row.answers, updated_at: row.updated_at } : null;
  }

  /**
   * Save the member's answers, replacing their last ones: a member may change
   * them until the form closes. Every answer is checked against the card's
   * questions; a required question left blank is a 400, as is a closed or
   * deleted form.
   */
  async saveResponse(
    messageId: string,
    chapterId: string,
    userId: string,
    rawAnswers: unknown,
  ): Promise<OwnFormResponse> {
    const message = await this.channelAccess.assertMessageAccess(
      messageId,
      chapterId,
      userId,
      'answer',
    );
    if (message.kind !== 'form') throw new BadRequestException(NOT_A_FORM);
    if (message.is_deleted) {
      throw new BadRequestException('Cannot act on a deleted message');
    }
    // The RPC decides this again under its lock; this spares the round trip
    // for a form that was closed when it was read.
    if (isCardClosed(message.payload)) {
      throw new BadRequestException(FORM_CLOSED);
    }
    const checked = normalizeFormAnswers(
      formQuestions(message.payload),
      rawAnswers,
    );
    if ('error' in checked) throw new BadRequestException(checked.error);
    try {
      const row = await this.responseRepo.save(
        messageId,
        userId,
        checked.answers,
      );
      return { answers: row.answers, updated_at: row.updated_at };
    } catch (error) {
      if (!(error instanceof FormResponseRefusedError)) throw error;
      if (error.reason === 'closed') throw new BadRequestException(FORM_CLOSED);
      // Deleted between the access check and the lock.
      throw new BadRequestException('Cannot act on a deleted message');
    }
  }
}
