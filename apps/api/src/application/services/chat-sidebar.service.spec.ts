import { Test, TestingModule } from '@nestjs/testing';
import {
  BadRequestException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { ChatSidebarService } from './chat-sidebar.service';
import { ChannelAccessService } from './channel-access.service';
import {
  CHAT_SIDEBAR_REPOSITORY,
  type IChatSidebarRepository,
} from '#domain/repositories/chat-sidebar.repository.interface';
import {
  CHAT_CATEGORY_REPOSITORY,
  type IChatCategoryRepository,
} from '#domain/repositories/chat.repository.interface';
import type { ChatSidebarPreferences } from '#domain/entities/chat-sidebar.entity';

const CHAPTER = 'chap-1';
const USER = 'user-1';
const CATEGORY = '0a000000-0000-4000-8000-000000000001';

const stored = (
  overrides: Partial<ChatSidebarPreferences> = {},
): ChatSidebarPreferences => ({
  user_id: USER,
  chapter_id: CHAPTER,
  unread_only: true,
  hide_muted: false,
  collapsed_sections: ['direct'],
  created_at: '2026-09-29T00:00:00.000Z',
  updated_at: '2026-09-29T00:00:00.000Z',
  ...overrides,
});

describe('ChatSidebarService', () => {
  let service: ChatSidebarService;
  let repo: jest.Mocked<IChatSidebarRepository>;
  let categories: { findById: jest.Mock };
  let access: {
    assertChannelAccess: jest.Mock;
    filterAccessibleChannelIds: jest.Mock;
  };

  beforeEach(async () => {
    repo = {
      findPreferences: jest.fn().mockResolvedValue(stored()),
      updateFilters: jest.fn().mockResolvedValue(stored()),
      setSectionCollapsed: jest.fn().mockResolvedValue(stored()),
      findPinnedChannelIds: jest.fn().mockResolvedValue(['ch-a', 'ch-gone']),
      pin: jest.fn().mockResolvedValue(undefined),
      unpin: jest.fn().mockResolvedValue(undefined),
    };
    categories = { findById: jest.fn().mockResolvedValue({ id: CATEGORY }) };
    access = {
      assertChannelAccess: jest.fn().mockResolvedValue({ id: 'ch-a' }),
      // The member can still read `ch-a` but lost `ch-gone`.
      filterAccessibleChannelIds: jest
        .fn()
        .mockResolvedValue(new Set(['ch-a'])),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ChatSidebarService,
        { provide: CHAT_SIDEBAR_REPOSITORY, useValue: repo },
        {
          provide: CHAT_CATEGORY_REPOSITORY,
          useValue: categories,
        },
        { provide: ChannelAccessService, useValue: access },
      ],
    }).compile();
    service = module.get(ChatSidebarService);
  });

  describe('getSidebar', () => {
    it('fills every default for a member with no row', async () => {
      repo.findPreferences.mockResolvedValue(null);
      repo.findPinnedChannelIds.mockResolvedValue([]);
      access.filterAccessibleChannelIds.mockResolvedValue(new Set());

      await expect(service.getSidebar(CHAPTER, USER)).resolves.toEqual({
        unread_only: false,
        hide_muted: false,
        collapsed_sections: [],
        pinned_channel_ids: [],
      });
    });

    it('returns the stored settings', async () => {
      const view = await service.getSidebar(CHAPTER, USER);

      expect(view).toMatchObject({
        unread_only: true,
        hide_muted: false,
        collapsed_sections: ['direct'],
      });
    });

    it('leaves out pins on channels the member can no longer read', async () => {
      const view = await service.getSidebar(CHAPTER, USER);

      expect(access.filterAccessibleChannelIds).toHaveBeenCalledWith(
        CHAPTER,
        USER,
        ['ch-a', 'ch-gone'],
      );
      expect(view.pinned_channel_ids).toEqual(['ch-a']);
    });
  });

  describe('updateFilters', () => {
    it('writes only the filter given', async () => {
      await service.updateFilters(CHAPTER, USER, { hide_muted: true });

      expect(repo.updateFilters).toHaveBeenCalledWith(CHAPTER, USER, {
        hide_muted: true,
      });
    });

    it('drops keys whose value is undefined rather than writing them', async () => {
      await service.updateFilters(CHAPTER, USER, {
        unread_only: false,
        hide_muted: undefined,
      });

      const written = repo.updateFilters.mock.calls[0][2];
      expect(written).toEqual({ unread_only: false });
      expect(Object.keys(written)).toEqual(['unread_only']);
    });

    it('refuses an empty body', async () => {
      await expect(service.updateFilters(CHAPTER, USER, {})).rejects.toThrow(
        BadRequestException,
      );
      expect(repo.updateFilters).not.toHaveBeenCalled();
    });
  });

  describe('setSectionCollapsed', () => {
    it.each(['pinned', 'channels', 'direct', 'system'])(
      'folds the fixed group %s without a category lookup',
      async (key) => {
        await service.setSectionCollapsed(CHAPTER, USER, key, true);

        expect(repo.setSectionCollapsed).toHaveBeenCalledWith(
          CHAPTER,
          USER,
          key,
          true,
        );
        expect(categories.findById).not.toHaveBeenCalled();
      },
    );

    it('folds a category only when it exists in the chapter', async () => {
      await service.setSectionCollapsed(
        CHAPTER,
        USER,
        `category:${CATEGORY}`,
        true,
      );

      expect(categories.findById).toHaveBeenCalledWith(CATEGORY, CHAPTER);
      expect(repo.setSectionCollapsed).toHaveBeenCalled();
    });

    it('refuses to fold a category from another chapter or a deleted one', async () => {
      categories.findById.mockResolvedValue(null);

      await expect(
        service.setSectionCollapsed(
          CHAPTER,
          USER,
          `category:${CATEGORY}`,
          true,
        ),
      ).rejects.toThrow(NotFoundException);
      expect(repo.setSectionCollapsed).not.toHaveBeenCalled();
    });

    it('unfolds a deleted category without looking it up', async () => {
      categories.findById.mockResolvedValue(null);

      await service.setSectionCollapsed(
        CHAPTER,
        USER,
        `category:${CATEGORY}`,
        false,
      );

      expect(categories.findById).not.toHaveBeenCalled();
      expect(repo.setSectionCollapsed).toHaveBeenCalledWith(
        CHAPTER,
        USER,
        `category:${CATEGORY}`,
        false,
      );
    });

    it.each(['hidden', 'category:nope', 'Pinned', ''])(
      'refuses the malformed key %j either way',
      async (key) => {
        await expect(
          service.setSectionCollapsed(CHAPTER, USER, key, true),
        ).rejects.toThrow(BadRequestException);
        await expect(
          service.setSectionCollapsed(CHAPTER, USER, key, false),
        ).rejects.toThrow(BadRequestException);
        expect(repo.setSectionCollapsed).not.toHaveBeenCalled();
      },
    );
  });

  describe('pin and unpin', () => {
    it('pins a channel the member can read', async () => {
      await service.pin(CHAPTER, USER, 'ch-a');

      expect(access.assertChannelAccess).toHaveBeenCalledWith(
        'ch-a',
        CHAPTER,
        USER,
      );
      expect(repo.pin).toHaveBeenCalledWith(CHAPTER, USER, 'ch-a');
    });

    it('stores nothing for a channel the member cannot read', async () => {
      access.assertChannelAccess.mockRejectedValue(new ForbiddenException());

      await expect(service.pin(CHAPTER, USER, 'ch-secret')).rejects.toThrow(
        ForbiddenException,
      );
      expect(repo.pin).not.toHaveBeenCalled();
    });

    it('unpins without an access check, so a lost channel can still be cleared', async () => {
      await service.unpin(CHAPTER, USER, 'ch-gone');

      expect(access.assertChannelAccess).not.toHaveBeenCalled();
      expect(repo.unpin).toHaveBeenCalledWith(CHAPTER, USER, 'ch-gone');
    });

    it('answers every write with the whole arrangement', async () => {
      await expect(service.pin(CHAPTER, USER, 'ch-a')).resolves.toEqual({
        unread_only: true,
        hide_muted: false,
        collapsed_sections: ['direct'],
        pinned_channel_ids: ['ch-a'],
      });
    });
  });
});
