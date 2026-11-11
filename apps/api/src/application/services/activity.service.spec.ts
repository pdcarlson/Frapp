import * as caughtFailure from '../../infrastructure/observability/report-caught-failure';
import { ActivityService } from './activity.service';
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
    created_at: iso(-72 * HOUR),
    ...overrides,
  }) as Event;

function build(permissions: string[] = [SystemPermissions.MEMBERS_VIEW]) {
  const taskService = { list: jest.fn().mockResolvedValue([]) };
  const serviceEntryService = {
    findByChapterFiltered: jest.fn().mockResolvedValue([]),
  };
  const eventService = { findByChapter: jest.fn().mockResolvedValue([]) };
  const documentService = { findByChapter: jest.fn().mockResolvedValue([]) };
  const backworkService = { findByChapter: jest.fn().mockResolvedValue([]) };
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
  const actionRepo = { findActedMessageIds: jest.fn().mockResolvedValue([]) };
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
  const service = new ActivityService(
    taskService as never,
    serviceEntryService as never,
    eventService as never,
    documentService as never,
    backworkService as never,
    chatService as never,
    chatBlocks as never,
    rbacService as never,
    messageRepo as never,
    actionRepo as never,
    userRepo as never,
    memberRepo as never,
    attendanceRepo as never,
  );
  return {
    service,
    taskService,
    serviceEntryService,
    eventService,
    attendanceRepo,
    memberRepo,
    rbacService,
    documentService,
    backworkService,
    chatService,
    chatBlocks,
    messageRepo,
    actionRepo,
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
      expect(actionRepo.findActedMessageIds).toHaveBeenCalledWith(
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

    it('serves no polls, and says so, when the block list cannot be read', async () => {
      const { service, messageRepo, chatBlocks } = build();
      chatBlocks.listBlockedUserIds.mockRejectedValue(new Error('db down'));
      servePolls(messageRepo, [pollCard({ id: 'poll-1' })]);

      const view = await service.getActivity(CHAPTER, ME, null);

      expect(view.needs_you.polls).toEqual([]);
      expect(view.made_by_you.polls).toEqual([]);
      expect(view.unavailable).toEqual(['polls']);
    });

    it('reports a failed section to Sentry at error level, not only the log (#4096)', async () => {
      const reported = jest.spyOn(caughtFailure, 'reportCaughtFailure');
      const { service, messageRepo, chatBlocks } = build();
      chatBlocks.listBlockedUserIds.mockRejectedValue(new Error('db down'));
      servePolls(messageRepo, [pollCard({ id: 'poll-1' })]);

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
      actionRepo.findActedMessageIds.mockResolvedValue(['voted']);

      const view = await service.getActivity(CHAPTER, ME, null);

      expect(view.needs_you.polls.map((poll) => poll.message_id)).toEqual([
        'open',
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
      actionRepo.findActedMessageIds.mockResolvedValue(['mine-open']);

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

    it('reads no polls while the Polls module is off', async () => {
      const { service, messageRepo, chatService } = build();
      servePolls(messageRepo, [pollCard({ id: 'poll-1' })]);

      const view = await service.getActivity(CHAPTER, ME, { polls: false });

      expect(view.needs_you.polls).toEqual([]);
      expect(messageRepo.findPollCardsByChapter).not.toHaveBeenCalled();
      expect(chatService.getChannels).not.toHaveBeenCalled();
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

  describe('files', () => {
    it('lists only the caller’s own uploads, newest first', async () => {
      const { service, documentService, backworkService } = build([
        SystemPermissions.MEMBERS_VIEW,
        SystemPermissions.BACKWORK_UPLOAD,
      ]);
      documentService.findByChapter.mockResolvedValue([
        {
          id: 'doc-mine',
          title: 'Bylaws',
          uploaded_by: ME,
          created_at: iso(-HOUR),
        },
      ]);
      backworkService.findByChapter.mockResolvedValue([
        {
          id: 'bw-mine',
          title: null,
          uploader_id: ME,
          created_at: iso(-HOUR / 2),
        },
      ]);

      const view = await service.getActivity(CHAPTER, ME, null);

      expect(view.made_by_you.files).toEqual([
        {
          id: 'bw-mine',
          source: 'backwork',
          title: '',
          created_at: iso(-HOUR / 2),
        },
        {
          id: 'doc-mine',
          source: 'document',
          title: 'Bylaws',
          created_at: iso(-HOUR),
        },
      ]);
      // Narrowed to the uploader in the query, not after a chapter-wide read.
      expect(documentService.findByChapter).toHaveBeenCalledWith(CHAPTER, {
        uploaded_by: ME,
      });
      expect(backworkService.findByChapter).toHaveBeenCalledWith(CHAPTER, {
        uploader_id: ME,
      });
    });

    it('does not read backwork for a member who cannot open it, or either module while it is off', async () => {
      const member = build();
      await member.service.getActivity(CHAPTER, ME, null);
      expect(member.backworkService.findByChapter).not.toHaveBeenCalled();
      expect(member.documentService.findByChapter).toHaveBeenCalled();

      const off = build([SystemPermissions.BACKWORK_ADMIN]);
      await off.service.getActivity(CHAPTER, ME, {
        backwork: false,
        documents: false,
      });
      expect(off.backworkService.findByChapter).not.toHaveBeenCalled();
      expect(off.documentService.findByChapter).not.toHaveBeenCalled();
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
