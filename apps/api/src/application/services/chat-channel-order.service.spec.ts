import { BadRequestException, NotFoundException } from '@nestjs/common';
import { ChatChannelOrderService } from './chat-channel-order.service';
import type {
  IChatCategoryRepository,
  IChatChannelRepository,
} from '#domain/repositories/chat.repository.interface';
import type { ChatChannel } from '#domain/entities/chat.entity';

const CHAPTER = 'chapter-1';

const channel = (id: string, extra: Partial<ChatChannel> = {}) =>
  ({
    id,
    chapter_id: CHAPTER,
    name: id,
    type: 'PUBLIC',
    is_audit_log: false,
    ...extra,
  }) as ChatChannel;

/**
 * The chapter's channel order (#4178). The RPCs re-check the chapter and skip
 * DMs and the audit log; the service refuses them first, with a status that
 * says why, so the rail can't silently write half an order.
 */
describe('ChatChannelOrderService', () => {
  let channels: jest.Mocked<
    Pick<IChatChannelRepository, 'findByIds' | 'reorder'>
  >;
  let categories: jest.Mocked<
    Pick<IChatCategoryRepository, 'findById' | 'findByChapter' | 'reorder'>
  >;
  let service: ChatChannelOrderService;

  beforeEach(() => {
    channels = { findByIds: jest.fn(), reorder: jest.fn() };
    categories = {
      findById: jest.fn(),
      findByChapter: jest.fn(),
      reorder: jest.fn(),
    };
    service = new ChatChannelOrderService(
      channels as unknown as IChatChannelRepository,
      categories as unknown as IChatCategoryRepository,
    );
  });

  it('writes the section in the order given', async () => {
    channels.findByIds.mockResolvedValue([channel('b'), channel('a')]);
    categories.findById.mockResolvedValue({
      id: 'cat',
      chapter_id: CHAPTER,
      name: 'Officers',
      display_order: 0,
      created_at: '',
    });
    await service.reorderChannels(CHAPTER, 'cat', ['a', 'b']);
    expect(categories.findById).toHaveBeenCalledWith('cat', CHAPTER);
    expect(channels.reorder).toHaveBeenCalledWith(CHAPTER, 'cat', ['a', 'b']);
  });

  it('reads no category for the default group', async () => {
    channels.findByIds.mockResolvedValue([channel('a')]);
    await service.reorderChannels(CHAPTER, null, ['a']);
    expect(categories.findById).not.toHaveBeenCalled();
    expect(channels.reorder).toHaveBeenCalledWith(CHAPTER, null, ['a']);
  });

  it('404s a category outside the chapter', async () => {
    channels.findByIds.mockResolvedValue([channel('a')]);
    categories.findById.mockResolvedValue(null);
    await expect(
      service.reorderChannels(CHAPTER, 'theirs', ['a']),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(channels.reorder).not.toHaveBeenCalled();
  });

  it('404s a channel outside the chapter', async () => {
    channels.findByIds.mockResolvedValue([channel('a')]);
    await expect(
      service.reorderChannels(CHAPTER, null, ['a', 'theirs']),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(channels.reorder).not.toHaveBeenCalled();
  });

  it.each([
    ['a DM', { type: 'DM' }],
    ['a group DM', { type: 'GROUP_DM' }],
    ['the audit log', { is_audit_log: true }],
  ] as const)('refuses %s', async (_label, extra) => {
    channels.findByIds.mockResolvedValue([
      channel('a'),
      channel('x', extra),
    ]);
    await expect(
      service.reorderChannels(CHAPTER, null, ['a', 'x']),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(channels.reorder).not.toHaveBeenCalled();
  });

  it('writes the category order when every id is the chapter’s', async () => {
    categories.findByChapter.mockResolvedValue([
      {
        id: 'a',
        chapter_id: CHAPTER,
        name: 'A',
        display_order: 0,
        created_at: '',
      },
      {
        id: 'b',
        chapter_id: CHAPTER,
        name: 'B',
        display_order: 1,
        created_at: '',
      },
    ]);
    await service.reorderCategories(CHAPTER, ['b', 'a']);
    expect(categories.reorder).toHaveBeenCalledWith(CHAPTER, ['b', 'a']);
  });

  it('404s a category order naming another chapter’s category', async () => {
    categories.findByChapter.mockResolvedValue([]);
    await expect(
      service.reorderCategories(CHAPTER, ['theirs']),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(categories.reorder).not.toHaveBeenCalled();
  });
});
