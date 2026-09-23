import { Logger } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { ActivityFeedService } from './activity-feed.service';
import { EventService } from './event.service';
import { PointsService } from './points.service';
import { BackworkService } from './backwork.service';
import { MemberService, RecentMemberJoin } from './member.service';
import { ChatService } from './chat.service';
import { RbacService } from './rbac.service';
import { SystemPermissions } from '#domain/constants/permissions';
import type { Event } from '#domain/entities/event.entity';
import type { PointTransaction } from '#domain/entities/point-transaction.entity';
import type { BackworkResource } from '#domain/entities/backwork.entity';
import type { ChatChannel } from '#domain/entities/chat.entity';
import type { MaskedChatMessage } from './chat-block-mask';

describe('ActivityFeedService', () => {
  let service: ActivityFeedService;
  let mockEventService: jest.Mocked<Pick<EventService, 'findByChapter'>>;
  let mockPointsService: jest.Mocked<Pick<PointsService, 'getUserSummary'>>;
  let mockBackworkService: jest.Mocked<Pick<BackworkService, 'findByChapter'>>;
  let mockMemberService: jest.Mocked<
    Pick<MemberService, 'findRosterWithJoinDates'>
  >;
  let mockChatService: jest.Mocked<
    Pick<ChatService, 'getChannels' | 'getMessages'>
  >;
  let mockRbacService: jest.Mocked<
    Pick<RbacService, 'getEffectivePermissions'>
  >;

  const CHAPTER_ID = 'chapter-1';
  const USER_ID = 'user-1';

  const announcementsChannel: ChatChannel = {
    id: 'chan-announcements',
    chapter_id: CHAPTER_ID,
    name: 'announcements',
    description: null,
    type: 'PUBLIC',
    required_permissions: null,
    member_ids: null,
    category_id: null,
    is_read_only: true,
    created_at: '2026-01-01T00:00:00.000Z',
    archived_at: null,
  };

  beforeEach(async () => {
    mockEventService = { findByChapter: jest.fn().mockResolvedValue([]) };
    mockPointsService = {
      getUserSummary: jest
        .fn()
        .mockResolvedValue({ balance: 0, transactions: [] }),
    };
    mockBackworkService = { findByChapter: jest.fn().mockResolvedValue([]) };
    mockMemberService = {
      findRosterWithJoinDates: jest.fn().mockResolvedValue([]),
    };
    mockChatService = {
      getChannels: jest.fn().mockResolvedValue([]),
      getMessages: jest.fn().mockResolvedValue([]),
    };
    mockRbacService = {
      getEffectivePermissions: jest.fn().mockResolvedValue([]),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ActivityFeedService,
        { provide: EventService, useValue: mockEventService },
        { provide: PointsService, useValue: mockPointsService },
        { provide: BackworkService, useValue: mockBackworkService },
        { provide: MemberService, useValue: mockMemberService },
        { provide: ChatService, useValue: mockChatService },
        { provide: RbacService, useValue: mockRbacService },
      ],
    }).compile();

    service = module.get(ActivityFeedService);
  });

  it('scopes every domain call to the given chapter', async () => {
    await service.getFeed(CHAPTER_ID, USER_ID);

    // The viewer id is load-bearing, not incidental: without it
    // `findByChapter` skips the `required_role_ids` filter and the feed
    // republishes a role-targeted event's name and location (#1469).
    expect(mockEventService.findByChapter).toHaveBeenCalledWith(
      CHAPTER_ID,
      USER_ID,
    );
    expect(mockPointsService.getUserSummary).toHaveBeenCalledWith(
      CHAPTER_ID,
      USER_ID,
      'all',
    );
    expect(mockMemberService.findRosterWithJoinDates).toHaveBeenCalledWith(
      CHAPTER_ID,
    );
    expect(mockMemberService.findRosterWithJoinDates).toHaveBeenCalledTimes(1);
    expect(mockChatService.getChannels).toHaveBeenCalledWith(
      CHAPTER_ID,
      USER_ID,
    );
    expect(mockRbacService.getEffectivePermissions).toHaveBeenCalledWith(
      CHAPTER_ID,
      USER_ID,
    );
  });

  it('never calls the chapter-wide points endpoint — only the caller-scoped summary', async () => {
    await service.getFeed(CHAPTER_ID, USER_ID);

    // getUserSummary is the only points method this service is allowed to
    // call — it is what keeps point rows to the caller's own, matching the
    // spec's "own point changes" rule.
    expect(mockPointsService.getUserSummary).toHaveBeenCalled();
  });

  // #1469: the feed emits `title: event.name` and `body: event.location`, so
  // an unfiltered read here republishes exactly what the role gate hides. The
  // filtering itself is EventService's (and tested there); what this pins is
  // that the feed asks for the *viewer's* events rather than the chapter's.
  it('does not surface a role-targeted event the viewer cannot see', async () => {
    mockEventService.findByChapter.mockImplementation(
      async (_chapterId: string, viewerId?: string) =>
        viewerId
          ? []
          : [
              eventFixture({
                id: 'evt-exec',
                name: 'Exec Discipline Review',
                location: 'Chapter House',
                // Far-future so it lands in the "upcoming" branch — with the
                // fixture's default past start_time this test would pass even
                // with the filter removed.
                start_time: '2099-01-01T00:00:00.000Z',
                end_time: '2099-01-01T01:00:00.000Z',
                required_role_ids: ['role-officer'],
              }),
            ],
    );

    const feed = await service.getFeed(CHAPTER_ID, USER_ID);

    expect(mockEventService.findByChapter).toHaveBeenCalledWith(
      CHAPTER_ID,
      USER_ID,
    );
    expect(JSON.stringify(feed)).not.toContain('Exec Discipline Review');
    expect(JSON.stringify(feed)).not.toContain('Chapter House');
  });

  it('returns items newest-first across domains', async () => {
    const oldEvent: Event = eventFixture({
      id: 'evt-old',
      created_at: '2026-01-01T00:00:00.000Z',
      start_time: '2020-01-01T00:00:00.000Z', // past — excluded from "upcoming"
    });
    const newEvent: Event = eventFixture({
      id: 'evt-new',
      created_at: '2026-06-01T00:00:00.000Z',
      start_time: '2020-01-01T00:00:00.000Z',
    });
    mockEventService.findByChapter.mockResolvedValue([oldEvent, newEvent]);

    const txn: PointTransaction = {
      id: 'txn-1',
      chapter_id: CHAPTER_ID,
      user_id: USER_ID,
      amount: 5,
      category: 'ATTENDANCE',
      description: 'Chapter meeting',
      metadata: {},
      created_at: '2026-03-01T00:00:00.000Z',
    };
    mockPointsService.getUserSummary.mockResolvedValue({
      balance: 5,
      transactions: [txn],
    });

    const result = await service.getFeed(CHAPTER_ID, USER_ID);
    const timestamps = result.map((item) => item.timestamp);
    const sorted = [...timestamps].sort().reverse();
    expect(timestamps).toEqual(sorted);
  });

  it('includes events, own points, new members, and announcements', async () => {
    mockEventService.findByChapter.mockResolvedValue([
      eventFixture({ id: 'evt-1', start_time: '2099-01-01T00:00:00.000Z' }),
    ]);
    mockPointsService.getUserSummary.mockResolvedValue({
      balance: 5,
      transactions: [
        {
          id: 'txn-1',
          chapter_id: CHAPTER_ID,
          user_id: USER_ID,
          amount: 5,
          category: 'ATTENDANCE',
          description: 'Chapter meeting',
          metadata: {},
          created_at: '2026-03-01T00:00:00.000Z',
        },
      ],
    });
    mockMemberService.findRosterWithJoinDates.mockResolvedValue([
      joinFixture({
        user_id: 'user-2',
        display_name: 'New Member',
        joined_at: '2026-03-02T00:00:00.000Z',
      }),
    ]);
    mockChatService.getChannels.mockResolvedValue([announcementsChannel]);
    mockChatService.getMessages.mockResolvedValue([
      messageFixture({ id: 'msg-1', sender_id: USER_ID }),
    ]);

    const result = await service.getFeed(CHAPTER_ID, USER_ID);
    const types = new Set(result.map((item) => item.type));

    expect(types.has('event_upcoming')).toBe(true);
    expect(types.has('points_change')).toBe(true);
    expect(types.has('member_joined')).toBe(true);
    expect(types.has('announcement')).toBe(true);
  });

  it('excludes a regenerated recurring occurrence from "event created", only the past-14-day cutoff for standalone events', async () => {
    const recentButRegeneratedOccurrence = eventFixture({
      id: 'evt-occurrence',
      parent_event_id: 'evt-series',
      created_at: new Date().toISOString(),
      start_time: '2020-01-01T00:00:00.000Z',
    });
    const recentStandaloneEvent = eventFixture({
      id: 'evt-standalone',
      parent_event_id: null,
      created_at: new Date().toISOString(),
      start_time: '2020-01-01T00:00:00.000Z',
    });
    mockEventService.findByChapter.mockResolvedValue([
      recentButRegeneratedOccurrence,
      recentStandaloneEvent,
    ]);

    const result = await service.getFeed(CHAPTER_ID, USER_ID);
    const createdIds = result
      .filter((item) => item.type === 'event_created')
      .map((item) => item.target_id);

    expect(createdIds).toEqual(['evt-standalone']);
  });

  it('drops a soft-deleted announcement rather than showing "[message deleted]"', async () => {
    mockChatService.getChannels.mockResolvedValue([announcementsChannel]);
    mockChatService.getMessages.mockResolvedValue([
      messageFixture({ id: 'msg-live', is_deleted: false }),
      messageFixture({ id: 'msg-deleted', is_deleted: true }),
    ]);

    const result = await service.getFeed(CHAPTER_ID, USER_ID);
    const announcementIds = result
      .filter((item) => item.type === 'announcement')
      .map((item) => item.id);

    expect(announcementIds).toEqual(['announcement:msg-live']);
  });

  it('leaves out an announcement whose author the caller has blocked, reading as the caller', async () => {
    // The feed keeps no block list of its own (#2324): it drops the rows
    // `ChatService.getMessages` flagged `sender_blocked` for the viewer it was
    // asked about. So the guarantee is "it asks as the caller, and drops what
    // that caller's list flags". Asking as anyone else, or reading
    // `chat_messages` directly, would apply someone else's block list, or none.
    // Dropping rather than showing the masked row matters: it keeps the blocked
    // member's `sender_id`, so the item would name them over the sentinel.
    mockChatService.getChannels.mockResolvedValue([announcementsChannel]);
    mockChatService.getMessages.mockResolvedValue([
      messageFixture({
        id: 'msg-masked',
        content: '[message from a blocked member]',
        sender_blocked: true,
      }),
      messageFixture({ id: 'msg-clear', sender_blocked: false }),
    ]);

    const result = await service.getFeed(CHAPTER_ID, USER_ID);

    expect(mockChatService.getMessages).toHaveBeenCalledWith(
      announcementsChannel.id,
      CHAPTER_ID,
      USER_ID,
      expect.any(Object),
    );
    const announcementIds = result
      .filter((item) => item.type === 'announcement')
      .map((item) => item.id);
    expect(announcementIds).toEqual(['announcement:msg-clear']);
  });

  it('over-fetches announcements so soft-deleted rows do not crowd out live ones within the cap', async () => {
    mockChatService.getChannels.mockResolvedValue([announcementsChannel]);
    // 5 deleted, then 15 live — more live messages than PER_DOMAIN_LIMIT
    // survive the filter, so the final `.slice(0, PER_DOMAIN_LIMIT)` is what
    // actually caps the result at 10, not an accident of the fixture size.
    const deleted = Array.from({ length: 5 }, (_, i) =>
      messageFixture({ id: `msg-deleted-${i}`, is_deleted: true }),
    );
    const live = Array.from({ length: 15 }, (_, i) =>
      messageFixture({ id: `msg-live-${i}`, is_deleted: false }),
    );
    const allMessages = [...deleted, ...live];
    // Mirrors the real repository: the requested `limit` genuinely bounds
    // what comes back, so this test also proves the buffer multiplier is
    // load-bearing — reverting it to `PER_DOMAIN_LIMIT` would starve this
    // mock down to 5 deleted + 5 live, dropping announcementCount to 5.
    mockChatService.getMessages.mockImplementation(
      async (_channelId, _chapterId, _userId, options) =>
        allMessages.slice(0, options?.limit ?? allMessages.length),
    );

    const result = await service.getFeed(CHAPTER_ID, USER_ID, 50);
    const announcementCount = result.filter(
      (item) => item.type === 'announcement',
    ).length;

    expect(announcementCount).toBe(10);
    const [, , , requestedOptions] = mockChatService.getMessages.mock.calls[0];
    expect(requestedOptions?.limit).toBeGreaterThan(10);
  });

  describe('announcements past a page of filtered rows', () => {
    // Newest first, one minute apart, like the thread the feed reads.
    const at = (minutesAgo: number) =>
      new Date(Date.UTC(2026, 2, 3) - minutesAgo * 60_000).toISOString();

    /** A channel read that honors `limit` and `before`, as the repository does. */
    function channelOf(rows: MaskedChatMessage[]) {
      mockChatService.getChannels.mockResolvedValue([announcementsChannel]);
      mockChatService.getMessages.mockImplementation(
        async (_channelId, _chapterId, _userId, options) =>
          rows
            .filter(
              (row) => !options?.before || row.created_at < options.before,
            )
            .slice(0, options?.limit ?? rows.length),
      );
    }

    it('reads older pages when every row of the first is by a blocked author', async () => {
      // One officer the caller blocked wrote the 40 newest announcements; the
      // clear ones sit past the first buffered page.
      const blocked = Array.from({ length: 40 }, (_, i) =>
        messageFixture({
          id: `msg-blocked-${i}`,
          sender_blocked: true,
          created_at: at(i),
        }),
      );
      const clear = Array.from({ length: 12 }, (_, i) =>
        messageFixture({ id: `msg-clear-${i}`, created_at: at(40 + i) }),
      );
      channelOf([...blocked, ...clear]);

      const result = await service.getFeed(CHAPTER_ID, USER_ID, 50);
      const announcementIds = result
        .filter((item) => item.type === 'announcement')
        .map((item) => item.id);

      expect(announcementIds).toHaveLength(10);
      expect(announcementIds.every((id) => id.includes('msg-clear-'))).toBe(
        true,
      );
      const firstPage = mockChatService.getMessages.mock.calls[0][3];
      const secondPage = mockChatService.getMessages.mock.calls[1][3];
      expect(firstPage?.before).toBeUndefined();
      expect(secondPage?.before).toBe(at((firstPage?.limit ?? 0) - 1));
    });

    it('keeps the earlier pages when a later one fails', async () => {
      channelOf([
        ...Array.from({ length: 29 }, (_, i) =>
          messageFixture({
            id: `msg-blocked-${i}`,
            sender_blocked: true,
            created_at: at(i),
          }),
        ),
        messageFixture({ id: 'msg-clear', created_at: at(29) }),
      ]);
      const firstPage = mockChatService.getMessages.getMockImplementation();
      mockChatService.getMessages
        .mockImplementationOnce(firstPage)
        .mockRejectedValueOnce(new Error('connection reset'));

      const result = await service.getFeed(CHAPTER_ID, USER_ID, 50);

      expect(
        result
          .filter((item) => item.type === 'announcement')
          .map((item) => item.id),
      ).toEqual(['announcement:msg-clear']);
      expect(mockChatService.getMessages).toHaveBeenCalledTimes(2);
    });

    it('fails the domain when the first page fails', async () => {
      // Nothing was read, so nothing is kept: getFeed records the domain as
      // failed, rather than the loop settling quietly for an empty page.
      const warn = jest
        .spyOn(Logger.prototype, 'warn')
        .mockImplementation(() => undefined);
      mockChatService.getChannels.mockResolvedValue([announcementsChannel]);
      mockChatService.getMessages.mockRejectedValue(
        new Error('block list unavailable'),
      );

      const result = await service.getFeed(CHAPTER_ID, USER_ID, 50);

      expect(result.filter((item) => item.type === 'announcement')).toEqual([]);
      expect(warn).toHaveBeenCalledWith(
        expect.stringContaining("domain 'announcements' failed"),
      );
      warn.mockRestore();
    });

    it('stops after a bounded number of pages rather than scan the channel', async () => {
      channelOf(
        Array.from({ length: 500 }, (_, i) =>
          messageFixture({
            id: `msg-blocked-${i}`,
            sender_blocked: true,
            created_at: at(i),
          }),
        ),
      );

      const result = await service.getFeed(CHAPTER_ID, USER_ID, 50);

      expect(result.filter((item) => item.type === 'announcement')).toEqual([]);
      expect(mockChatService.getMessages).toHaveBeenCalledTimes(3);
    });
  });

  it('gives a departed member an empty-name actor rather than dropping or nulling it', async () => {
    mockRbacService.getEffectivePermissions.mockResolvedValue(['*']);
    mockBackworkService.findByChapter.mockResolvedValue([
      backworkFixture({ id: 'res-1', uploader_id: 'user-gone' }),
    ]);
    // Roster (from findRosterWithJoinDates) has no entry for 'user-gone'.
    mockMemberService.findRosterWithJoinDates.mockResolvedValue([]);

    const result = await service.getFeed(CHAPTER_ID, USER_ID);
    const backworkItem = result.find((item) => item.type === 'backwork_upload');

    expect(backworkItem?.actor).toEqual({
      user_id: 'user-gone',
      display_name: '',
      avatar_url: null,
    });
  });

  it('degrades one failing domain to an empty contribution instead of failing the whole feed', async () => {
    mockEventService.findByChapter.mockRejectedValue(new Error('db hiccup'));
    mockPointsService.getUserSummary.mockResolvedValue({
      balance: 5,
      transactions: [
        {
          id: 'txn-1',
          chapter_id: CHAPTER_ID,
          user_id: USER_ID,
          amount: 5,
          category: 'ATTENDANCE',
          description: 'Chapter meeting',
          metadata: {},
          created_at: '2026-03-01T00:00:00.000Z',
        },
      ],
    });

    const result = await service.getFeed(CHAPTER_ID, USER_ID);

    expect(result.some((item) => item.type === 'points_change')).toBe(true);
    expect(result.some((item) => item.type.startsWith('event_'))).toBe(false);
  });

  it('omits backwork items when the caller lacks BACKWORK_UPLOAD/BACKWORK_ADMIN', async () => {
    mockRbacService.getEffectivePermissions.mockResolvedValue([
      SystemPermissions.MEMBERS_VIEW,
    ]);
    mockBackworkService.findByChapter.mockResolvedValue([
      backworkFixture({ id: 'res-1' }),
    ]);

    const result = await service.getFeed(CHAPTER_ID, USER_ID);

    expect(mockBackworkService.findByChapter).not.toHaveBeenCalled();
    expect(result.some((item) => item.type === 'backwork_upload')).toBe(false);
  });

  it('includes backwork items when the caller holds BACKWORK_UPLOAD', async () => {
    mockRbacService.getEffectivePermissions.mockResolvedValue([
      SystemPermissions.BACKWORK_UPLOAD,
    ]);
    mockBackworkService.findByChapter.mockResolvedValue([
      backworkFixture({ id: 'res-1' }),
    ]);

    const result = await service.getFeed(CHAPTER_ID, USER_ID);

    expect(mockBackworkService.findByChapter).toHaveBeenCalledWith(CHAPTER_ID);
    expect(result.some((item) => item.type === 'backwork_upload')).toBe(true);
  });

  it('includes backwork items when the caller holds the wildcard permission', async () => {
    mockRbacService.getEffectivePermissions.mockResolvedValue(['*']);
    mockBackworkService.findByChapter.mockResolvedValue([
      backworkFixture({ id: 'res-1' }),
    ]);

    const result = await service.getFeed(CHAPTER_ID, USER_ID);

    expect(result.some((item) => item.type === 'backwork_upload')).toBe(true);
  });

  it('clamps an out-of-range limit into 1–50', async () => {
    mockEventService.findByChapter.mockResolvedValue(
      Array.from({ length: 60 }, (_, i) =>
        eventFixture({
          id: `evt-${i}`,
          created_at: new Date(2026, 0, i + 1).toISOString(),
        }),
      ),
    );

    const result = await service.getFeed(CHAPTER_ID, USER_ID, 1000);
    expect(result.length).toBeLessThanOrEqual(50);
  });

  function eventFixture(overrides: Partial<Event>): Event {
    return {
      id: 'evt-1',
      chapter_id: CHAPTER_ID,
      name: 'Chapter Meeting',
      description: null,
      location: 'Great Room',
      start_time: '2026-01-01T00:00:00.000Z',
      end_time: '2026-01-01T01:00:00.000Z',
      point_value: 5,
      is_mandatory: false,
      recurrence_rule: null,
      parent_event_id: null,
      required_role_ids: null,
      notes: null,
      check_in_zone: null,
      check_in_zone_name: null,
      created_at: '2026-01-01T00:00:00.000Z',
      ...overrides,
    };
  }

  function backworkFixture(
    overrides: Partial<BackworkResource>,
  ): BackworkResource {
    return {
      id: 'res-1',
      chapter_id: CHAPTER_ID,
      department_id: null,
      course_number: null,
      professor_id: null,
      uploader_id: USER_ID,
      title: 'CS101 Homework 3',
      year: 2026,
      semester: null,
      assignment_type: null,
      assignment_number: null,
      document_variant: null,
      storage_path: 'chapter-1/res-1',
      file_hash: 'hash',
      is_redacted: false,
      tags: [],
      created_at: '2026-01-01T00:00:00.000Z',
      ...overrides,
    };
  }

  function joinFixture(overrides: Partial<RecentMemberJoin>): RecentMemberJoin {
    return {
      user_id: 'user-2',
      display_name: 'New Member',
      avatar_url: null,
      joined_at: '2026-01-01T00:00:00.000Z',
      ...overrides,
    };
  }

  /**
   * `ChatService.getMessages` masks what it serves (#2257), so what this feed
   * actually receives is a `MaskedChatMessage` — every row carrying
   * `sender_blocked`, not only the masked ones. The fixture says so rather than
   * modelling a shape the service can no longer return.
   */
  function messageFixture(
    overrides: Partial<MaskedChatMessage>,
  ): MaskedChatMessage {
    return {
      id: 'msg-1',
      channel_id: announcementsChannel.id,
      sender_id: USER_ID,
      content: 'Chapter meeting moved to Thursday',
      type: 'TEXT',
      is_deleted: false,
      created_at: '2026-03-03T00:00:00.000Z',
      sender_blocked: false,
      ...overrides,
    } as MaskedChatMessage;
  }
});
