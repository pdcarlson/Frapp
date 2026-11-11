import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { ActivityLinkService } from './activity-link.service';
import type { ChatMessageLink } from '#domain/entities/chat.entity';

const CHAPTER = 'chapter-1';
const ME = 'user-me';
const OTHER = 'user-other';
const BLOCKED = 'user-blocked';
const GENERAL = 'chan-general';
const ADS = 'chan-ads';
const NOW = Date.parse('2026-11-11T12:00:00.000Z');

const link = (overrides: Partial<ChatMessageLink> = {}): ChatMessageLink => ({
  id: 'link-1',
  chapter_id: CHAPTER,
  channel_id: GENERAL,
  message_id: 'msg-1',
  url: 'https://forms.gle/abc',
  host: 'forms.gle',
  posted_by: OTHER,
  posted_at: '2026-11-10T12:00:00.000Z',
  removed_at: null,
  removed_by: null,
  ...overrides,
});

function build() {
  const chatService = {
    getChannels: jest.fn().mockResolvedValue([
      { id: GENERAL, name: 'general', type: 'PUBLIC' },
      { id: ADS, name: 'advertising', type: 'PUBLIC', activity_excluded: true },
    ]),
    getChannel: jest.fn().mockResolvedValue({ id: GENERAL }),
  };
  const chatBlocks = { listBlockedUserIds: jest.fn().mockResolvedValue([]) };
  const linkRepo = {
    findShowing: jest.fn().mockResolvedValue([]),
    findById: jest.fn().mockResolvedValue(null),
    findStates: jest.fn().mockResolvedValue([]),
    setState: jest.fn().mockResolvedValue(undefined),
    clearState: jest.fn().mockResolvedValue(undefined),
    setRemoved: jest.fn().mockResolvedValue(null),
  };
  const userRepo = {
    findDisplayIdentitiesByIds: jest
      .fn()
      .mockResolvedValue([{ id: OTHER, display_name: 'Other Member' }]),
  };
  const service = new ActivityLinkService(
    chatService as never,
    chatBlocks as never,
    linkRepo,
    userRepo as never,
  );
  return { service, chatService, chatBlocks, linkRepo, userRepo };
}

describe('ActivityLinkService', () => {
  describe('listFor', () => {
    it('reads only the caller’s channels that feed Activity, over the last 30 days', async () => {
      const { service, linkRepo } = build();

      await service.listFor(CHAPTER, ME, NOW);

      // #advertising is left out of Activity, so it is never asked for.
      expect(linkRepo.findShowing).toHaveBeenCalledWith(CHAPTER, {
        since: '2026-10-12T12:00:00.000Z',
        channelIds: [GENERAL],
        limit: 200,
      });
    });

    it('lists a link with its channel and poster', async () => {
      const { service, linkRepo } = build();
      linkRepo.findShowing.mockResolvedValue([link()]);

      const rows = await service.listFor(CHAPTER, ME, NOW);

      expect(rows).toEqual([
        {
          id: 'link-1',
          url: 'https://forms.gle/abc',
          host: 'forms.gle',
          message_id: 'msg-1',
          channel_id: GENERAL,
          channel_name: 'general',
          channel_type: 'PUBLIC',
          posted_by: OTHER,
          posted_by_name: 'Other Member',
          posted_at: '2026-11-10T12:00:00.000Z',
        },
      ]);
    });

    it('never lists a link from a channel outside the caller’s list or left out of Activity', async () => {
      // The repository is asked for the right channels; this proves the
      // service holds the rule itself rather than trusting the read.
      const { service, linkRepo } = build();
      linkRepo.findShowing.mockResolvedValue([
        link({ id: 'ads', channel_id: ADS }),
        link({ id: 'private', channel_id: 'chan-not-mine' }),
      ]);

      await expect(service.listFor(CHAPTER, ME, NOW)).resolves.toEqual([]);
    });

    it('leaves out the caller’s own links and a blocked member’s, but keeps an imported author’s', async () => {
      const { service, linkRepo, chatBlocks } = build();
      chatBlocks.listBlockedUserIds.mockResolvedValue([BLOCKED]);
      linkRepo.findShowing.mockResolvedValue([
        link({ id: 'mine', posted_by: ME }),
        link({ id: 'blocked', posted_by: BLOCKED }),
        link({ id: 'imported', posted_by: null }),
      ]);

      const rows = await service.listFor(CHAPTER, ME, NOW);

      expect(rows.map((row) => row.id)).toEqual(['imported']);
      expect(rows[0].posted_by_name).toBe('');
    });

    it('leaves out a link the caller marked Done or Hidden', async () => {
      const { service, linkRepo } = build();
      linkRepo.findShowing.mockResolvedValue([
        link({ id: 'done' }),
        link({ id: 'hidden' }),
        link({ id: 'open' }),
      ]);
      linkRepo.findStates.mockResolvedValue([
        { link_id: 'done', state: 'done' },
        { link_id: 'hidden', state: 'hidden' },
      ]);

      const rows = await service.listFor(CHAPTER, ME, NOW);

      expect(linkRepo.findStates).toHaveBeenCalledWith(CHAPTER, ME, [
        'done',
        'hidden',
        'open',
      ]);
      expect(rows.map((row) => row.id)).toEqual(['open']);
    });

    it('carries at most 25 rows', async () => {
      const { service, linkRepo } = build();
      linkRepo.findShowing.mockResolvedValue(
        Array.from({ length: 30 }, (_, i) => link({ id: `link-${i}` })),
      );

      await expect(service.listFor(CHAPTER, ME, NOW)).resolves.toHaveLength(25);
    });

    it('fails rather than list unmasked when the block list can’t be read', async () => {
      const { service, chatBlocks, linkRepo } = build();
      chatBlocks.listBlockedUserIds.mockRejectedValue(new Error('db down'));
      linkRepo.findShowing.mockResolvedValue([link()]);

      await expect(service.listFor(CHAPTER, ME, NOW)).rejects.toThrow(
        'db down',
      );
    });
  });

  describe('setState and clearState', () => {
    it('records the caller’s state on a link they can read', async () => {
      const { service, linkRepo, chatService } = build();
      linkRepo.findById.mockResolvedValue(link());

      await service.setState(CHAPTER, ME, 'link-1', 'hidden');
      await service.clearState(CHAPTER, ME, 'link-1');

      expect(chatService.getChannel).toHaveBeenCalledWith(GENERAL, CHAPTER, ME);
      expect(linkRepo.setState).toHaveBeenCalledWith(
        CHAPTER,
        'link-1',
        ME,
        'hidden',
      );
      expect(linkRepo.clearState).toHaveBeenCalledWith(CHAPTER, 'link-1', ME);
    });

    it('answers 404 for a link that doesn’t exist', async () => {
      const { service, linkRepo } = build();

      await expect(
        service.setState(CHAPTER, ME, 'link-1', 'done'),
      ).rejects.toThrow(NotFoundException);
      expect(linkRepo.setState).not.toHaveBeenCalled();
    });

    it.each([
      ['403', new ForbiddenException()],
      ['404', new NotFoundException()],
    ])(
      'answers 404, not the channel’s %s, for a link in a channel the caller can’t read',
      async (_status, refusal) => {
        const { service, linkRepo, chatService } = build();
        linkRepo.findById.mockResolvedValue(link());
        chatService.getChannel.mockRejectedValue(refusal);

        await expect(
          service.setState(CHAPTER, ME, 'link-1', 'done'),
        ).rejects.toThrow(new NotFoundException('Link not found'));
        await expect(service.clearState(CHAPTER, ME, 'link-1')).rejects.toThrow(
          NotFoundException,
        );
        expect(linkRepo.setState).not.toHaveBeenCalled();
        expect(linkRepo.clearState).not.toHaveBeenCalled();
      },
    );
  });

  describe('setRemoved', () => {
    it('removes and restores a link in the chapter', async () => {
      const { service, linkRepo } = build();
      linkRepo.setRemoved.mockResolvedValue(link());

      await service.setRemoved(CHAPTER, 'link-1', ME);
      await service.setRemoved(CHAPTER, 'link-1', null);

      expect(linkRepo.setRemoved).toHaveBeenNthCalledWith(
        1,
        CHAPTER,
        'link-1',
        ME,
      );
      expect(linkRepo.setRemoved).toHaveBeenNthCalledWith(
        2,
        CHAPTER,
        'link-1',
        null,
      );
    });

    it('answers 404 when the chapter has no such link', async () => {
      const { service } = build();

      await expect(service.setRemoved(CHAPTER, 'link-1', ME)).rejects.toThrow(
        NotFoundException,
      );
    });
  });
});
