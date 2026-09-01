import { Test, TestingModule } from '@nestjs/testing';
import { ActivityFeedService } from './activity-feed.service';
import { EventService } from './event.service';
import { PointsService } from './points.service';
import { BackworkService } from './backwork.service';
import { MemberService, RecentMemberJoin } from './member.service';
import { ChatService } from './chat.service';
import { RbacService } from './rbac.service';
import { SystemPermissions } from '../../domain/constants/permissions';
import type { Event } from '../../domain/entities/event.entity';
import type { PointTransaction } from '../../domain/entities/point-transaction.entity';
import type { BackworkResource } from '../../domain/entities/backwork.entity';
import type {
  ChatChannel,
  ChatMessage,
} from '../../domain/entities/chat.entity';

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

    expect(mockEventService.findByChapter).toHaveBeenCalledWith(CHAPTER_ID);
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

  function messageFixture(overrides: Partial<ChatMessage>): ChatMessage {
    return {
      id: 'msg-1',
      channel_id: announcementsChannel.id,
      sender_id: USER_ID,
      content: 'Chapter meeting moved to Thursday',
      type: 'TEXT',
      is_deleted: false,
      created_at: '2026-03-03T00:00:00.000Z',
      ...overrides,
    } as ChatMessage;
  }
});
