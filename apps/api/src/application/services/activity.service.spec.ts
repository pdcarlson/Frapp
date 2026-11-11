import * as caughtFailure from '../../infrastructure/observability/report-caught-failure';
import { ActivityService } from './activity.service';
import type { ActivityLink } from './activity-link.service';
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
  status: TaskStatus.TODO,
  stored_status: TaskStatus.TODO,
  point_reward: 5,
  points_awarded: false,
  completed_at: null,
  confirmed_at: null,
  sent_back_at: null,
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
  const taskService = { list: jest.fn().mockResolvedValue([]) };
  const serviceEntryService = {
    findByChapterFiltered: jest.fn().mockResolvedValue([]),
  };
  const eventService = {
    findByChapter: jest.fn().mockResolvedValue([]),
    findCreatedBy: jest.fn().mockResolvedValue([]),
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
    findPollCardsByChapter: jest.fn().mockResolvedValue([]),
  };
  const actionRepo = { findActionsOnMessages: jest.fn().mockResolvedValue([]) };
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
  );
  return {
    service,
    readRepo,
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

/** `findPollCardsByChapter` answers the chapter scan and the caller's own list separately. */
function servePolls(
  messageRepo: { findPollCardsByChapter: jest.Mock },
  recent: ChatMessage[],
  own: ChatMessage[] = [],
) {
  messageRepo.findPollCardsByChapter.mockImplementation(
    (_chapterId: string, options: { senderId?: string }) =>
      Promise.resolve(options.senderId ? own : recent),
  );
}

/** `TaskService.list` answers the caller's own tasks and the chapter-wide list separately. */
function serveTasks(
  taskService: { list: jest.Mock },
  own: TaskView[],
  all: TaskView[] = [],
) {
  taskService.list.mockImplementation(
    (_chapterId: string, _userId: string, isAdmin: boolean) =>
      Promise.resolve(isAdmin ? all : own),
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

    it('serves no polls or links, and says so, when the block list cannot be read', async () => {
      const { service, messageRepo, chatBlocks } = build();
      chatBlocks.listBlockedUserIds.mockRejectedValue(new Error('db down'));
      servePolls(messageRepo, [pollCard({ id: 'poll-1' })]);

      const view = await service.getActivity(CHAPTER, ME, null);

      expect(view.needs_you.polls).toEqual([]);
      expect(view.made_by_you.polls).toEqual([]);
      // Links mask by the same block list, so they fail with it rather than
      // list a blocked member's link.
      expect(view.links).toEqual([]);
      expect(view.unavailable).toEqual(['polls', 'links']);
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
      messageRepo.findPollCardsByChapter.mockRejectedValue(
        new Error('db down'),
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
      expect(messageRepo.findPollCardsByChapter).toHaveBeenCalledWith(CHAPTER, {
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
      expect(messageRepo.findPollCardsByChapter).not.toHaveBeenCalled();
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
      expect(taskService.list).toHaveBeenCalledWith(CHAPTER, ME, false);
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

      expect(taskService.list).toHaveBeenCalledWith(CHAPTER, ME, true);
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

      // And only the window: a day behind (the check-in grace) to 14 days ahead.
      expect(eventService.findByChapter).toHaveBeenCalledWith(CHAPTER, ME, {
        endsAfter: iso(-24 * HOUR),
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

  it('caps each list at 25 rows and counts what waits before the cap', async () => {
    const { service, taskService } = build();
    taskService.list.mockResolvedValue(
      Array.from({ length: 30 }, (_, index) => task({ id: `task-${index}` })),
    );

    const view = await service.getActivity(CHAPTER, ME, null);

    expect(view.needs_you.tasks).toHaveLength(25);
    expect(view.needs_you_count).toBe(30);
  });
});
