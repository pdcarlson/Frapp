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
  thread_root_id: null,
  url: 'https://forms.gle/abc',
  host: 'forms.gle',
  posted_by: OTHER,
  posted_at: '2026-11-10T12:00:00.000Z',
  removed_at: null,
  removed_by: null,
  title: null,
  title_attempts: 0,
  title_checked_at: null,
  ...overrides,
});

const CHANNELS = [
  { id: GENERAL, name: 'general', type: 'PUBLIC' as const },
  {
    id: ADS,
    name: 'advertising',
    type: 'PUBLIC' as const,
    activity_excluded: true,
  },
];

function build() {
  const channelAccess = {
    assertChannelAccess: jest.fn().mockResolvedValue({ id: GENERAL }),
  };
  const linkRepo = {
    findShowing: jest.fn().mockResolvedValue([]),
    findById: jest.fn().mockResolvedValue(null),
    findStates: jest.fn().mockResolvedValue([]),
    setState: jest.fn().mockResolvedValue(undefined),
    clearState: jest.fn().mockResolvedValue(undefined),
    setRemoved: jest.fn().mockResolvedValue(null),
    findTitlePending: jest.fn().mockResolvedValue([]),
    claimForTitle: jest.fn().mockResolvedValue(false),
    finishTitle: jest.fn().mockResolvedValue(undefined),
  };
  const userRepo = {
    findDisplayIdentitiesByIds: jest
      .fn()
      .mockResolvedValue([{ id: OTHER, display_name: 'Other Member' }]),
  };
  const service = new ActivityLinkService(
    channelAccess as never,
    linkRepo,
    userRepo as never,
  );
  const list = (blockedUserIds: string[] = []) =>
    service.listFor(CHAPTER, ME, NOW, { channels: CHANNELS, blockedUserIds });
  return { service, channelAccess, linkRepo, userRepo, list };
}

describe('ActivityLinkService', () => {
  describe('listFor', () => {
    it('reads only the caller’s channels that feed Activity, over the last 30 days', async () => {
      const { list, linkRepo } = build();

      await list();

      // #advertising is left out of Activity, so it is never asked for.
      expect(linkRepo.findShowing).toHaveBeenCalledWith(CHAPTER, {
        since: '2026-10-12T12:00:00.000Z',
        channelIds: [GENERAL],
        limit: 200,
      });
    });

    it('lists a link with its channel and poster', async () => {
      const { list, linkRepo } = build();
      linkRepo.findShowing.mockResolvedValue([link()]);

      const rows = await list();

      expect(rows).toEqual([
        {
          id: 'link-1',
          url: 'https://forms.gle/abc',
          host: 'forms.gle',
          title: null,
          message_id: 'msg-1',
          thread_root_id: null,
          channel_id: GENERAL,
          channel_name: 'general',
          channel_type: 'PUBLIC',
          posted_by: OTHER,
          posted_by_name: 'Other Member',
          posted_at: '2026-11-10T12:00:00.000Z',
        },
      ]);
    });

    it('serves the stored page title, never fetching one on the read', async () => {
      const { list, linkRepo } = build();
      linkRepo.findShowing.mockResolvedValue([
        link({
          title: '5K volunteer shifts',
          title_attempts: 3,
          title_checked_at: '2026-11-10T12:01:00.000Z',
        }),
      ]);

      const rows = await list();

      expect(rows[0].title).toBe('5K volunteer shifts');
      // The read's only link reads are the index and the member's states.
      expect(linkRepo.findTitlePending).not.toHaveBeenCalled();
      expect(linkRepo.claimForTitle).not.toHaveBeenCalled();
      expect(linkRepo.finishTitle).not.toHaveBeenCalled();
    });

    it('never lists a link from a channel outside the caller’s list or left out of Activity', async () => {
      // The repository is asked for the right channels; this proves the
      // service holds the rule itself rather than trusting the read.
      const { list, linkRepo } = build();
      linkRepo.findShowing.mockResolvedValue([
        link({ id: 'ads', channel_id: ADS }),
        link({ id: 'private', channel_id: 'chan-not-mine' }),
      ]);

      await expect(list()).resolves.toEqual([]);
    });

    it('leaves out the caller’s own links and a blocked member’s, but keeps an imported author’s', async () => {
      const { list, linkRepo } = build();
      linkRepo.findShowing.mockResolvedValue([
        link({ id: 'mine', posted_by: ME }),
        link({ id: 'blocked', posted_by: BLOCKED }),
        link({ id: 'imported', posted_by: null }),
      ]);

      const rows = await list([BLOCKED]);

      expect(rows.map((row) => row.id)).toEqual(['imported']);
      expect(rows[0].posted_by_name).toBe('');
    });

    it('leaves out a link the caller marked Done or Hidden', async () => {
      const { list, linkRepo } = build();
      linkRepo.findShowing.mockResolvedValue([
        link({ id: 'done' }),
        link({ id: 'hidden' }),
        link({ id: 'open' }),
      ]);
      linkRepo.findStates.mockResolvedValue([
        { link_id: 'done', state: 'done' },
        { link_id: 'hidden', state: 'hidden' },
      ]);

      const rows = await list();

      expect(linkRepo.findStates).toHaveBeenCalledWith(CHAPTER, ME, [
        'done',
        'hidden',
        'open',
      ]);
      expect(rows.map((row) => row.id)).toEqual(['open']);
    });

    it('carries a thread reply’s root, so Open in chat can open the thread', async () => {
      const { list, linkRepo } = build();
      linkRepo.findShowing.mockResolvedValue([
        link({ thread_root_id: 'msg-root' }),
      ]);

      const [row] = await list();

      expect(row.thread_root_id).toBe('msg-root');
    });

    it('carries at most 25 rows', async () => {
      const { list, linkRepo } = build();
      linkRepo.findShowing.mockResolvedValue(
        Array.from({ length: 30 }, (_, i) => link({ id: `link-${i}` })),
      );

      await expect(list()).resolves.toHaveLength(25);
    });
  });

  describe('setState and clearState', () => {
    it('records the caller’s state on a link they can read', async () => {
      const { service, linkRepo, channelAccess } = build();
      linkRepo.findById.mockResolvedValue(link());

      await service.setState(CHAPTER, ME, 'link-1', 'hidden');
      await service.clearState(CHAPTER, ME, 'link-1');

      expect(channelAccess.assertChannelAccess).toHaveBeenCalledWith(
        GENERAL,
        CHAPTER,
        ME,
        'read',
      );
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
        const { service, linkRepo, channelAccess } = build();
        linkRepo.findById.mockResolvedValue(link());
        channelAccess.assertChannelAccess.mockRejectedValue(refusal);

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
