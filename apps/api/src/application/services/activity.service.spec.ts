import * as caughtFailure from '../../infrastructure/observability/report-caught-failure';
import { ActivityService } from './activity.service';
import type { ActivityLink } from './activity-link.service';
import type { TaskListOptions } from './task.service';
import { TaskStatus } from '#domain/entities/task.entity';
import type { TaskView } from '#domain/entities/task.entity';
import type { ChatMessage } from '#domain/entities/chat.entity';
import type { Event } from '#domain/entities/event.entity';
import { SystemPermissions } from '#domain/constants/permissions';

const CHAPTER = 'chapter-1';
const ME = 'user-me';
const OTHER = 'user-other';
const BLOCKED = 'user-blocked';
const READABLE = 'channel-readable';
const UNREADABLE = 'channel-unreadable';

const NOW = new Date('2026-11-10T18:00:00.000Z');
const HOUR = 60 * 60 * 1000;
/** The week `NOW` (a Tuesday) falls in when a client names none: from Sunday 00:00 UTC. */
const WEEK_START = '2026-11-08T00:00:00.000Z';
const iso = (offsetMs: number) =>
  new Date(NOW.getTime() + offsetMs).toISOString();

const task = (overrides: Partial<TaskView>): TaskView => ({
  id: 'task-1',
  chapter_id: CHAPTER,
  title: 'Book the venue',
  description: null,
  assignee_id: ME,
  created_by: OTHER,
  due_date: '2026-11-20',
  due_at: null,
  status: TaskStatus.TODO,
  stored_status: TaskStatus.TODO,
  point_reward: 5,
  points_awarded: false,
  completed_at: null,
  confirmed_at: null,
  sent_back_at: null,
  proof_kind: 'none',
  proof_link: null,
  sent_back_reason: null,
  completion_note: null,
  created_at: iso(-48 * HOUR),
  ...overrides,
});

const pollCard = (overrides: Partial<ChatMessage> & { id: string }) =>
  ({
    channel_id: READABLE,
    sender_id: OTHER,
    content: 'Poll: Formal venue?',
    kind: 'poll',
    payload: {
      question: 'Formal venue?',
      options: [
        { id: 'a', label: 'Downtown' },
        { id: 'b', label: 'Campus' },
      ],
      closes_at: iso(24 * HOUR),
    },
    is_deleted: false,
    created_at: iso(-2 * HOUR),
    ...overrides,
  }) as ChatMessage;

const event = (overrides: Partial<Event>): Event =>
  ({
    id: 'event-1',
    chapter_id: CHAPTER,
    name: 'Chapter meeting',
    location: 'Room 101',
    start_time: iso(48 * HOUR),
    end_time: iso(49 * HOUR),
    point_value: 10,
    is_mandatory: true,
    required_role_ids: null,
    optional_role_ids: null,
    excluded_role_ids: null,
    others_invited: null,
    check_in_opens_minutes: 10,
    parent_event_id: null,
    created_by: null,
    created_at: iso(-72 * HOUR),
    ...overrides,
  }) as Event;

function build(permissions: string[] = [SystemPermissions.MEMBERS_VIEW]) {
  const taskService = {
    list: jest.fn().mockResolvedValue([]),
    count: jest.fn().mockResolvedValue(0),
  };
  const serviceEntryService = {
    findByChapterFiltered: jest.fn().mockResolvedValue([]),
  };
  const eventService = {
    findByChapter: jest.fn().mockResolvedValue([]),
    findCreatedBy: jest.fn().mockResolvedValue([]),
    // No officer's screen is live unless a test says so (#4808).
    checkInNeedsCode: jest.fn().mockResolvedValue(false),
  };
  const chatService = {
    getChannels: jest
      .fn()
      .mockResolvedValue([{ id: READABLE, name: 'general', type: 'PUBLIC' }]),
  };
  const chatBlocks = { listBlockedUserIds: jest.fn().mockResolvedValue([]) };
  const rbacService = {
    getEffectivePermissions: jest.fn().mockResolvedValue(permissions),
    isAlumni: jest.fn().mockResolvedValue(false),
  };
  const messageRepo = {
    findCardsByChapter: jest.fn().mockResolvedValue([]),
  };
  const actionRepo = {
    findActionsOnMessages: jest.fn().mockResolvedValue([]),
    findAllActionsOnMessages: jest.fn().mockResolvedValue([]),
  };
  const linkService = { listFor: jest.fn().mockResolvedValue([]) };
  const userRepo = {
    findDisplayIdentitiesByIds: jest.fn().mockResolvedValue([
      { id: ME, display_name: 'Me Member', avatar_url: null },
      { id: OTHER, display_name: 'Other Member', avatar_url: null },
    ]),
  };
  const memberRepo = {
    findByUserAndChapter: jest
      .fn()
      .mockResolvedValue({ user_id: ME, role_ids: ['role-member'] }),
  };
  const attendanceRepo = {
    findByEventAndUser: jest.fn().mockResolvedValue(null),
    findByUserForEvents: jest.fn().mockResolvedValue([]),
  };
  const formResponseRepo = {
    findAnswered: jest.fn().mockResolvedValue([]),
  };
  const readRepo = {
    // No client has begun this member's dots: every row is read.
    findUnreadStart: jest.fn().mockResolvedValue(null),
    startUnread: jest.fn().mockResolvedValue(undefined),
    findReads: jest.fn().mockResolvedValue([]),
    markRead: jest.fn().mockResolvedValue(undefined),
  };
  const service = new ActivityService(
    taskService as never,
    serviceEntryService as never,
    eventService as never,
    chatService as never,
    chatBlocks as never,
    rbacService as never,
    linkService as never,
    messageRepo as never,
    actionRepo as never,
    userRepo as never,
    memberRepo as never,
    attendanceRepo as never,
    readRepo,
    formResponseRepo as never,
  );
  return {
    service,
    readRepo,
    formResponseRepo,
    taskService,
    serviceEntryService,
    eventService,
    attendanceRepo,
    memberRepo,
    rbacService,
    chatService,
    chatBlocks,
    messageRepo,
    actionRepo,
    linkService,
  };
}

/** `findCardsByChapter` answers the chapter scan and the caller's own list separately. */
function servePolls(
  messageRepo: { findCardsByChapter: jest.Mock },
  recent: ChatMessage[],
  own: ChatMessage[] = [],
) {
  messageRepo.findCardsByChapter.mockImplementation(
    (_chapterId: string, options: { kind: string; senderId?: string }) =>
      Promise.resolve(
        options.kind !== 'poll' ? [] : options.senderId ? own : recent,
      ),
  );
}

/** Sign-up and form cards for `findCardsByChapter`'s chapter-wide reads. */
function serveCards(
  messageRepo: { findCardsByChapter: jest.Mock },
  cards: ChatMessage[],
) {
  messageRepo.findCardsByChapter.mockImplementation(
    (_chapterId: string, options: { kind: string }) =>
      Promise.resolve(cards.filter((card) => card.kind === options.kind)),
  );
}

const signupCard = (
  overrides: Partial<ChatMessage> & { id: string },
  payload: Record<string, unknown> = {},
) =>
  ({
    channel_id: READABLE,
    sender_id: OTHER,
    content: 'Sign-up: Sober drivers',
    kind: 'signup',
    payload: {
      title: 'Sober drivers',
      slots: [
        { id: 'fri', label: 'Friday', capacity: 2 },
        { id: 'sat', label: 'Saturday', capacity: 2 },
      ],
      closes_at: iso(48 * HOUR),
      ...payload,
    },
    is_deleted: false,
    created_at: iso(-3 * HOUR),
    ...overrides,
  }) as ChatMessage;

const formCard = (
  overrides: Partial<ChatMessage> & { id: string },
  payload: Record<string, unknown> = {},
) =>
  ({
    channel_id: READABLE,
    sender_id: OTHER,
    content: 'Form: Room picks',
    kind: 'form',
    payload: {
      title: 'Room picks',
      questions: [
        { id: 'q1', type: 'short_answer', title: 'Your name', required: true },
        { id: 'q2', type: 'yes_no', title: 'Staying over?', required: false },
      ],
      ...payload,
    },
    is_deleted: false,
    created_at: iso(-1 * HOUR),
    ...overrides,
  }) as ChatMessage;

/**
 * `TaskService.list` answers the caller's own tasks and the chapter-wide list
 * separately, each narrowed as the repository narrows it in SQL (#4037).
 */
function serveTasks(
  taskService: { list: jest.Mock; count: jest.Mock },
  own: TaskView[],
  all: TaskView[] = [],
) {
  const matching = (isAdmin: boolean, options: TaskListOptions) =>
    (isAdmin ? all : own).filter(
      (row) =>
        (options.status === undefined ||
          row.stored_status === options.status) &&
        (options.confirmed === undefined ||
          (row.confirmed_at !== null) === options.confirmed) &&
        (options.createdBy === undefined ||
          row.created_by === options.createdBy) &&
        (options.notAssigneeId === undefined ||
          row.assignee_id !== options.notAssigneeId) &&
        (options.completedSince === undefined ||
          (row.completed_at !== null &&
            row.completed_at >= options.completedSince)),
    );
  taskService.list.mockImplementation(
    (
      _chapterId: string,
      _userId: string,
      isAdmin: boolean,
      options: TaskListOptions = {},
    ) => {
      const rows = matching(isAdmin, options);
      if (options.order === 'longest_waiting') {
        rows.sort((a, b) =>
          (a.completed_at ?? '').localeCompare(b.completed_at ?? ''),
        );
      }
      return Promise.resolve(rows.slice(0, options.limit ?? rows.length));
    },
  );
  taskService.count.mockImplementation(
    (
      _chapterId: string,
      _userId: string,
      isAdmin: boolean,
      options: TaskListOptions = {},
    ) => Promise.resolve(matching(isAdmin, options).length),
  );
}

describe('ActivityService', () => {
  beforeEach(() => {
    jest.useFakeTimers().setSystemTime(NOW);
  });
  afterEach(() => {
    jest.useRealTimers();
  });

  describe('polls', () => {
    it('lists an open poll the caller has not voted on, from a channel they can read', async () => {
      const { service, messageRepo } = build();
      servePolls(messageRepo, [pollCard({ id: 'poll-1' })]);

      const view = await service.getActivity(CHAPTER, ME, null);

      expect(view.needs_you.polls).toEqual([
        expect.objectContaining({
          message_id: 'poll-1',
          channel_id: READABLE,
          channel_name: 'general',
          channel_type: 'PUBLIC',
          question: 'Formal venue?',
          option_count: 2,
          is_closed: false,
          has_voted: false,
          // The chat message itself, in the shape chat serves, for chat's card.
          message: expect.objectContaining({
            id: 'poll-1',
            kind: 'poll',
            sender_blocked: false,
          }),
        }),
      ]);
      expect(view.needs_you_count).toBe(1);
    });

    it('never lists a poll from a channel the caller cannot read, their own included', async () => {
      const { service, messageRepo, actionRepo } = build();
      servePolls(
        messageRepo,
        [pollCard({ id: 'poll-hidden', channel_id: UNREADABLE })],
        [
          pollCard({
            id: 'poll-mine-hidden',
            channel_id: UNREADABLE,
            sender_id: ME,
          }),
        ],
      );

      const view = await service.getActivity(CHAPTER, ME, null);

      expect(view.needs_you.polls).toEqual([]);
      expect(view.made_by_you.polls).toEqual([]);
      expect(view.needs_you_count).toBe(0);
      // Nothing about the hidden polls is even asked of the vote table.
      expect(actionRepo.findActionsOnMessages).toHaveBeenCalledWith(
        [],
        ME,
        'vote',
      );
    });

    it('leaves out a poll whose author the caller has blocked', async () => {
      const { service, messageRepo, chatBlocks } = build();
      chatBlocks.listBlockedUserIds.mockResolvedValue([BLOCKED]);
      servePolls(messageRepo, [
        pollCard({ id: 'poll-blocked', sender_id: BLOCKED }),
        pollCard({ id: 'poll-ok' }),
      ]);

      const view = await service.getActivity(CHAPTER, ME, null);

      expect(view.needs_you.polls.map((poll) => poll.message_id)).toEqual([
        'poll-ok',
      ]);
      expect(chatBlocks.listBlockedUserIds).toHaveBeenCalledWith(CHAPTER, ME);
    });

    it('serves no polls, cards or links, and says so, when the block list cannot be read', async () => {
      const { service, messageRepo, chatBlocks } = build();
      chatBlocks.listBlockedUserIds.mockRejectedValue(new Error('db down'));
      servePolls(messageRepo, [pollCard({ id: 'poll-1' })]);

      const view = await service.getActivity(CHAPTER, ME, null);

      expect(view.needs_you.polls).toEqual([]);
      expect(view.made_by_you.polls).toEqual([]);
      // Sign-up and form cards and links mask by the same block list, so they
      // fail with it rather than list a blocked member's card or link.
      expect(view.needs_you.cards).toEqual([]);
      expect(view.links).toEqual([]);
      expect(view.unavailable).toEqual(['polls', 'cards', 'links']);
    });

    it('serves the caller’s links, uncounted in needs_you_count (#3897)', async () => {
      const { service, linkService } = build();
      const row = {
        id: 'link-1',
        url: 'https://forms.gle/abc',
        host: 'forms.gle',
        message_id: 'msg-1',
        channel_id: READABLE,
        channel_name: 'general',
        channel_type: 'PUBLIC',
        posted_by: OTHER,
        posted_by_name: 'Other Member',
        posted_at: iso(-HOUR),
      };
      linkService.listFor.mockResolvedValue([row]);

      const view = await service.getActivity(CHAPTER, ME, null);

      expect(linkService.listFor).toHaveBeenCalledWith(
        CHAPTER,
        ME,
        expect.any(Number),
        {
          channels: [{ id: READABLE, name: 'general', type: 'PUBLIC' }],
          blockedUserIds: [],
        },
      );
      expect(view.links).toEqual([row]);
      expect(view.needs_you_count).toBe(0);
    });

    it('reads chat’s channel list and the block list once for polls and links', async () => {
      const { service, chatService, chatBlocks } = build();

      await service.getActivity(CHAPTER, ME, null);

      expect(chatService.getChannels).toHaveBeenCalledTimes(1);
      expect(chatBlocks.listBlockedUserIds).toHaveBeenCalledTimes(1);
    });

    it('serves no links, and says so, when the links read fails', async () => {
      const { service, linkService } = build();
      linkService.listFor.mockRejectedValue(new Error('db down'));

      const view = await service.getActivity(CHAPTER, ME, null);

      expect(view.links).toEqual([]);
      expect(view.unavailable).toEqual(['links']);
    });

    it('reports a failed section to Sentry at error level, not only the log (#4096)', async () => {
      const reported = jest.spyOn(caughtFailure, 'reportCaughtFailure');
      const { service, messageRepo } = build();
      messageRepo.findCardsByChapter.mockImplementation(
        (_chapterId: string, options: { kind: string }) =>
          options.kind === 'poll'
            ? Promise.reject(new Error('db down'))
            : Promise.resolve([]),
      );

      try {
        await service.getActivity(CHAPTER, ME, null);
        expect(reported).toHaveBeenCalledTimes(1);
        expect(reported).toHaveBeenCalledWith(
          expect.anything(),
          expect.objectContaining({
            level: 'error',
            site: 'activity-section:polls',
            error: expect.any(Error),
          }),
        );
      } finally {
        reported.mockRestore();
      }
    });

    it('leaves out polls that are voted on, closed, expired, the caller’s own, or unreadable as a card', async () => {
      const { service, messageRepo, actionRepo } = build();
      const payloadOf = (extra: Record<string, unknown>) => ({
        ...pollCard({ id: 'x' }).payload,
        ...extra,
      });
      servePolls(messageRepo, [
        pollCard({ id: 'voted' }),
        pollCard({
          id: 'closed-early',
          payload: payloadOf({ closed_at: iso(-HOUR) }),
        }),
        pollCard({ id: 'expired', payload: payloadOf({ closes_at: iso(-1) }) }),
        pollCard({ id: 'mine', sender_id: ME }),
        pollCard({ id: 'malformed', payload: { question: 'No options' } }),
        pollCard({ id: 'open' }),
      ]);
      actionRepo.findActionsOnMessages.mockResolvedValue([
        { message_id: 'voted', payload: { option_id: 'a' } },
      ]);

      const view = await service.getActivity(CHAPTER, ME, null);

      expect(view.needs_you.polls.map((poll) => poll.message_id)).toEqual([
        'open',
      ]);
    });

    it('counts a cleared multi-choice vote as not voted (#3793)', async () => {
      const { service, messageRepo, actionRepo } = build();
      servePolls(messageRepo, [pollCard({ id: 'cleared' })]);
      // The row outlives the vote: every pick was cleared.
      actionRepo.findActionsOnMessages.mockResolvedValue([
        { message_id: 'cleared', payload: { option_id: [] } },
      ]);

      const view = await service.getActivity(CHAPTER, ME, null);

      expect(view.needs_you.polls.map((poll) => poll.message_id)).toEqual([
        'cleared',
      ]);
    });

    it('lists the caller’s own polls under made by you, closed ones included', async () => {
      const { service, messageRepo, actionRepo } = build();
      servePolls(
        messageRepo,
        [],
        [
          pollCard({ id: 'mine-open', sender_id: ME }),
          pollCard({
            id: 'mine-closed',
            sender_id: ME,
            payload: {
              ...pollCard({ id: 'x' }).payload,
              closed_at: iso(-HOUR),
            },
          }),
        ],
      );
      actionRepo.findActionsOnMessages.mockResolvedValue([
        { message_id: 'mine-open', payload: { option_id: ['a', 'b'] } },
      ]);

      const view = await service.getActivity(CHAPTER, ME, null);

      expect(view.made_by_you.polls).toEqual([
        expect.objectContaining({
          message_id: 'mine-open',
          is_closed: false,
          has_voted: true,
        }),
        expect.objectContaining({
          message_id: 'mine-closed',
          is_closed: true,
          has_voted: false,
        }),
      ]);
      // Your own poll is not something waiting on you.
      expect(view.needs_you_count).toBe(0);
    });

    it('caps the caller’s open and closed polls apart, so closed ones never push an open one out (#4258)', async () => {
      const { service, messageRepo } = build();
      const closedPayload = {
        ...pollCard({ id: 'x' }).payload,
        closed_at: iso(-HOUR),
      };
      // Thirty newer polls, all closed, then one older poll still open.
      const closed = Array.from({ length: 30 }, (_, index) =>
        pollCard({
          id: `closed-${index}`,
          sender_id: ME,
          payload: closedPayload,
          created_at: iso(-(index + 1) * HOUR),
        }),
      );
      const open = pollCard({
        id: 'old-open',
        sender_id: ME,
        payload: { ...pollCard({ id: 'y' }).payload, closes_at: null },
        created_at: iso(-100 * HOUR),
      });
      servePolls(messageRepo, [], [...closed, open]);

      const view = await service.getActivity(CHAPTER, ME, null);
      const ids = view.made_by_you.polls.map((poll) => poll.message_id);

      expect(ids).toContain('old-open');
      expect(ids.filter((id) => id.startsWith('closed-'))).toEqual(
        closed.slice(0, 25).map((poll) => poll.id),
      );
      // Newest first, the open one last since it is the oldest.
      expect(ids.at(-1)).toBe('old-open');
      expect(messageRepo.findCardsByChapter).toHaveBeenCalledWith(CHAPTER, {
        kind: 'poll',
        senderId: ME,
        limit: 100,
      });
      expect(view.made_by_you.files).toEqual([]);
    });

    it('reads no polls while the Polls module is off', async () => {
      const { service, messageRepo, chatService } = build();
      servePolls(messageRepo, [pollCard({ id: 'poll-1' })]);

      const view = await service.getActivity(CHAPTER, ME, { polls: false });

      expect(view.needs_you.polls).toEqual([]);
      expect(messageRepo.findCardsByChapter).not.toHaveBeenCalledWith(
        CHAPTER,
        expect.objectContaining({ kind: 'poll' }),
      );
    });
  });

  describe('sign-up and form cards (#3926 step 4)', () => {
    it('lists open sign-ups, headcounts and forms the caller has not answered, soonest closing first', async () => {
      const { service, messageRepo, formResponseRepo } = build();
      serveCards(messageRepo, [
        signupCard({ id: 'sheet' }),
        signupCard(
          { id: 'headcount' },
          { format: 'headcount', closes_at: iso(2 * HOUR) },
        ),
        formCard({ id: 'form' }),
      ]);

      const view = await service.getActivity(CHAPTER, ME, null);

      expect(
        view.needs_you.cards.map((card) => [
          card.message_id,
          card.kind,
          card.item_count,
        ]),
      ).toEqual([
        ['headcount', 'headcount', 2],
        ['sheet', 'signup', 2],
        // No end time: last.
        ['form', 'form', 2],
      ]);
      expect(view.needs_you.cards[0]).toMatchObject({
        channel_name: 'general',
        channel_type: 'PUBLIC',
        sender_id: OTHER,
        title: 'Sober drivers',
        unread: false,
      });
      expect(view.needs_you_count).toBe(3);
      expect(formResponseRepo.findAnswered).toHaveBeenCalledWith(['form'], ME);
    });

    it('leaves out a card the caller answered, either headcount answer included, but keeps a cleared claim', async () => {
      const { service, messageRepo, actionRepo, formResponseRepo } = build();
      serveCards(messageRepo, [
        signupCard({ id: 'claimed' }),
        signupCard({ id: 'cleared' }),
        signupCard({ id: 'going' }, { format: 'headcount' }),
        signupCard({ id: 'not-going' }, { format: 'headcount' }),
        formCard({ id: 'answered-form' }),
        formCard({ id: 'open-form' }),
      ]);
      actionRepo.findAllActionsOnMessages.mockResolvedValue([
        { message_id: 'claimed', user_id: ME, payload: { slot_ids: ['fri'] } },
        { message_id: 'cleared', user_id: ME, payload: { slot_ids: [] } },
        // Someone else's claim is not the caller's answer.
        {
          message_id: 'cleared',
          user_id: OTHER,
          payload: { slot_ids: ['fri'] },
        },
        { message_id: 'going', user_id: ME, payload: { slot_ids: ['going'] } },
        {
          message_id: 'not-going',
          user_id: ME,
          payload: { slot_ids: ['not_going'] },
        },
      ]);
      formResponseRepo.findAnswered.mockResolvedValue([
        { message_id: 'answered-form', created_at: iso(-HOUR) },
      ]);

      const view = await service.getActivity(CHAPTER, ME, null);

      expect(view.needs_you.cards.map((card) => card.message_id)).toEqual([
        'cleared',
        'open-form',
      ]);
      expect(actionRepo.findAllActionsOnMessages).toHaveBeenCalledWith(
        ['claimed', 'cleared', 'going', 'not-going'],
        'signup',
      );
    });

    it('leaves out a sheet whose every slot is full, but not one with room or no limit', async () => {
      const { service, messageRepo, actionRepo } = build();
      const oneSpot = { slots: [{ id: 'fri', label: 'Friday', capacity: 1 }] };
      serveCards(messageRepo, [
        signupCard({ id: 'full' }, oneSpot),
        signupCard({ id: 'room' }, oneSpot),
        signupCard(
          { id: 'unlimited' },
          { slots: [{ id: 'fri', label: 'Friday', capacity: null }] },
        ),
        signupCard({ id: 'head' }, { format: 'headcount' }),
      ]);
      actionRepo.findAllActionsOnMessages.mockResolvedValue([
        { message_id: 'full', user_id: OTHER, payload: { slot_ids: ['fri'] } },
        {
          message_id: 'unlimited',
          user_id: OTHER,
          payload: { slot_ids: ['fri'] },
        },
        {
          message_id: 'head',
          user_id: OTHER,
          payload: { slot_ids: ['going'] },
        },
      ]);

      const view = await service.getActivity(CHAPTER, ME, null);

      expect(
        view.needs_you.cards.map((card) => card.message_id).sort(),
      ).toEqual(['head', 'room', 'unlimited']);
      expect(view.needs_you_count).toBe(3);
    });

    it('breaks a tie on end time newest first, and serves a bad end time as none', async () => {
      const { service, messageRepo } = build();
      serveCards(messageRepo, [
        formCard({ id: 'older', created_at: iso(-5 * HOUR) }),
        formCard({ id: 'newer', created_at: iso(-HOUR) }),
        formCard(
          { id: 'garbled', created_at: iso(-3 * HOUR) },
          { closes_at: 'not a date' },
        ),
      ]);

      const view = await service.getActivity(CHAPTER, ME, null);

      expect(
        view.needs_you.cards.map((card) => [card.message_id, card.closes_at]),
      ).toEqual([
        ['newer', null],
        ['garbled', null],
        ['older', null],
      ]);
    });

    it('caps the list at 25 and counts every one', async () => {
      const { service, messageRepo } = build();
      serveCards(
        messageRepo,
        Array.from({ length: 30 }, (_, i) => formCard({ id: `form-${i}` })),
      );

      const view = await service.getActivity(CHAPTER, ME, null);

      expect(view.needs_you.cards).toHaveLength(25);
      expect(view.needs_you_count).toBe(30);
    });

    it('leaves out the caller’s own, closed ones, unreadable channels and blocked members', async () => {
      const { service, messageRepo, chatBlocks } = build();
      chatBlocks.listBlockedUserIds.mockResolvedValue([BLOCKED]);
      serveCards(messageRepo, [
        signupCard({ id: 'mine', sender_id: ME }),
        signupCard({ id: 'closed-early' }, { closed_at: iso(-HOUR) }),
        formCard({ id: 'expired' }, { closes_at: iso(-HOUR) }),
        formCard({ id: 'hidden', channel_id: UNREADABLE }),
        signupCard({ id: 'blocked', sender_id: BLOCKED }),
        signupCard({ id: 'waiting' }),
      ]);

      const view = await service.getActivity(CHAPTER, ME, null);

      expect(view.needs_you.cards.map((card) => card.message_id)).toEqual([
        'waiting',
      ]);
    });

    it('is listed with every module off: a card is a chat message', async () => {
      const { service, messageRepo } = build();
      serveCards(messageRepo, [signupCard({ id: 'sheet' })]);

      const view = await service.getActivity(CHAPTER, ME, {
        polls: false,
        tasks: false,
        events: false,
        hours: false,
      });

      expect(view.needs_you.cards).toHaveLength(1);
    });

    it('serves the section empty and names it when the answers can’t be read', async () => {
      const { service, messageRepo, formResponseRepo } = build();
      serveCards(messageRepo, [formCard({ id: 'form' })]);
      formResponseRepo.findAnswered.mockRejectedValue(new Error('down'));

      const view = await service.getActivity(CHAPTER, ME, null);

      expect(view.needs_you.cards).toEqual([]);
      expect(view.unavailable).toContain('cards');
    });

    it('dots a card the caller has not opened, under its own read kind', async () => {
      const { service, messageRepo, readRepo } = build();
      readRepo.findUnreadStart.mockResolvedValue(iso(-10 * HOUR));
      readRepo.findReads.mockResolvedValue([
        { kind: 'signup', item_id: 'sheet', read_at: iso(-HOUR) },
        // A read under the wrong kind is not this card's.
        { kind: 'signup', item_id: 'form', read_at: iso(-HOUR / 2) },
      ]);
      serveCards(messageRepo, [
        signupCard({ id: 'sheet' }),
        formCard({ id: 'form' }),
      ]);

      const view = await service.getActivity(CHAPTER, ME, null);

      expect(
        view.needs_you.cards.map((card) => [card.message_id, card.unread]),
      ).toEqual([
        ['sheet', false],
        ['form', true],
      ]);
    });
  });

  describe('tasks', () => {
    it('gives a member their open tasks, soonest due first, and nothing chapter-wide', async () => {
      const { service, taskService } = build();
      serveTasks(
        taskService,
        [
          task({ id: 'later', due_date: '2026-12-01' }),
          task({ id: 'sooner', due_date: '2026-11-12' }),
          task({
            id: 'done',
            status: TaskStatus.COMPLETED,
            stored_status: TaskStatus.COMPLETED,
            completed_at: iso(-HOUR),
          }),
        ],
        // What the chapter-wide list would hold: a task this member assigned
        // before losing `tasks:manage`, and someone's completion. Neither may
        // surface, because that list is never read for them.
        [
          task({ id: 'assigned-by-me', assignee_id: OTHER, created_by: ME }),
          task({
            id: 'someone-done',
            assignee_id: OTHER,
            status: TaskStatus.COMPLETED,
            stored_status: TaskStatus.COMPLETED,
            completed_at: iso(-HOUR),
          }),
        ],
      );

      const view = await service.getActivity(CHAPTER, ME, null);

      expect(taskService.list).toHaveBeenCalledTimes(1);
      expect(taskService.list).toHaveBeenCalledWith(CHAPTER, ME, false, {
        confirmed: false,
      });
      expect(view.needs_you.tasks.map((row) => row.id)).toEqual([
        'sooner',
        'later',
      ]);
      expect(view.needs_you.tasks[0]).toEqual(
        expect.objectContaining({
          assignee_name: 'Me Member',
          created_by_name: 'Other Member',
          confirmed_at: null,
        }),
      );
      expect(view.needs_you.task_confirmations).toEqual([]);
      expect(view.made_by_you.tasks).toEqual([]);
      expect(view.needs_you_count).toBe(2);
    });

    it('keeps an overdue task under needs you', async () => {
      const { service, taskService } = build();
      serveTasks(taskService, [
        task({
          id: 'late',
          due_date: '2026-11-01',
          status: TaskStatus.OVERDUE,
          stored_status: TaskStatus.IN_PROGRESS,
        }),
      ]);

      const view = await service.getActivity(CHAPTER, ME, null);

      expect(view.needs_you.tasks).toEqual([
        expect.objectContaining({
          id: 'late',
          status: TaskStatus.OVERDUE,
          stored_status: TaskStatus.IN_PROGRESS,
        }),
      ]);
    });

    it('gives a tasks:manage holder the completions they can confirm and the tasks they assigned', async () => {
      const { service, taskService } = build([
        SystemPermissions.MEMBERS_VIEW,
        SystemPermissions.TASKS_MANAGE,
      ]);
      const completed = {
        status: TaskStatus.COMPLETED,
        stored_status: TaskStatus.COMPLETED,
      };
      const ownDone = task({
        id: 'own-done',
        completed_at: iso(-HOUR),
        ...completed,
      });
      serveTasks(
        taskService,
        [task({ id: 'own-open' }), ownDone],
        [
          task({
            id: 'to-confirm',
            assignee_id: OTHER,
            created_by: ME,
            completed_at: iso(-HOUR),
            ...completed,
          }),
          // The caller's own completion: the confirm route refuses it.
          ownDone,
          task({
            id: 'confirmed',
            assignee_id: OTHER,
            completed_at: iso(-HOUR),
            confirmed_at: iso(-HOUR / 2),
            ...completed,
          }),
          task({ id: 'someone-elses', assignee_id: OTHER, created_by: OTHER }),
        ],
      );

      const view = await service.getActivity(CHAPTER, ME, null);

      // Two filtered reads, never the chapter's whole history (#4037).
      const waiting = {
        status: TaskStatus.COMPLETED,
        confirmed: false,
        notAssigneeId: ME,
      };
      expect(taskService.list).toHaveBeenCalledWith(CHAPTER, ME, true, {
        ...waiting,
        order: 'longest_waiting',
        limit: 25,
      });
      expect(taskService.count).toHaveBeenCalledWith(
        CHAPTER,
        ME,
        true,
        waiting,
      );
      expect(taskService.list).toHaveBeenCalledWith(CHAPTER, ME, true, {
        createdBy: ME,
        limit: 25,
      });
      // Every chapter-wide read is narrowed and capped.
      for (const [, , isAdmin, options] of taskService.list.mock.calls) {
        if (isAdmin) expect(options).toHaveProperty('limit', 25);
      }
      expect(view.needs_you.task_confirmations.map((row) => row.id)).toEqual([
        'to-confirm',
      ]);
      expect(view.made_by_you.tasks.map((row) => row.id)).toEqual([
        'to-confirm',
      ]);
      // The caller's own open task comes from the assignee read, not the
      // chapter-wide one, and the count holds both kinds.
      expect(view.needs_you.tasks.map((row) => row.id)).toEqual(['own-open']);
      expect(view.needs_you_count).toBe(2);
    });

    it('reads no tasks while the Tasks module is off', async () => {
      const { service, taskService } = build();

      await service.getActivity(CHAPTER, ME, { tasks: false });

      expect(taskService.list).not.toHaveBeenCalled();
    });
  });

  describe('hours approvals', () => {
    const entry = (id: string, userId: string, createdAt: string) => ({
      id,
      chapter_id: CHAPTER,
      user_id: userId,
      date: '2026-11-08',
      duration_minutes: 90,
      description: 'Food bank',
      status: 'PENDING',
      created_at: createdAt,
    });

    it('is not read for a member who cannot approve', async () => {
      const { service, serviceEntryService } = build();

      const view = await service.getActivity(CHAPTER, ME, null);

      expect(serviceEntryService.findByChapterFiltered).not.toHaveBeenCalled();
      expect(view.needs_you.hours_approvals).toEqual([]);
    });

    it('gives an approver the pending entries, oldest first, without their own', async () => {
      const { service, serviceEntryService } = build([
        SystemPermissions.MEMBERS_VIEW,
        SystemPermissions.SERVICE_APPROVE,
      ]);
      serviceEntryService.findByChapterFiltered.mockResolvedValue([
        entry('newer', OTHER, iso(-HOUR)),
        entry('mine', ME, iso(-3 * HOUR)),
        entry('older', OTHER, iso(-5 * HOUR)),
      ]);

      const view = await service.getActivity(CHAPTER, ME, null);

      expect(serviceEntryService.findByChapterFiltered).toHaveBeenCalledWith(
        CHAPTER,
        { status: 'PENDING' },
      );
      expect(view.needs_you.hours_approvals).toEqual([
        expect.objectContaining({ id: 'older', member_name: 'Other Member' }),
        expect.objectContaining({ id: 'newer' }),
      ]);
      expect(view.needs_you_count).toBe(2);
    });

    it('is not read while the Hours module is off', async () => {
      const { service, serviceEntryService } = build([
        SystemPermissions.SERVICE_APPROVE,
      ]);

      await service.getActivity(CHAPTER, ME, { hours: false });

      expect(serviceEntryService.findByChapterFiltered).not.toHaveBeenCalled();
    });
  });

  describe('coming up', () => {
    it('reads events as the caller, so one that leaves them out is never listed', async () => {
      const { service, eventService } = build();

      await service.getActivity(CHAPTER, ME, null);

      // And only the window: from the start of the week (Sunday, here two
      // days back, which reaches past the day of check-in grace) to 14 days
      // ahead. One read serves Coming up and the week.
      expect(eventService.findByChapter).toHaveBeenCalledTimes(1);
      expect(eventService.findByChapter).toHaveBeenCalledWith(CHAPTER, ME, {
        endsAfter: WEEK_START,
        startsBefore: iso(14 * 24 * HOUR),
      });
    });

    it('lists events inside the window, soonest first, and drops past and far-off ones', async () => {
      const { service, eventService, attendanceRepo } = build();
      eventService.findByChapter.mockResolvedValue([
        event({
          id: 'next-week',
          start_time: iso(7 * 24 * HOUR),
          end_time: iso(7 * 24 * HOUR + HOUR),
        }),
        event({
          id: 'tomorrow',
          start_time: iso(24 * HOUR),
          end_time: iso(25 * HOUR),
        }),
        event({
          id: 'last-week',
          start_time: iso(-7 * 24 * HOUR),
          end_time: iso(-7 * 24 * HOUR + HOUR),
        }),
        event({
          id: 'next-month',
          start_time: iso(30 * 24 * HOUR),
          end_time: iso(30 * 24 * HOUR + HOUR),
        }),
      ]);

      const view = await service.getActivity(CHAPTER, ME, null);

      expect(view.coming_up.map((row) => row.id)).toEqual([
        'tomorrow',
        'next-week',
      ]);
      expect(view.coming_up[0]).toEqual(
        expect.objectContaining({ check_in_open: false, checked_in: null }),
      );
      // Attendance is read only for an event whose check-in is open.
      expect(attendanceRepo.findByEventAndUser).not.toHaveBeenCalled();
      expect(view.needs_you_count).toBe(0);
    });

    it('counts an event whose check-in is open until the caller has checked in', async () => {
      const { service, eventService, attendanceRepo } = build();
      eventService.findByChapter.mockResolvedValue([
        // Started half an hour ago, still running.
        event({
          id: 'now',
          start_time: iso(-HOUR / 2),
          end_time: iso(HOUR / 2),
        }),
      ]);

      const before = await service.getActivity(CHAPTER, ME, null);
      attendanceRepo.findByEventAndUser.mockResolvedValue({ id: 'att-1' });
      const after = await service.getActivity(CHAPTER, ME, null);

      expect(before.coming_up).toEqual([
        expect.objectContaining({
          id: 'now',
          check_in_open: true,
          checked_in: false,
        }),
      ]);
      expect(before.needs_you_count).toBe(1);
      expect(after.coming_up[0].checked_in).toBe(true);
      expect(after.needs_you_count).toBe(0);
    });

    it('says which events need the caller’s location, and sends no zone', async () => {
      const { service, eventService } = build();
      eventService.findByChapter.mockResolvedValue([
        event({ id: 'plain', check_in_zone: null }),
        event({
          id: 'zoned',
          start_time: iso(50 * HOUR),
          end_time: iso(51 * HOUR),
          check_in_zone: [
            { lat: 1, lng: 1 },
            { lat: 1, lng: 2 },
            { lat: 2, lng: 2 },
          ],
          check_in_zone_name: 'Great Hall',
        }),
      ]);

      const view = await service.getActivity(CHAPTER, ME, null);

      expect(
        view.coming_up.map((row) => [row.id, row.check_in_needs_location]),
      ).toEqual([
        ['plain', false],
        ['zoned', true],
      ]);
      expect(view.coming_up[1]).not.toHaveProperty('check_in_zone');
      expect(view.coming_up[1]).not.toHaveProperty('check_in_zone_name');
    });

    it('says when check-in needs the officer’s code, reading screens only while check-in is open', async () => {
      const { service, eventService } = build();
      eventService.findByChapter.mockResolvedValue([
        event({
          id: 'now',
          start_time: iso(-HOUR / 2),
          end_time: iso(HOUR / 2),
        }),
        event({
          id: 'later',
          start_time: iso(50 * HOUR),
          end_time: iso(51 * HOUR),
        }),
      ]);
      eventService.checkInNeedsCode.mockResolvedValue(true);

      const view = await service.getActivity(CHAPTER, ME, null);

      expect(
        view.coming_up.map((row) => [row.id, row.check_in_needs_code]),
      ).toEqual([
        ['now', true],
        ['later', false],
      ]);
      expect(eventService.checkInNeedsCode).toHaveBeenCalledTimes(1);
      expect(eventService.checkInNeedsCode).toHaveBeenCalledWith(
        'now',
        CHAPTER,
      );
    });

    it('says the code is not needed when the screens cannot be read', async () => {
      const { service, eventService } = build();
      eventService.findByChapter.mockResolvedValue([
        event({
          id: 'now',
          start_time: iso(-HOUR / 2),
          end_time: iso(HOUR / 2),
        }),
      ]);
      eventService.checkInNeedsCode.mockRejectedValue(new Error('db down'));
      const reported = jest.spyOn(caughtFailure, 'reportCaughtFailure');

      const view = await service.getActivity(CHAPTER, ME, null);

      expect(view.coming_up[0].check_in_needs_code).toBe(false);
      expect(reported).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({ site: 'activity-check-in-screen-read' }),
      );
      reported.mockRestore();
    });

    it('still lists an open event, as needing the caller, when its attendance cannot be read', async () => {
      const { service, eventService, attendanceRepo } = build();
      eventService.findByChapter.mockResolvedValue([
        event({
          id: 'now',
          start_time: iso(-HOUR / 2),
          end_time: iso(HOUR / 2),
        }),
      ]);
      attendanceRepo.findByEventAndUser.mockRejectedValue(new Error('db down'));
      const reported = jest.spyOn(caughtFailure, 'reportCaughtFailure');

      const view = await service.getActivity(CHAPTER, ME, null);

      expect(view.coming_up[0]).toEqual(
        expect.objectContaining({ check_in_open: true, checked_in: null }),
      );
      expect(view.needs_you_count).toBe(1);
      expect(view.unavailable).toEqual([]);
      expect(reported).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({
          level: 'warning',
          site: 'activity-attendance-read',
        }),
      );
      reported.mockRestore();
    });
  });

  describe('coming up: the member’s own answer', () => {
    const openNow = (overrides: Partial<Event> = {}) =>
      event({
        id: 'now',
        start_time: iso(-HOUR / 2),
        end_time: iso(HOUR / 2),
        ...overrides,
      });

    it('reads no events while the Events module is off', async () => {
      const { service, eventService } = build();
      eventService.findByChapter.mockResolvedValue([openNow()]);

      const view = await service.getActivity(CHAPTER, ME, { events: false });

      expect(eventService.findByChapter).not.toHaveBeenCalled();
      expect(view.coming_up).toEqual([]);
      expect(view.needs_you_count).toBe(0);
    });

    it('does not offer an alumnus a check-in the event’s default would refuse', async () => {
      const { service, eventService, rbacService, attendanceRepo } = build();
      rbacService.isAlumni.mockResolvedValue(true);
      eventService.findByChapter.mockResolvedValue([openNow()]);

      const view = await service.getActivity(CHAPTER, ME, null);

      expect(view.coming_up).toEqual([
        expect.objectContaining({
          id: 'now',
          attendance: 'optional',
          check_in_open: false,
          checked_in: null,
        }),
      ]);
      expect(view.needs_you_count).toBe(0);
      expect(attendanceRepo.findByEventAndUser).not.toHaveBeenCalled();
    });

    it('holds an alumnus to an event that lists a role of theirs', async () => {
      const { service, eventService, rbacService } = build();
      rbacService.isAlumni.mockResolvedValue(true);
      eventService.findByChapter.mockResolvedValue([
        openNow({ required_role_ids: ['role-member'] }),
      ]);

      const view = await service.getActivity(CHAPTER, ME, null);

      expect(view.coming_up[0]).toEqual(
        expect.objectContaining({
          attendance: 'required',
          check_in_open: true,
        }),
      );
      expect(view.needs_you_count).toBe(1);
    });

    it('leaves out an event that does not invite the caller, even when the list read returns it', async () => {
      // `EventService.findByChapter` returns every event to an `events:update`
      // holder so they can edit it. That is not an invitation.
      const { service, eventService } = build([
        SystemPermissions.MEMBERS_VIEW,
        SystemPermissions.EVENTS_UPDATE,
      ]);
      eventService.findByChapter.mockResolvedValue([
        openNow({
          id: 'not-mine',
          required_role_ids: ['role-other'],
          others_invited: false,
        }),
        openNow({ id: 'mine' }),
      ]);

      const view = await service.getActivity(CHAPTER, ME, null);

      expect(view.coming_up.map((row) => row.id)).toEqual(['mine']);
      expect(view.needs_you_count).toBe(1);
    });

    it('answers with the member’s own attendance, not the event’s default', async () => {
      const { service, eventService } = build();
      eventService.findByChapter.mockResolvedValue([
        event({ id: 'optional-for-me', optional_role_ids: ['role-member'] }),
        event({
          id: 'required-for-me',
          is_mandatory: false,
          required_role_ids: ['role-member'],
          start_time: iso(72 * HOUR),
          end_time: iso(73 * HOUR),
        }),
      ]);

      const view = await service.getActivity(CHAPTER, ME, null);

      expect(view.coming_up.map((row) => [row.id, row.attendance])).toEqual([
        ['optional-for-me', 'optional'],
        ['required-for-me', 'required'],
      ]);
    });

    it('keeps at most ten events', async () => {
      const { service, eventService } = build();
      eventService.findByChapter.mockResolvedValue(
        Array.from({ length: 12 }, (_, index) =>
          event({
            id: `event-${index}`,
            start_time: iso((index + 1) * HOUR),
            end_time: iso((index + 2) * HOUR),
          }),
        ),
      );

      const view = await service.getActivity(CHAPTER, ME, null);

      expect(view.coming_up).toHaveLength(10);
      expect(view.coming_up[0].id).toBe('event-0');
    });
  });

  describe('events made by you', () => {
    it('reads the caller’s own events whose check-in has not closed, through the visibility-checked read', async () => {
      const { service, eventService } = build();

      await service.getActivity(CHAPTER, ME, null);

      // The check-in grace behind now: an event that ended ten minutes ago
      // is still in Coming up, so it stays here too.
      expect(eventService.findCreatedBy).toHaveBeenCalledWith(
        CHAPTER,
        ME,
        iso(-15 * 60 * 1000),
        200,
      );
    });

    it('keeps an event that has just ended while its check-in is still open', async () => {
      const { service, eventService } = build();
      eventService.findCreatedBy.mockResolvedValue([
        event({
          id: 'just-ended',
          start_time: iso(-HOUR),
          end_time: iso(-5 * 60 * 1000),
          created_by: ME,
        }),
      ]);

      const view = await service.getActivity(CHAPTER, ME, null);

      expect(view.made_by_you.events.map((row) => row.id)).toEqual([
        'just-ended',
      ]);
    });

    it('reads the caller’s member row and alumni status once for both event sections', async () => {
      const { service, eventService, memberRepo, rbacService } = build();
      const mine = event({ id: 'mine', created_by: ME });
      eventService.findByChapter.mockResolvedValue([mine]);
      eventService.findCreatedBy.mockResolvedValue([mine]);

      const view = await service.getActivity(CHAPTER, ME, null);

      expect(view.coming_up).toHaveLength(1);
      expect(view.made_by_you.events).toHaveLength(1);
      expect(memberRepo.findByUserAndChapter).toHaveBeenCalledTimes(1);
      expect(rbacService.isAlumni).toHaveBeenCalledTimes(1);
    });

    it('lists them soonest first, one row per recurring series, and counts none of them as waiting', async () => {
      const { service, eventService } = build();
      eventService.findCreatedBy.mockResolvedValue([
        event({
          id: 'head',
          start_time: iso(24 * HOUR),
          end_time: iso(25 * HOUR),
          created_by: ME,
        }),
        event({
          id: 'one-off',
          start_time: iso(30 * HOUR),
          end_time: iso(31 * HOUR),
          created_by: ME,
        }),
        event({
          id: 'meeting-2',
          parent_event_id: 'head',
          start_time: iso(8 * 24 * HOUR),
          end_time: iso(8 * 24 * HOUR + HOUR),
          created_by: ME,
        }),
        // Further out than "coming up" looks, and still listed.
        event({
          id: 'next-month',
          start_time: iso(30 * 24 * HOUR),
          end_time: iso(30 * 24 * HOUR + HOUR),
          created_by: ME,
        }),
      ]);

      const view = await service.getActivity(CHAPTER, ME, null);

      expect(view.made_by_you.events.map((row) => row.id)).toEqual([
        'head',
        'one-off',
        'next-month',
      ]);
      expect(view.needs_you_count).toBe(0);
    });

    it('leaves out the caller’s event when it does not invite them, since its card would offer a check-in the server refuses', async () => {
      const { service, eventService, attendanceRepo } = build();
      eventService.findCreatedBy.mockResolvedValue([
        event({
          id: 'not-for-me',
          start_time: iso(-HOUR / 2),
          end_time: iso(HOUR / 2),
          required_role_ids: ['role-officers'],
          others_invited: false,
          created_by: ME,
        }),
      ]);

      const view = await service.getActivity(CHAPTER, ME, null);

      expect(view.made_by_you.events).toEqual([]);
      expect(attendanceRepo.findByEventAndUser).not.toHaveBeenCalled();
      expect(view.needs_you_count).toBe(0);
    });

    it('reads none while the Events module is off', async () => {
      const { service, eventService } = build();

      const view = await service.getActivity(CHAPTER, ME, { events: false });

      expect(eventService.findCreatedBy).not.toHaveBeenCalled();
      expect(view.made_by_you.events).toEqual([]);
    });

    it('serves the rest of the page when the read fails, and names it', async () => {
      const { service, eventService } = build();
      eventService.findCreatedBy.mockRejectedValue(new Error('db down'));
      const reported = jest
        .spyOn(caughtFailure, 'reportCaughtFailure')
        .mockImplementation(() => undefined);

      const view = await service.getActivity(CHAPTER, ME, null);

      expect(view.unavailable).toEqual(['made_events']);
      expect(view.made_by_you.events).toEqual([]);
      reported.mockRestore();
    });
  });

  describe('polls: order, deadlines and caps', () => {
    const payloadOf = (extra: Record<string, unknown>) => ({
      ...pollCard({ id: 'x' }).payload,
      ...extra,
    });

    it('orders polls soonest closing first, one with no deadline last', async () => {
      const { service, messageRepo } = build();
      servePolls(messageRepo, [
        pollCard({
          id: 'in-3-days',
          payload: payloadOf({ closes_at: iso(72 * HOUR) }),
        }),
        // No usable deadline: chat draws it open and the API takes votes on it.
        pollCard({
          id: 'no-deadline',
          payload: payloadOf({ closes_at: 'soon' }),
        }),
        pollCard({
          id: 'in-1-hour',
          payload: payloadOf({ closes_at: iso(HOUR) }),
        }),
      ]);

      const view = await service.getActivity(CHAPTER, ME, null);

      expect(view.needs_you.polls.map((poll) => poll.message_id)).toEqual([
        'in-1-hour',
        'in-3-days',
        'no-deadline',
      ]);
      expect(view.needs_you.polls[2]).toEqual(
        expect.objectContaining({ closes_at: null, is_closed: false }),
      );
    });

    it('leaves out a card chat cannot draw: fewer than two options with an id and a label', async () => {
      const { service, messageRepo } = build();
      servePolls(messageRepo, [
        pollCard({ id: 'no-options', payload: payloadOf({ options: [] }) }),
        pollCard({
          id: 'one-usable',
          payload: payloadOf({
            options: [{ id: 'a', label: 'Only' }, { id: 'b' }],
          }),
        }),
      ]);

      const view = await service.getActivity(CHAPTER, ME, null);

      expect(view.needs_you.polls).toEqual([]);
    });

    it('caps the poll and confirmation lists at 25 and counts all of them', async () => {
      const { service, messageRepo, taskService } = build([
        SystemPermissions.MEMBERS_VIEW,
        SystemPermissions.TASKS_MANAGE,
      ]);
      servePolls(
        messageRepo,
        Array.from({ length: 30 }, (_, index) =>
          pollCard({ id: `poll-${index}` }),
        ),
      );
      serveTasks(
        taskService,
        [],
        Array.from({ length: 27 }, (_, index) =>
          task({
            id: `done-${index}`,
            assignee_id: OTHER,
            status: TaskStatus.COMPLETED,
            stored_status: TaskStatus.COMPLETED,
            completed_at: iso(-HOUR),
          }),
        ),
      );

      const view = await service.getActivity(CHAPTER, ME, null);

      expect(view.needs_you.polls).toHaveLength(25);
      expect(view.needs_you.task_confirmations).toHaveLength(25);
      expect(view.needs_you_count).toBe(57);
    });
  });

  describe('unread', () => {
    // Two days after dots shipped, so rows can fall either side of the floor.
    const LATER = new Date('2026-11-13T18:00:00.000Z');
    const at = (offsetMs: number) =>
      new Date(LATER.getTime() + offsetMs).toISOString();
    const MANAGER = [
      SystemPermissions.MEMBERS_VIEW,
      SystemPermissions.TASKS_MANAGE,
      SystemPermissions.SERVICE_APPROVE,
    ];
    const link = (overrides: Partial<ActivityLink>): ActivityLink => ({
      id: 'link-1',
      url: 'https://forms.gle/abc',
      host: 'forms.gle',
      title: null,
      message_id: 'link-msg-1',
      thread_root_id: null,
      channel_id: READABLE,
      channel_name: 'general',
      channel_type: 'PUBLIC',
      posted_by: OTHER,
      posted_by_name: 'Other Member',
      posted_at: at(-HOUR),
      unread: false,
      ...overrides,
    });
    const upcoming = (overrides: Partial<Event>) =>
      event({
        start_time: at(48 * HOUR),
        end_time: at(49 * HOUR),
        created_at: at(-HOUR),
        ...overrides,
      });

    // When a dot-drawing client first opened Activity for the caller.
    const STARTED = at(-48 * HOUR);

    beforeEach(() => {
      jest.setSystemTime(LATER);
    });

    /** `build`, with the caller's dots begun at `STARTED`. */
    function buildStarted(permissions?: string[]) {
      const built = build(permissions);
      built.readRepo.findUnreadStart.mockResolvedValue(STARTED);
      return built;
    }

    /** Every section with one row that appeared an hour ago. */
    function buildEverySection() {
      const built = buildStarted(MANAGER);
      serveTasks(
        built.taskService,
        [task({ id: 'mine', created_at: at(-HOUR) })],
        [
          task({
            id: 'to-confirm',
            assignee_id: OTHER,
            created_by: ME,
            status: TaskStatus.COMPLETED,
            stored_status: TaskStatus.COMPLETED,
            created_at: at(-72 * HOUR),
            completed_at: at(-HOUR),
          }),
        ],
      );
      built.serviceEntryService.findByChapterFiltered.mockResolvedValue([
        {
          id: 'entry-1',
          chapter_id: CHAPTER,
          user_id: OTHER,
          date: '2026-11-12',
          duration_minutes: 60,
          description: 'Food bank',
          status: 'PENDING',
          created_at: at(-HOUR),
        },
      ]);
      servePolls(built.messageRepo, [
        pollCard({
          id: 'poll-1',
          created_at: at(-HOUR),
          payload: {
            question: 'Formal venue?',
            options: [
              { id: 'a', label: 'Downtown' },
              { id: 'b', label: 'Campus' },
            ],
            closes_at: at(24 * HOUR),
          },
        }),
      ]);
      built.eventService.findByChapter.mockResolvedValue([
        upcoming({ id: 'event-1' }),
      ]);
      built.linkService.listFor.mockResolvedValue([link({})]);
      return built;
    }

    it('marks every row that waits on the caller and that they have not opened', async () => {
      const { service, readRepo } = buildEverySection();

      const view = await service.getActivity(CHAPTER, ME, null);

      expect(view.unread_since).toBe(STARTED);
      expect(view.needs_you.tasks.map((row) => row.unread)).toEqual([true]);
      expect(
        view.needs_you.task_confirmations.map((row) => row.unread),
      ).toEqual([true]);
      expect(view.needs_you.hours_approvals.map((row) => row.unread)).toEqual([
        true,
      ]);
      expect(view.needs_you.polls.map((row) => row.unread)).toEqual([true]);
      expect(view.coming_up.map((row) => row.unread)).toEqual([true]);
      expect(view.links.map((row) => row.unread)).toEqual([true]);
      // One read for the whole page, of the caller's own opens.
      expect(readRepo.findReads).toHaveBeenCalledTimes(1);
      expect(readRepo.findReads).toHaveBeenCalledWith(
        CHAPTER,
        ME,
        expect.arrayContaining([
          'mine',
          'to-confirm',
          'entry-1',
          'poll-1',
          'event-1',
          'link-1',
        ]),
      );
    });

    it('clears a row the caller opened after it appeared, by kind and id', async () => {
      const { service, readRepo } = buildEverySection();
      readRepo.findReads.mockResolvedValue([
        { kind: 'task', item_id: 'mine', read_at: at(-30 * 60 * 1000) },
        { kind: 'hours_entry', item_id: 'entry-1', read_at: at(-HOUR) },
        { kind: 'poll', item_id: 'poll-1', read_at: at(-30 * 60 * 1000) },
        { kind: 'event', item_id: 'event-1', read_at: at(-30 * 60 * 1000) },
        // The right id under the wrong kind is not a read of this link.
        { kind: 'poll', item_id: 'link-1', read_at: at(-30 * 60 * 1000) },
      ]);

      const view = await service.getActivity(CHAPTER, ME, null);

      expect(view.needs_you.tasks[0].unread).toBe(false);
      // Opened at the very moment it was submitted still counts as seen.
      expect(view.needs_you.hours_approvals[0].unread).toBe(false);
      expect(view.needs_you.polls[0].unread).toBe(false);
      expect(view.coming_up[0].unread).toBe(false);
      expect(view.links[0].unread).toBe(true);
    });

    it('dots a confirmation again when the task was completed after the caller last opened it', async () => {
      const { service, readRepo } = buildEverySection();
      // Opened the day it was assigned, two days before it was completed.
      readRepo.findReads.mockResolvedValue([
        { kind: 'task', item_id: 'to-confirm', read_at: at(-70 * HOUR) },
      ]);

      const view = await service.getActivity(CHAPTER, ME, null);

      expect(view.needs_you.task_confirmations[0].unread).toBe(true);
    });

    it('dots nothing, and reads no opens, before a client begins the caller’s dots', async () => {
      const { service, readRepo, taskService, linkService } = build();
      serveTasks(taskService, [task({ id: 'mine', created_at: at(-HOUR) })]);
      linkService.listFor.mockResolvedValue([link({})]);

      const view = await service.getActivity(CHAPTER, ME, null);

      expect(view.unread_since).toBeNull();
      expect(view.needs_you.tasks[0].unread).toBe(false);
      expect(view.links[0].unread).toBe(false);
      expect(readRepo.findUnreadStart).toHaveBeenCalledWith(CHAPTER, ME);
      expect(readRepo.findReads).not.toHaveBeenCalled();
    });

    it('never dots what appeared before the caller’s dots began, and does not read for it', async () => {
      const { service, readRepo, taskService, linkService } = buildStarted();
      const before = new Date(new Date(STARTED).getTime() - 1).toISOString();
      serveTasks(taskService, [task({ id: 'old', created_at: before })]);
      linkService.listFor.mockResolvedValue([link({ posted_at: before })]);

      const view = await service.getActivity(CHAPTER, ME, null);

      expect(view.needs_you.tasks[0].unread).toBe(false);
      expect(view.links[0].unread).toBe(false);
      expect(readRepo.findReads).not.toHaveBeenCalled();
    });

    it('dots a task again when an officer sent it back after the caller last opened it', async () => {
      const { service, readRepo, taskService } = buildStarted();
      serveTasks(taskService, [
        task({
          id: 'sent-back',
          created_at: at(-24 * HOUR),
          sent_back_at: at(-HOUR),
        }),
        // Assigned to themselves, then completed and sent back by an officer:
        // the send-back is someone else's, so it waits on them.
        task({
          id: 'own-sent-back',
          created_by: ME,
          created_at: at(-24 * HOUR),
          sent_back_at: at(-HOUR),
        }),
      ]);
      // Both opened the day they were made, before they were sent back.
      readRepo.findReads.mockResolvedValue([
        { kind: 'task', item_id: 'sent-back', read_at: at(-20 * HOUR) },
        { kind: 'task', item_id: 'own-sent-back', read_at: at(-20 * HOUR) },
      ]);

      const view = await service.getActivity(CHAPTER, ME, null);

      expect(
        view.needs_you.tasks.map((row) => [
          row.id,
          row.unread,
          row.sent_back_at,
        ]),
      ).toEqual([
        ['sent-back', true, at(-HOUR)],
        ['own-sent-back', true, at(-HOUR)],
      ]);
    });

    it('never dots what the caller made: a task for themselves, their own event, anything in Made by you', async () => {
      const { service, readRepo, taskService, eventService } =
        buildStarted(MANAGER);
      const selfAssigned = task({
        id: 'self',
        created_by: ME,
        created_at: at(-HOUR),
      });
      // A task the caller assigned to themselves sits in both lists.
      serveTasks(taskService, [selfAssigned], [selfAssigned]);
      eventService.findByChapter.mockResolvedValue([
        upcoming({ id: 'mine', created_by: ME }),
      ]);
      eventService.findCreatedBy.mockResolvedValue([
        upcoming({ id: 'mine', created_by: ME }),
      ]);

      const view = await service.getActivity(CHAPTER, ME, null);

      expect(view.needs_you.tasks[0].unread).toBe(false);
      expect(view.coming_up[0]).toMatchObject({
        created_by: ME,
        unread: false,
      });
      expect(view.made_by_you.tasks.map((row) => row.unread)).toEqual([false]);
      expect(view.made_by_you.events.map((row) => row.unread)).toEqual([false]);
      expect(readRepo.findReads).not.toHaveBeenCalled();
    });

    it('keeps Made by you undotted when the same task is unread in Needs you', async () => {
      const { service, taskService } = buildStarted(MANAGER);
      // A completion waiting on the caller's confirm, for a task they
      // assigned: one task, in Needs you and in Made by you.
      const completed = task({
        id: 'shared',
        assignee_id: OTHER,
        created_by: ME,
        status: TaskStatus.COMPLETED,
        stored_status: TaskStatus.COMPLETED,
        created_at: at(-72 * HOUR),
        completed_at: at(-HOUR),
      });
      serveTasks(taskService, [], [completed]);

      const view = await service.getActivity(CHAPTER, ME, null);

      expect(view.needs_you.task_confirmations[0].unread).toBe(true);
      expect(view.made_by_you.tasks.map((row) => row.unread)).toEqual([false]);
    });

    it('serves every row as read, and reports it, when the reads cannot be loaded', async () => {
      const report = jest
        .spyOn(caughtFailure, 'reportCaughtFailure')
        .mockImplementation(() => undefined);
      const { service, readRepo } = buildEverySection();
      readRepo.findReads.mockRejectedValue(new Error('db down'));

      const view = await service.getActivity(CHAPTER, ME, null);

      expect(view.unavailable).toEqual([]);
      // Served as if the dots hadn't begun, so a client doesn't take the
      // missing marks for a member who has seen everything.
      expect(view.unread_since).toBeNull();
      expect(view.needs_you.tasks[0].unread).toBe(false);
      expect(view.links[0].unread).toBe(false);
      expect(report).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({
          level: 'warning',
          site: 'activity-unread',
        }),
      );
      report.mockRestore();
    });

    it('serves every row as read when the caller’s start cannot be loaded', async () => {
      const report = jest
        .spyOn(caughtFailure, 'reportCaughtFailure')
        .mockImplementation(() => undefined);
      const { service, readRepo } = buildEverySection();
      readRepo.findUnreadStart.mockRejectedValue(new Error('db down'));

      const view = await service.getActivity(CHAPTER, ME, null);

      expect(view.unread_since).toBeNull();
      expect(view.needs_you.polls[0].unread).toBe(false);
      expect(readRepo.findReads).not.toHaveBeenCalled();
      expect(report).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({ site: 'activity-unread' }),
      );
      report.mockRestore();
    });

    it('begins the caller’s dots now', async () => {
      const { service, readRepo } = build();

      await service.startUnread(CHAPTER, ME);

      expect(readRepo.startUnread).toHaveBeenCalledWith(
        CHAPTER,
        ME,
        LATER.toISOString(),
      );
    });

    it('records the caller’s opens now, sending a repeated item once', async () => {
      const { service, readRepo } = build();

      await service.markRead(CHAPTER, ME, [
        { kind: 'poll', item_id: 'poll-1' },
        { kind: 'poll', item_id: 'poll-1' },
        { kind: 'task', item_id: 'poll-1' },
      ]);

      expect(readRepo.markRead).toHaveBeenCalledWith(
        CHAPTER,
        ME,
        [
          { kind: 'poll', item_id: 'poll-1' },
          { kind: 'task', item_id: 'poll-1' },
        ],
        LATER.toISOString(),
      );
    });
  });

  it('serves the other sections when one fails, and names the one that did', async () => {
    const { service, taskService, messageRepo } = build();
    taskService.list.mockRejectedValue(new Error('db down'));
    servePolls(messageRepo, [pollCard({ id: 'poll-1' })]);

    const view = await service.getActivity(CHAPTER, ME, null);

    expect(view.unavailable).toEqual(['tasks']);
    expect(view.needs_you.tasks).toEqual([]);
    expect(view.needs_you.polls).toHaveLength(1);
  });

  it('counts every completion waiting on a confirm, past the 25 it reads (#4037)', async () => {
    const { service, taskService } = build([
      SystemPermissions.MEMBERS_VIEW,
      SystemPermissions.TASKS_MANAGE,
    ]);
    serveTasks(
      taskService,
      [],
      Array.from({ length: 40 }, (_, index) =>
        task({
          id: `done-${index}`,
          assignee_id: OTHER,
          status: TaskStatus.COMPLETED,
          stored_status: TaskStatus.COMPLETED,
          completed_at: iso(-HOUR * (index + 1)),
        }),
      ),
    );

    const view = await service.getActivity(CHAPTER, ME, null);

    expect(view.needs_you.task_confirmations).toHaveLength(25);
    // Longest waiting first.
    expect(view.needs_you.task_confirmations[0].id).toBe('done-39');
    expect(view.needs_you_count).toBe(40);
  });

  it('caps each list at 25 rows and counts what waits before the cap', async () => {
    const { service, taskService } = build();
    taskService.list.mockResolvedValue(
      Array.from({ length: 30 }, (_, index) => task({ id: `task-${index}` })),
    );

    const view = await service.getActivity(CHAPTER, ME, null);

    expect(view.needs_you.tasks).toHaveLength(25);
    expect(view.needs_you_count).toBe(30);
  });

  describe('week', () => {
    const attended = (eventId: string, status: string) => ({
      event_id: eventId,
      user_id: ME,
      status,
    });

    it('counts from last Sunday at midnight UTC when the client names no week', async () => {
      const { service } = build();

      const view = await service.getActivity(CHAPTER, ME, null);

      expect(view.week).toEqual({
        start: WEEK_START,
        end: '2026-11-15T00:00:00.000Z',
        events: { done: 0, total: 0 },
        tasks: { done: 0, total: 0 },
        polls: { done: 0, total: 0 },
        cards: { done: 0, total: 0 },
        unavailable: [],
      });
    });

    it('counts from the week the client names, and falls back when it names another week', async () => {
      const { service, taskService } = build();
      const localSunday = new Date('2026-11-08T05:00:00.000Z');

      const named = await service.getActivity(CHAPTER, ME, null, {
        weekStart: localSunday,
      });
      // A caller that skipped the route's check can't widen the read.
      const wide = await service.getActivity(CHAPTER, ME, null, {
        weekStart: new Date('2025-11-08T05:00:00.000Z'),
      });

      expect(named.week.start).toBe('2026-11-08T05:00:00.000Z');
      expect(named.week.end).toBe('2026-11-15T05:00:00.000Z');
      expect(taskService.count).toHaveBeenCalledWith(CHAPTER, ME, false, {
        status: TaskStatus.COMPLETED,
        completedSince: '2026-11-08T05:00:00.000Z',
      });
      expect(wide.week.start).toBe(WEEK_START);
    });

    it('counts the caller’s tasks done this week and those still due in it, overdue included', async () => {
      const { service, taskService } = build();
      const done = (id: string, completedAt: string, confirmed = false) =>
        task({
          id,
          status: TaskStatus.COMPLETED,
          stored_status: TaskStatus.COMPLETED,
          completed_at: completedAt,
          confirmed_at: confirmed ? completedAt : null,
        });
      serveTasks(taskService, [
        // Done this week: one waiting on a confirm, one already confirmed.
        done('done-waiting', iso(-HOUR)),
        done('done-confirmed', iso(-2 * HOUR), true),
        // Done before the week began.
        done('done-last-week', iso(-10 * 24 * HOUR), true),
        task({ id: 'overdue', due_date: '2026-11-01' }),
        // Saturday, the week's last day, by date and by time.
        task({ id: 'saturday', due_date: '2026-11-14' }),
        task({
          id: 'saturday-night',
          due_date: '2026-11-14',
          due_at: '2026-11-14T23:30:00.000Z',
        }),
        // Next week's.
        task({ id: 'next-sunday', due_date: '2026-11-15' }),
        task({ id: 'later', due_date: '2026-11-20' }),
      ]);

      const view = await service.getActivity(CHAPTER, ME, null);

      expect(view.week.tasks).toEqual({ done: 2, total: 5 });
      // The list still carries every open task, next week's too.
      expect(view.needs_you.tasks).toHaveLength(5);
    });

    it('counts what is open before the 25-row cap on each list', async () => {
      const { service, taskService, messageRepo } = build();
      serveTasks(
        taskService,
        Array.from({ length: 30 }, (_, index) =>
          task({ id: `task-${index}`, due_date: '2026-11-12' }),
        ),
      );
      servePolls(
        messageRepo,
        Array.from({ length: 30 }, (_, index) =>
          pollCard({ id: `poll-${index}` }),
        ),
        [],
      );

      const view = await service.getActivity(CHAPTER, ME, null);

      expect(view.needs_you.tasks).toHaveLength(25);
      expect(view.needs_you.polls).toHaveLength(25);
      // The ring is of everything, not of the rows the list carries.
      expect(view.week.tasks).toEqual({ done: 0, total: 30 });
      expect(view.week.polls).toEqual({ done: 0, total: 30 });
    });

    it('keeps the day of check-in grace when the week has just begun', async () => {
      const { service, eventService } = build();
      // Ten past midnight on Sunday: Saturday night's event is before the
      // week, and still inside its check-in grace for Coming up.
      jest.setSystemTime(new Date('2026-11-08T00:10:00.000Z'));

      await service.getActivity(CHAPTER, ME, null);

      expect(eventService.findByChapter).toHaveBeenCalledWith(CHAPTER, ME, {
        endsAfter: '2026-11-07T00:10:00.000Z',
        startsBefore: '2026-11-22T00:10:00.000Z',
      });
    });

    it('counts a vote in the week it was cast, on a poll that has since closed too', async () => {
      const { service, messageRepo, actionRepo } = build();
      const closed = pollCard({ id: 'closed' });
      closed.payload = { ...closed.payload, closes_at: iso(-HOUR) };
      servePolls(
        messageRepo,
        [
          pollCard({ id: 'open-unvoted' }),
          pollCard({ id: 'voted-today' }),
          pollCard({ id: 'voted-last-week' }),
          pollCard({ id: 'cleared' }),
          closed,
        ],
        [pollCard({ id: 'mine', sender_id: ME })],
      );
      const vote = (messageId: string, at: string, picks = ['a']) => ({
        message_id: messageId,
        payload: { option_id: picks },
        created_at: at,
      });
      actionRepo.findActionsOnMessages.mockResolvedValue([
        vote('voted-today', iso(-HOUR)),
        vote('voted-last-week', iso(-9 * 24 * HOUR)),
        // A cleared vote is not a vote: the poll needs them again.
        vote('cleared', iso(-HOUR), []),
        vote('closed', iso(-3 * HOUR)),
        // Their own poll asks nothing of them.
        vote('mine', iso(-HOUR)),
      ]);

      const view = await service.getActivity(CHAPTER, ME, null);

      expect(view.needs_you.polls.map((poll) => poll.message_id)).toEqual([
        'open-unvoted',
        'cleared',
      ]);
      expect(view.week.polls).toEqual({ done: 2, total: 4 });
    });

    it('counts sign-ups and forms answered this week beside the ones still open', async () => {
      const { service, messageRepo, actionRepo, formResponseRepo } = build();
      serveCards(messageRepo, [
        signupCard({ id: 'open-sheet' }),
        signupCard({ id: 'claimed-sheet' }),
        signupCard({ id: 'closed-sheet' }, { closes_at: iso(-HOUR) }),
        signupCard({ id: 'gave-up-sheet' }, { closes_at: iso(-HOUR) }),
        formCard({ id: 'open-form' }),
        formCard({ id: 'answered-form' }),
        formCard({ id: 'old-form' }),
      ]);
      actionRepo.findAllActionsOnMessages.mockResolvedValue([
        {
          message_id: 'claimed-sheet',
          user_id: ME,
          payload: { slot_ids: ['fri'] },
          created_at: iso(-HOUR),
        },
        // Someone else's claim is not the caller's answer.
        {
          message_id: 'open-sheet',
          user_id: OTHER,
          payload: { slot_ids: ['fri'] },
          created_at: iso(-HOUR),
        },
      ]);
      actionRepo.findActionsOnMessages.mockResolvedValue([
        {
          message_id: 'closed-sheet',
          payload: { slot_ids: ['sat'] },
          created_at: iso(-2 * HOUR),
        },
        // Gave every slot back before the sheet closed: not an answer.
        {
          message_id: 'gave-up-sheet',
          payload: { slot_ids: [] },
          created_at: iso(-2 * HOUR),
        },
      ]);
      formResponseRepo.findAnswered.mockResolvedValue([
        { message_id: 'answered-form', created_at: iso(-HOUR) },
        { message_id: 'old-form', created_at: iso(-9 * 24 * HOUR) },
      ]);

      const view = await service.getActivity(CHAPTER, ME, null);

      expect(view.needs_you.cards.map((card) => card.message_id)).toEqual([
        'open-sheet',
        'open-form',
      ]);
      // The closed sheet's claims are read for the caller alone.
      expect(actionRepo.findActionsOnMessages).toHaveBeenCalledWith(
        ['closed-sheet', 'gave-up-sheet'],
        ME,
        'signup',
      );
      expect(view.week.cards).toEqual({ done: 3, total: 5 });
    });

    it('counts the week’s events by what each asks of the caller', async () => {
      const { service, eventService, attendanceRepo } = build();
      const at = (id: string, startOffset: number, overrides = {}) =>
        event({
          id,
          start_time: iso(startOffset),
          end_time: iso(startOffset + HOUR),
          ...overrides,
        });
      eventService.findByChapter.mockResolvedValue([
        at('attended', -24 * HOUR),
        at('late', -30 * HOUR),
        at('excused', -20 * HOUR),
        // Required and missed: it stays, so the week can't close.
        at('missed-required', -26 * HOUR),
        at('skipped-optional', -28 * HOUR, { is_mandatory: false }),
        at('required-ahead', 24 * HOUR),
        at('optional-ahead', 48 * HOUR, { is_mandatory: false }),
        // Leaves the caller out.
        at('not-invited', 30 * HOUR, {
          excluded_role_ids: ['role-member'],
        }),
        // Last week's and next week's.
        at('before-the-week', -70 * HOUR),
        at('after-the-week', 6 * 24 * HOUR),
      ]);
      attendanceRepo.findByUserForEvents.mockResolvedValue([
        attended('attended', 'PRESENT'),
        attended('late', 'LATE'),
        attended('excused', 'EXCUSED'),
        attended('missed-required', 'ABSENT'),
      ]);

      const view = await service.getActivity(CHAPTER, ME, null);

      expect(attendanceRepo.findByUserForEvents).toHaveBeenCalledWith(ME, [
        'attended',
        'late',
        'excused',
        'missed-required',
        'skipped-optional',
        'required-ahead',
        'optional-ahead',
        'not-invited',
      ]);
      // Done: attended, late. Open: missed-required, required-ahead,
      // optional-ahead.
      expect(view.week.events).toEqual({ done: 2, total: 5 });
    });

    it('counts for an alumnus only what they can do: no event the default alone invites them to', async () => {
      const { service, eventService, rbacService, attendanceRepo } = build();
      rbacService.isAlumni.mockResolvedValue(true);
      eventService.findByChapter.mockResolvedValue([
        event({
          id: 'missed',
          start_time: iso(-26 * HOUR),
          end_time: iso(-25 * HOUR),
        }),
        // Still ahead, but check-in refuses them: never theirs to finish.
        event({
          id: 'ahead',
          start_time: iso(24 * HOUR),
          end_time: iso(25 * HOUR),
        }),
        event({
          id: 'optional-ahead',
          start_time: iso(48 * HOUR),
          end_time: iso(49 * HOUR),
          is_mandatory: false,
        }),
        // An officer marked them present at one: that is done.
        event({
          id: 'came',
          start_time: iso(-30 * HOUR),
          end_time: iso(-29 * HOUR),
        }),
        // Their role is named on this one, so it holds them like anyone.
        event({
          id: 'named',
          start_time: iso(30 * HOUR),
          end_time: iso(31 * HOUR),
          required_role_ids: ['role-member'],
        }),
      ]);
      attendanceRepo.findByUserForEvents.mockResolvedValue([
        attended('came', 'PRESENT'),
      ]);

      const view = await service.getActivity(CHAPTER, ME, null);

      expect(view.week.events).toEqual({ done: 1, total: 2 });
    });

    it('holds a member to no required event from before they joined', async () => {
      const { service, eventService, memberRepo } = build();
      // Joined a day ago, after Monday's meeting and before Thursday's.
      memberRepo.findByUserAndChapter.mockResolvedValue({
        user_id: ME,
        role_ids: ['role-member'],
        created_at: iso(-24 * HOUR),
      });
      eventService.findByChapter.mockResolvedValue([
        event({
          id: 'before-joining',
          start_time: iso(-30 * HOUR),
          end_time: iso(-29 * HOUR),
        }),
        event({
          id: 'after-joining',
          start_time: iso(48 * HOUR),
          end_time: iso(49 * HOUR),
        }),
      ]);

      const view = await service.getActivity(CHAPTER, ME, null);

      expect(view.week.events).toEqual({ done: 0, total: 1 });
    });

    it('serves a part null with no name while its module is off', async () => {
      const { service, attendanceRepo } = build();

      const view = await service.getActivity(CHAPTER, ME, {
        events: false,
        tasks: false,
        polls: false,
      });

      expect(view.week).toMatchObject({
        events: null,
        tasks: null,
        polls: null,
        // Cards are chat messages: no module switches them off.
        cards: { done: 0, total: 0 },
        unavailable: [],
      });
      expect(attendanceRepo.findByUserForEvents).not.toHaveBeenCalled();
    });

    it('serves a part that failed null and names it, so it never reads as zero', async () => {
      const { service, taskService, eventService, attendanceRepo } = build();
      taskService.count.mockRejectedValue(new Error('boom'));
      eventService.findByChapter.mockResolvedValue([
        event({ id: 'e', start_time: iso(HOUR), end_time: iso(2 * HOUR) }),
      ]);
      attendanceRepo.findByUserForEvents.mockRejectedValue(new Error('boom'));

      const view = await service.getActivity(CHAPTER, ME, null);

      expect(view.week).toMatchObject({
        events: null,
        tasks: null,
        polls: { done: 0, total: 0 },
        unavailable: ['events', 'tasks'],
      });
      // The list's own events section is a different read and still serves.
      expect(view.coming_up.map((row) => row.id)).toEqual(['e']);
      expect(view.unavailable).toEqual(['tasks']);
    });

    it('serves polls and cards null and named when their read fails', async () => {
      const { service, messageRepo } = build();
      messageRepo.findCardsByChapter.mockRejectedValue(new Error('boom'));

      const view = await service.getActivity(CHAPTER, ME, null);

      // Never { done: 0, total: 0 }: a client would draw a finished week.
      expect(view.week).toMatchObject({
        events: { done: 0, total: 0 },
        tasks: { done: 0, total: 0 },
        polls: null,
        cards: null,
        unavailable: ['polls', 'cards'],
      });
    });
  });
});
