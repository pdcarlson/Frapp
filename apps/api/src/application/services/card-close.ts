import { BadRequestException } from '@nestjs/common';
import type { ChatMessage } from '#domain/entities/chat.entity';
import type { IChatMessageRepository } from '#domain/repositories/chat.repository.interface';

/**
 * Stamp a chat card closed early (`closed_at` / `closed_by` on its payload):
 * a poll card (`PollService`, #3794) or a sign-up card (`ChatService`,
 * #3926). Each caller has already decided who may close it and that it is
 * still open; this is the write both share.
 *
 * Only while the card is live: `payload` was read before this write, and a
 * delete landing in between cleared it (#1575). An unconditional update would
 * put the removed card back on the tombstone, so a lost race is refused with
 * `deletedMessage`.
 */
export async function stampCardClosed(
  messageRepo: Pick<IChatMessageRepository, 'updateIfLive'>,
  message: Pick<ChatMessage, 'id'>,
  payload: Record<string, unknown>,
  userId: string,
  deletedMessage: string,
): Promise<ChatMessage> {
  const closed = await messageRepo.updateIfLive(message.id, {
    payload: {
      ...payload,
      closed_at: new Date().toISOString(),
      closed_by: userId,
    },
  });
  if (!closed) throw new BadRequestException(deletedMessage);
  return closed;
}
