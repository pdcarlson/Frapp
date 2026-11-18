import type { Meeting } from '#domain/entities/meeting.entity';
import { actionItemKey } from '#domain/utils/minutes-task-proposals';
import { MeetingTaskSuggestionsService } from './meeting-task-suggestions.service';

const CHAPTER = '11111111-1111-4111-8111-111111111111';
const OFFICER = '22222222-2222-4222-8222-222222222222';
const JAKE = '33333333-3333-4333-8333-333333333333';
const MEETING = '55555555-5555-4555-8555-555555555555';

const meeting = (over: Partial<Meeting> = {}): Meeting => ({
  id: MEETING,
  chapter_id: CHAPTER,
  event_id: null,
  event_name: 'Chapter meeting',
  event_start_time: '2026-11-09T00:00:00.000Z',
  meeting_type: 'chapter',
  other_label: null,
  status: 'posted',
  content: {
    action_items: [
      { text: 'Book the bus', owner_user_id: JAKE, due_date: '2026-11-14' },
      { text: 'Order shirts', owner_user_id: null, due_date: null },
    ],
  },
  created_by: OFFICER,
  updated_by: OFFICER,
  posted_by: OFFICER,
  posted_at: '2026-11-10T00:00:00.000Z',
  created_at: '2026-11-09T00:00:00.000Z',
  updated_at: '2026-11-10T00:00:00.000Z',
  transcript: null,
  ...over,
});

function build(switchOn = true) {
  const listeners: ((m: Meeting, c: never) => Promise<void>)[] = [];
  const meetings = {
    onPostedMinutesSaved: jest.fn((listener) => listeners.push(listener)),
    get: jest.fn(async () => ({ meeting: meeting() })),
  };
  const suggestions = {
    reconcileSource: jest.fn(async () => ({ created: [], withdrawn: 0 })),
  };
  const consent = { chapterSwitchOn: jest.fn(async () => switchOn) };
  const tasks = { findById: jest.fn() };
  const repo = { listKeyedForSource: jest.fn(async () => [] as unknown[]) };
  const service = new MeetingTaskSuggestionsService(
    meetings as never,
    suggestions as never,
    consent as never,
    tasks as never,
    repo as never,
  );
  return { service, meetings, suggestions, consent, listeners, tasks, repo };
}

describe('MeetingTaskSuggestionsService (#4313)', () => {
  const env = process.env.AI_ENABLED;
  beforeEach(() => {
    process.env.AI_ENABLED = 'true';
  });
  afterAll(() => {
    if (env === undefined) delete process.env.AI_ENABLED;
    else process.env.AI_ENABLED = env;
  });

  it('proposes the action items of posted minutes and tells the officer who posted them', async () => {
    const { service, suggestions, consent } = build();
    await service.sync(meeting(), { reason: 'posted', actorId: OFFICER });

    expect(consent.chapterSwitchOn).toHaveBeenCalledWith(
      CHAPTER,
      'meeting_notes',
    );
    expect(suggestions.reconcileSource).toHaveBeenCalledWith({
      chapterId: CHAPTER,
      requestedFor: OFFICER,
      source: {
        type: 'meeting',
        id: MEETING,
        title: 'Chapter meeting',
        text: 'Book the bus\nOrder shirts',
      },
      kind: 'task',
      proposals: [
        {
          dedupeKey: actionItemKey('Book the bus'),
          payload: {
            title: 'Book the bus',
            description: 'From the minutes of Chapter meeting.',
            assignee_id: JAKE,
            due_date: '2026-11-14',
          },
          quote: 'Book the bus',
        },
        {
          dedupeKey: actionItemKey('Order shirts'),
          payload: {
            title: 'Order shirts',
            description: 'From the minutes of Chapter meeting.',
            assignee_id: null,
            due_date: null,
          },
          quote: 'Order shirts',
        },
      ],
      notify: [OFFICER],
    });
  });

  it('tells nobody about an edit after posting', async () => {
    const { service, suggestions } = build();
    await service.sync(meeting(), { reason: 'edited', actorId: OFFICER });
    expect(suggestions.reconcileSource).toHaveBeenCalledWith(
      expect.objectContaining({ notify: [] }),
    );
  });

  it('still runs for minutes with no action items, so removed items are taken back', async () => {
    const { service, suggestions } = build();
    await service.sync(meeting({ content: { action_items: [] } }), {
      reason: 'edited',
      actorId: OFFICER,
    });
    expect(suggestions.reconcileSource).toHaveBeenCalledWith(
      expect.objectContaining({ proposals: [] }),
    );
  });

  it('does nothing while the server has AI off, without reading the chapter', async () => {
    delete process.env.AI_ENABLED;
    const { service, suggestions, consent } = build();
    expect(
      await service.sync(meeting(), { reason: 'posted', actorId: OFFICER }),
    ).toBeNull();
    expect(consent.chapterSwitchOn).not.toHaveBeenCalled();
    expect(suggestions.reconcileSource).not.toHaveBeenCalled();
  });

  it('proposes nothing while the president has meeting notes off, and takes back what was waiting', async () => {
    const { service, suggestions } = build(false);
    await service.sync(meeting(), { reason: 'posted', actorId: OFFICER });
    expect(suggestions.reconcileSource).toHaveBeenCalledWith(
      expect.objectContaining({ proposals: [], notify: [] }),
    );
  });

  it('does nothing for a draft', async () => {
    const { service, suggestions } = build();
    await service.sync(meeting({ status: 'draft' }), {
      reason: 'edited',
      actorId: OFFICER,
    });
    expect(suggestions.reconcileSource).not.toHaveBeenCalled();
  });

  it('listens for posted minutes from the moment the module starts', async () => {
    const { service, meetings, suggestions, listeners } = build();
    service.onModuleInit();
    expect(meetings.onPostedMinutesSaved).toHaveBeenCalledTimes(1);
    await listeners[0](meeting(), {
      reason: 'posted',
      actorId: OFFICER,
    } as never);
    expect(suggestions.reconcileSource).toHaveBeenCalledTimes(1);
  });
});

describe("actionItemTasks: the minutes' checkboxes", () => {
  const accepted = (text: string, taskId: string) => ({
    status: 'accepted',
    result_id: taskId,
    dedupe_key: actionItemKey(text),
  });

  it('marks each item an officer made a task with whether it is done, and tells nothing about the rest', async () => {
    const { service, repo, tasks, meetings } = build();
    repo.listKeyedForSource.mockResolvedValue([
      accepted('Book the bus', 't-bus'),
      // A dismissed one has no task.
      {
        status: 'dismissed',
        result_id: null,
        dedupe_key: actionItemKey('Order shirts'),
      },
    ]);
    tasks.findById.mockResolvedValue({
      stored_status: 'COMPLETED',
      group: null,
    });

    await expect(
      service.actionItemTasks(CHAPTER, MEETING, OFFICER),
    ).resolves.toEqual([{ index: 0, done: true, group: null }]);
    expect(meetings.get).toHaveBeenCalledWith(CHAPTER, MEETING, OFFICER);
    expect(tasks.findById).toHaveBeenCalledWith('t-bus', CHAPTER);
  });

  it('follows a task for everyone by its copies', async () => {
    const { service, repo, tasks } = build();
    repo.listKeyedForSource.mockResolvedValue([
      accepted('Order shirts', 't-shirts'),
    ]);
    tasks.findById.mockResolvedValue({
      stored_status: 'COMPLETED',
      group: { done: 14, total: 20, confirmed: 3 },
    });
    await expect(
      service.actionItemTasks(CHAPTER, MEETING, OFFICER),
    ).resolves.toEqual([
      { index: 1, done: false, group: { done: 14, total: 20 } },
    ]);
  });

  it('leaves out an item whose task was deleted since', async () => {
    const { NotFoundException } = await import('@nestjs/common');
    const { service, repo, tasks } = build();
    repo.listKeyedForSource.mockResolvedValue([
      accepted('Book the bus', 't-gone'),
    ]);
    tasks.findById.mockRejectedValue(new NotFoundException('Task not found'));
    await expect(
      service.actionItemTasks(CHAPTER, MEETING, OFFICER),
    ).resolves.toEqual([]);
  });

  it('says nothing for a draft', async () => {
    const { service, repo, meetings } = build();
    meetings.get.mockResolvedValue({ meeting: meeting({ status: 'draft' }) });
    await expect(
      service.actionItemTasks(CHAPTER, MEETING, OFFICER),
    ).resolves.toEqual([]);
    expect(repo.listKeyedForSource).not.toHaveBeenCalled();
  });
});
