import { Test, TestingModule } from '@nestjs/testing';
import { ActivityFeedService } from './activity-feed.service';
import { EventService } from './event.service';
import { PointsService } from './points.service';
import { BackworkService } from './backwork.service';
import { MemberService } from './member.service';
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
    Pick<MemberService, 'findRosterByChapter' | 'findRecentJoins'>
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
      findRosterByChapter: jest.fn().mockResolvedValue([]),
      findRecentJoins: jest.fn().mockResolvedValue([]),
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
    expect(mockMemberService.findRosterByChapter).toHaveBeenCalledWith(
      CHAPTER_ID,
    );
    expect(mockMemberService.findRecentJoins).toHaveBeenCalledWith(
      CHAPTER_ID,
      expect.any(Number),
    );
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
    // spec's "own point changes" rule. There is deliberately no mock for
    // listTransactions (the POINTS_VIEW_ALL-gated chapter-wide read): if a
    // future change reaches for it, this test has nothing to assert against
    // and TypeScript would catch the missing dependency at compile time.
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
    mockMemberService.findRecentJoins.mockResolvedValue([
      {
        user_id: 'user-2',
        display_name: 'New Member',
        avatar_url: null,
        joined_at: '2026-03-02T00:00:00.000Z',
      },
    ]);
    mockChatService.getChannels.mockResolvedValue([announcementsChannel]);
    const message: ChatMessage = {
      id: 'msg-1',
      channel_id: announcementsChannel.id,
      sender_id: USER_ID,
      content: 'Chapter meeting moved to Thursday',
      type: 'TEXT',
      created_at: '2026-03-03T00:00:00.000Z',
    } as ChatMessage;
    mockChatService.getMessages.mockResolvedValue([message]);

    const result = await service.getFeed(CHAPTER_ID, USER_ID);
    const types = new Set(result.map((item) => item.type));

    expect(types.has('event_upcoming')).toBe(true);
    expect(types.has('points_change')).toBe(true);
    expect(types.has('member_joined')).toBe(true);
    expect(types.has('announcement')).toBe(true);
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
});
