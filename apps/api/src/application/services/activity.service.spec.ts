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
  const attendanceService = {
    getMyAttendance: jest.fn().mockResolvedValue(null),
  };
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
  const service = new ActivityService(
    taskService as never,
    serviceEntryService as never,
    eventService as never,
    attendanceService as never,
    documentService as never,
    backworkService as never,
    chatService as never,
    chatBlocks as never,
    rbacService as never,
    messageRepo as never,
    actionRepo as never,
    userRepo as never,
  );
  return {
    service,
    taskService,
    serviceEntryService,
    eventService,
    attendanceService,
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
      taskService.list.mockResolvedValue([
        task({ id: 'later', due_date: '2026-12-01' }),
        task({ id: 'sooner', due_date: '2026-11-12' }),
        task({
          id: 'done',
          status: TaskStatus.COMPLETED,
          stored_status: TaskStatus.COMPLETED,
          completed_at: iso(-HOUR),
        }),
      ]);

      const view = await service.getActivity(CHAPTER, ME, null);

      expect(taskService.list).toHaveBeenCalledWith(CHAPTER, ME, false);
      expect(view.needs_you.tasks.map((row) => row.id)).toEqual([
        'sooner',
        'later',
      ]);
      expect(view.needs_you.tasks[0]).toEqual(
        expect.objectContaining({
          assignee_name: 'Me Member',
          created_by_name: 'Other Member',
        }),
      );
      expect(view.needs_you.task_confirmations).toEqual([]);
      expect(view.made_by_you.tasks).toEqual([]);
      expect(view.needs_you_count).toBe(2);
    });

    it('keeps an overdue task under needs you', async () => {
      const { service, taskService } = build();
      taskService.list.mockResolvedValue([
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
      taskService.list.mockResolvedValue([
        task({
          id: 'to-confirm',
          assignee_id: OTHER,
          created_by: ME,
          completed_at: iso(-HOUR),
          ...completed,
        }),
        // The caller's own completion: the confirm route refuses it.
        task({ id: 'own-done', completed_at: iso(-HOUR), ...completed }),
        task({
          id: 'confirmed',
          assignee_id: OTHER,
          completed_at: iso(-HOUR),
          confirmed_at: iso(-HOUR / 2),
          ...completed,
        }),
        task({ id: 'someone-elses', assignee_id: OTHER, created_by: OTHER }),
      ]);

      const view = await service.getActivity(CHAPTER, ME, null);

      expect(taskService.list).toHaveBeenCalledWith(CHAPTER, ME, true);
      expect(view.needs_you.task_confirmations.map((row) => row.id)).toEqual([
        'to-confirm',
      ]);
      expect(view.made_by_you.tasks.map((row) => row.id)).toEqual([
        'to-confirm',
      ]);
      expect(view.needs_you.tasks).toEqual([]);
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

      expect(eventService.findByChapter).toHaveBeenCalledWith(CHAPTER, ME);
    });

    it('lists events inside the window, soonest first, and drops past and far-off ones', async () => {
      const { service, eventService, attendanceService } = build();
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
      expect(attendanceService.getMyAttendance).not.toHaveBeenCalled();
      expect(view.needs_you_count).toBe(0);
    });

    it('counts an event whose check-in is open until the caller has checked in', async () => {
      const { service, eventService, attendanceService } = build();
      eventService.findByChapter.mockResolvedValue([
        // Started half an hour ago, still running.
        event({
          id: 'now',
          start_time: iso(-HOUR / 2),
          end_time: iso(HOUR / 2),
        }),
      ]);

      const before = await service.getActivity(CHAPTER, ME, null);
      attendanceService.getMyAttendance.mockResolvedValue({ id: 'att-1' });
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
      const { service, eventService, attendanceService } = build();
      eventService.findByChapter.mockResolvedValue([
        event({
          id: 'now',
          start_time: iso(-HOUR / 2),
          end_time: iso(HOUR / 2),
        }),
      ]);
      attendanceService.getMyAttendance.mockRejectedValue(new Error('db down'));

      const view = await service.getActivity(CHAPTER, ME, null);

      expect(view.coming_up[0]).toEqual(
        expect.objectContaining({ check_in_open: true, checked_in: null }),
      );
      expect(view.needs_you_count).toBe(1);
      expect(view.unavailable).toEqual([]);
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
        {
          id: 'doc-theirs',
          title: 'Budget',
          uploaded_by: OTHER,
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
        {
          id: 'bw-theirs',
          title: 'Exam 1',
          uploader_id: OTHER,
          created_at: iso(-HOUR),
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
