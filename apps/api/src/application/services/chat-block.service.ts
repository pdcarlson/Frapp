import {
  BadRequestException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { CHAT_MEMBER_BLOCK_REPOSITORY } from '#domain/repositories/chat-moderation.repository.interface';
import type { IChatMemberBlockRepository } from '#domain/repositories/chat-moderation.repository.interface';
import {
  MEMBER_REPOSITORY,
  type IMemberRepository,
} from '#domain/repositories/member.repository.interface';
import type { ChatMemberBlockRef } from '#domain/entities/chat-moderation.entity';
import { SYSTEM_SENDER_ID } from '#domain/constants/chat';

/**
 * Per-chapter member blocking (#2257), per `spec/behavior/chat/README.md`
 * § Report and block.
 *
 * **The no-oracle rule is the whole design, so read it before adding anything
 * here.** A block is enforced by *not delivering*, never by refusing. Nothing
 * in this service, and nothing that consumes it, may refuse an action *because*
 * a block exists: a distinct error on DM creation, a different status code, a
 * missing member in a picker — any of them is enough to binary-search the
 * roster and enumerate exactly who has blocked you. The blocked member keeps
 * opening threads and sending into them and keeps seeing the ordinary success
 * they would see anyway; what changes is that nothing they send reaches the
 * blocker. The masking half of that lives in
 * `maskBlockedMessages` in `chat-block-mask.ts`.
 *
 * Its own service rather than more of `ChatService`, for the reason
 * `ChatBookmarkService`'s docblock gives: `ChatService` is already several
 * concerns deep and #1380 is open to split it. What it shares with the rest of
 * chat is two reads, and they are injections rather than a merge — which is why
 * it is exported from `ChatBlockModule` and not owned by `ChatModule`:
 *
 * - {@link listBlockedUserIds}, the masking set, read by the surfaces that
 *   serve message content to a named viewer, and served to clients by
 *   `GET /v1/chat/blocks` so they can mask the Realtime echo themselves.
 * - {@link filterOutBlockers}, the audience filter, read by whatever notifies:
 *   the push worker and `ChatService`'s DM and announcement notifications.
 *
 * Which surfaces those are, and which are still open, is kept in exactly one
 * place: `apps/api/src/application/services/chat-read-surface-ledger.spec.ts`.
 * A new chat route that is not classified there fails rather than shipping.
 */
@Injectable()
export class ChatBlockService {
  constructor(
    @Inject(CHAT_MEMBER_BLOCK_REPOSITORY)
    private readonly blockRepo: IChatMemberBlockRepository,
    @Inject(MEMBER_REPOSITORY)
    private readonly memberRepo: IMemberRepository,
  ) {}

  /**
   * The caller's own blocked user ids in this chapter.
   *
   * The same rows serve both halves of the masking contract. `GET
   * /v1/chat/blocks` hands the list to the client, because the server's
   * projection is not sufficient on its own: mobile and web also receive
   * message rows over a Supabase Realtime `postgres_changes` echo, which
   * delivers the raw row with no viewer attached and therefore cannot be
   * server-masked. Every server read surface that masks at read time uses the
   * same method, and every one of them depends on the throw below. (The
   * notification list's chat rows are masked at write time instead, by
   * {@link filterOutBlockers}.)
   *
   * **Never takes a user id from the caller.** The owner is always
   * `@CurrentUser('id')`, so there is no parameter through which one member
   * could read another's list — which is the same structural argument that
   * keeps bookmarks private, and here it is a safety property rather than a
   * courtesy.
   *
   * Errors propagate. A failed read must not degrade to an empty list: "a block
   * list that cannot be read is not an empty block list", and swallowing the
   * error here would silently unmask every blocked member for the duration of a
   * database blip.
   */
  async listBlockedUserIds(
    chapterId: string,
    blockerUserId: string,
  ): Promise<string[]> {
    return this.blockRepo.findBlockedUserIds(chapterId, blockerUserId);
  }

  /**
   * Drop, from an already-authorized audience, everyone who has blocked
   * `senderUserId` in this chapter.
   *
   * **At the audience level, deliberately, and not by blanking a preview.** The
   * push worker's other option was to mask the notification body, and that
   * would still have delivered a push and still have persisted a notification
   * row — a buzz on the blocker's phone every time the member they blocked
   * posts, which is the harassment channel the feature closes. A mention is the
   * sharpest case: `decidePush` returns `send` on a mention *before* the level
   * check, so a blocked member could force a push through a channel the blocker
   * had deliberately muted.
   *
   * This is the inverse of {@link listBlockedUserIds}, so it is bounded on
   * purpose: it intersects with a recipient list the worker already holds for
   * another reason, and it never enumerates blockers. See
   * `IChatMemberBlockRepository.findBlockersAmong`.
   *
   * Errors propagate, exactly as they do on the read path. The worker runs the
   * whole fan-out for one message inside a try/catch, so a throw here costs
   * that message its notifications for everybody — which is the fail-closed
   * side. Silently returning the unfiltered audience would push a blocked
   * member's content to the blocker's lock screen for as long as the table was
   * unreachable, and nothing would say so.
   *
   * A `null` sender (an imported archive row) has nobody to have blocked, so
   * the audience is returned untouched; the worker refuses imported rows long
   * before this anyway.
   */
  async filterOutBlockers(
    chapterId: string,
    senderUserId: string | null,
    recipientUserIds: string[],
  ): Promise<string[]> {
    if (!senderUserId || recipientUserIds.length === 0) {
      return recipientUserIds;
    }
    const blockers = await this.blockRepo.findBlockersAmong(
      chapterId,
      senderUserId,
      recipientUserIds,
    );
    if (blockers.size === 0) return recipientUserIds;
    return recipientUserIds.filter((userId) => !blockers.has(userId));
  }

  /**
   * Block a member of this chapter, idempotently.
   *
   * The two refusals here are both about the *target*, and neither is
   * observable by the person being blocked, so neither is an oracle:
   *
   * - **Yourself** — the DB carries `chat_member_blocks_not_self` for this, and
   *   without the check in front of it the constraint violation would surface
   *   as a 500. Blocking yourself would mask your own messages from you, which
   *   reads as data loss rather than as a block.
   * - **The system actor** — `SYSTEM_SENDER_ID` is a real seeded `users` row and
   *   the literal sender of the chapter welcome post, the `#chapter-audit`
   *   bridge and invite-accept DMs. Masking those would make chapter features
   *   look broken with nothing rendering as "blocked" to explain why.
   *
   * The target must also be a member of this chapter. That is not a block
   * oracle either — chapter membership is already readable by anyone holding
   * `members:view`, which every caller here does — and it is what stops a
   * `users(id)` foreign-key violation on a stray UUID becoming a 500.
   */
  async blockMember(
    chapterId: string,
    blockerUserId: string,
    blockedUserId: string,
  ): Promise<ChatMemberBlockRef> {
    if (blockedUserId === blockerUserId) {
      throw new BadRequestException('You cannot block yourself');
    }
    if (blockedUserId === SYSTEM_SENDER_ID) {
      throw new BadRequestException('This account cannot be blocked');
    }

    const target = await this.memberRepo.findByUserAndChapter(
      blockedUserId,
      chapterId,
    );
    if (!target) {
      throw new NotFoundException('Member not found');
    }

    return this.blockRepo.create(chapterId, blockerUserId, blockedUserId);
  }

  /**
   * Unblock, idempotently and unconditionally.
   *
   * No membership check and no existence check: the affordance in Settings must
   * always work, and a member who has left the chapter is precisely the case
   * where a block is most likely to be stale. Every outcome is the same 204, so
   * the response cannot be used to probe whether a block was there.
   */
  async unblockMember(
    chapterId: string,
    blockerUserId: string,
    blockedUserId: string,
  ): Promise<void> {
    await this.blockRepo.delete(chapterId, blockerUserId, blockedUserId);
  }
}
