import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { ChatBlockService } from './chat-block.service';
import { CHAT_MEMBER_BLOCK_REPOSITORY } from '#domain/repositories/chat-moderation.repository.interface';
import type { IChatMemberBlockRepository } from '#domain/repositories/chat-moderation.repository.interface';
import { MEMBER_REPOSITORY } from '#domain/repositories/member.repository.interface';
import { SYSTEM_SENDER_ID } from '#domain/constants/chat';

/**
 * `spec/behavior/chat/README.md` § Report and block — the block half.
 *
 * The properties under test are the ones a future edit is most likely to break:
 * a block is per chapter; a member reaches only their own list; the two
 * unblockable targets are refused before the DB CHECK turns into a 500; and
 * unblocking is unconditional so the Settings affordance is always usable.
 *
 * **What is asserted by absence:** there is no case here for "a member cannot
 * read another member's block list" as a *refusal*, because the method takes no
 * such argument. The blocker is always `@CurrentUser('id')` from the guard
 * chain, so there is no parameter to escalate through — the guarantee is
 * structural, and the two tests that would notice it regressing are the
 * repository's (`findBlockedUserIds` filters on `blocker_user_id`) and the
 * signature itself. A method that grew a `blockerUserId` the controller did not
 * supply would be the regression.
 */
describe('ChatBlockService', () => {
  const CHAPTER = 'chapter-1';
  const OTHER_CHAPTER = 'chapter-2';
  const ME = 'user-me';
  const THEM = 'user-them';

  const blockRow = {
    id: 'block-1',
    chapter_id: CHAPTER,
    blocked_user_id: THEM,
    created_at: '2026-03-01T00:00:00.000Z',
  };

  let service: ChatBlockService;
  let blockRepo: jest.Mocked<IChatMemberBlockRepository>;
  let memberRepo: { findByUserAndChapter: jest.Mock };

  beforeEach(async () => {
    blockRepo = {
      findBlockedUserIds: jest.fn().mockResolvedValue([THEM]),
      create: jest.fn().mockResolvedValue(blockRow),
      delete: jest.fn().mockResolvedValue(undefined),
    };
    memberRepo = {
      findByUserAndChapter: jest
        .fn()
        .mockResolvedValue({ id: 'mem-them', user_id: THEM }),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ChatBlockService,
        { provide: CHAT_MEMBER_BLOCK_REPOSITORY, useValue: blockRepo },
        { provide: MEMBER_REPOSITORY, useValue: memberRepo },
      ],
    }).compile();

    service = module.get(ChatBlockService);
  });

  describe('listBlockedUserIds', () => {
    it('reads the caller own list in the active chapter', async () => {
      const ids = await service.listBlockedUserIds(CHAPTER, ME);

      expect(ids).toEqual([THEM]);
      expect(blockRepo.findBlockedUserIds).toHaveBeenCalledWith(CHAPTER, ME);
    });

    it('is chapter scoped — the same caller in another chapter is a different list', async () => {
      // A block is scoped per chapter: a member can belong to more than one, and
      // blocking someone in one says nothing about another they may both also
      // belong to.
      await service.listBlockedUserIds(OTHER_CHAPTER, ME);

      expect(blockRepo.findBlockedUserIds).toHaveBeenCalledWith(
        OTHER_CHAPTER,
        ME,
      );
    });

    it('propagates a failed read rather than answering with an empty list', async () => {
      // "A block list that cannot be read is not an empty block list." Degrading
      // to `[]` here would silently unmask every blocked member for as long as
      // the table was unreachable — failing open on a safety feature.
      blockRepo.findBlockedUserIds.mockRejectedValue(new Error('pg down'));

      await expect(service.listBlockedUserIds(CHAPTER, ME)).rejects.toThrow(
        'pg down',
      );
    });
  });

  describe('blockMember', () => {
    it('blocks a member of the chapter as the caller', async () => {
      const result = await service.blockMember(CHAPTER, ME, THEM);

      expect(result).toBe(blockRow);
      expect(blockRepo.create).toHaveBeenCalledWith(CHAPTER, ME, THEM);
    });

    it('refuses to block yourself', async () => {
      // `chat_member_blocks_not_self` would otherwise surface as a 500, and the
      // behaviour would be worse than the error: masking your own messages from
      // yourself reads as data loss, not as a block.
      await expect(service.blockMember(CHAPTER, ME, ME)).rejects.toThrow(
        BadRequestException,
      );
      expect(blockRepo.create).not.toHaveBeenCalled();
    });

    it('refuses to block the system actor', async () => {
      // SYSTEM_SENDER_ID authors the welcome post, the #chapter-audit bridge and
      // invite-accept DMs. Masking those would make chapter features look broken
      // with nothing rendering as "blocked" to explain why.
      await expect(
        service.blockMember(CHAPTER, ME, SYSTEM_SENDER_ID),
      ).rejects.toThrow(BadRequestException);
      expect(blockRepo.create).not.toHaveBeenCalled();
    });

    it('404s a target who is not a member of this chapter', async () => {
      // Not a block oracle: chapter membership is already readable by anyone
      // holding `members:view`, which every caller here does. It is what stops a
      // stray UUID becoming a users(id) foreign-key violation and a 500.
      memberRepo.findByUserAndChapter.mockResolvedValue(null);

      await expect(service.blockMember(CHAPTER, ME, THEM)).rejects.toThrow(
        NotFoundException,
      );
      expect(blockRepo.create).not.toHaveBeenCalled();
    });

    it('resolves the target in the caller chapter, not globally', async () => {
      await service.blockMember(CHAPTER, ME, THEM);

      expect(memberRepo.findByUserAndChapter).toHaveBeenCalledWith(
        THEM,
        CHAPTER,
      );
    });
  });

  describe('unblockMember', () => {
    it('deletes scoped to chapter, blocker and target', async () => {
      await service.unblockMember(CHAPTER, ME, THEM);

      expect(blockRepo.delete).toHaveBeenCalledWith(CHAPTER, ME, THEM);
    });

    it('does not check membership, so a stale block is always removable', async () => {
      // The Settings list is the one place a block can always be undone, and a
      // member who has left the chapter is precisely when a block goes stale.
      memberRepo.findByUserAndChapter.mockResolvedValue(null);

      await expect(
        service.unblockMember(CHAPTER, ME, THEM),
      ).resolves.toBeUndefined();
      expect(blockRepo.delete).toHaveBeenCalled();
    });
  });
});
