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
    listWithFacts: jest.fn(async () => ({
      rows: [] as Meeting[],
      facts: new Map<string, { series_key: string | null }>(),
    })),
  };
  const suggestions = {
    reconcileSource: jest.fn(async () => ({ created: [], withdrawn: 0 })),
  };
  const consent = { chapterSwitchOn: jest.fn(async () => switchOn) };
  const tasks = { doneMarks: jest.fn(async () => new Map()) };
  const repo = {
    listKeyedForSource: jest.fn(
      async (_chapterId: string, _source: { id: string }) => [] as unknown[],
    ),
  };
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
    tasks.doneMarks.mockResolvedValue(
      new Map([['t-bus', { done: true, group: null }]]),
    );

    await expect(
      service.actionItemTasks(CHAPTER, MEETING, OFFICER),
    ).resolves.toEqual([{ index: 0, done: true, group: null }]);
    expect(meetings.get).toHaveBeenCalledWith(CHAPTER, MEETING, OFFICER);
    expect(tasks.doneMarks).toHaveBeenCalledWith(CHAPTER, ['t-bus']);
  });

  it('passes on a task for everyone with its counts', async () => {
    const { service, repo, tasks } = build();
    repo.listKeyedForSource.mockResolvedValue([
      accepted('Order shirts', 't-shirts'),
    ]);
    tasks.doneMarks.mockResolvedValue(
      new Map([['t-shirts', { done: false, group: { done: 14, total: 20 } }]]),
    );
    await expect(
      service.actionItemTasks(CHAPTER, MEETING, OFFICER),
    ).resolves.toEqual([
      { index: 1, done: false, group: { done: 14, total: 20 } },
    ]);
  });

  it('gives a task to the first of two items that read the same', async () => {
    const { service, repo, tasks, meetings } = build();
    meetings.get.mockResolvedValue({
      meeting: meeting({
        content: {
          ...meeting().content,
          action_items: [
            { text: 'Order shirts', owner_user_id: null, due_date: null },
            { text: 'order shirts.', owner_user_id: null, due_date: null },
          ],
        },
      }),
    });
    repo.listKeyedForSource.mockResolvedValue([
      accepted('Order shirts', 't-shirts'),
    ]);
    tasks.doneMarks.mockResolvedValue(
      new Map([['t-shirts', { done: true, group: null }]]),
    );
    await expect(
      service.actionItemTasks(CHAPTER, MEETING, OFFICER),
    ).resolves.toEqual([{ index: 0, done: true, group: null }]);
  });

  it('leaves out an item whose task was deleted since', async () => {
    const { service, repo } = build();
    repo.listKeyedForSource.mockResolvedValue([
      accepted('Book the bus', 't-gone'),
    ]);
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

describe('seriesOpenActionItems: what a repeating meeting still owes (#5482)', () => {
  const accepted = (text: string, taskId: string) => ({
    status: 'accepted',
    result_id: taskId,
    dedupe_key: actionItemKey(text),
  });
  const item = (text: string) => ({
    text,
    owner_user_id: null,
    due_date: null,
  });

  it("lists the open items of the series' posted minutes only, under the viewer's read", async () => {
    const { service, repo, tasks, meetings } = build();
    const newer = meeting({
      id: 'm-newer',
      event_start_time: '2026-11-16T00:00:00.000Z',
      content: { action_items: [item('Book the bus'), item('Order shirts')] },
    });
    const older = meeting({
      id: 'm-older',
      content: { action_items: [item('Send the reminder')] },
    });
    const draft = meeting({ id: 'm-draft', status: 'draft' });
    const other = meeting({ id: 'm-other' });
    meetings.listWithFacts.mockResolvedValue({
      rows: [newer, draft, older, other],
      facts: new Map([
        ['m-newer', { series_key: 'head' }],
        ['m-draft', { series_key: 'head' }],
        ['m-older', { series_key: 'head' }],
        ['m-other', { series_key: 'elsewhere' }],
      ]),
    });
    repo.listKeyedForSource.mockImplementation(
      async (_c: string, source: { id: string }) =>
        source.id === 'm-newer'
          ? [
              accepted('Book the bus', 't-bus'),
              accepted('Order shirts', 't-shirts'),
            ]
          : [],
    );
    tasks.doneMarks.mockResolvedValue(
      new Map([
        ['t-bus', { done: true, group: null }],
        ['t-shirts', { done: false, group: { done: 3, total: 20 } }],
      ]),
    );

    await expect(
      service.seriesOpenActionItems(CHAPTER, OFFICER, 'head'),
    ).resolves.toEqual([
      {
        meeting_id: 'm-newer',
        event_start_time: '2026-11-16T00:00:00.000Z',
        items: [
          {
            index: 1,
            text: 'Order shirts',
            owner_user_id: null,
            due_date: null,
            group: { done: 3, total: 20 },
          },
        ],
      },
      {
        meeting_id: 'm-older',
        event_start_time: '2026-11-09T00:00:00.000Z',
        // Nobody made a task of it: open.
        items: [
          {
            index: 0,
            text: 'Send the reminder',
            owner_user_id: null,
            due_date: null,
            group: null,
          },
        ],
      },
    ]);
    expect(meetings.listWithFacts).toHaveBeenCalledWith(CHAPTER, OFFICER);
  });

  it('closes a later copy of an item with the first copy’s task', async () => {
    const { service, repo, tasks, meetings } = build();
    const twice = meeting({
      content: { action_items: [item('Order shirts'), item('order shirts.')] },
    });
    meetings.listWithFacts.mockResolvedValue({
      rows: [twice],
      facts: new Map([[MEETING, { series_key: 'head' }]]),
    });
    repo.listKeyedForSource.mockResolvedValue([
      accepted('Order shirts', 't-shirts'),
    ]);
    tasks.doneMarks.mockResolvedValue(
      new Map([['t-shirts', { done: true, group: null }]]),
    );
    await expect(
      service.seriesOpenActionItems(CHAPTER, OFFICER, 'head'),
    ).resolves.toEqual([]);
  });
});
