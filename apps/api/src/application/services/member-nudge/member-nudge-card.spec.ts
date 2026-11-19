import type { MemberNudge } from '#domain/entities/member-nudge.entity';
import { TaskStatus, type Task } from '#domain/entities/task.entity';
import type {
  IMemberNudgeRepository,
  MemberNudgeDraft,
} from '#domain/repositories/member-nudge.repository.interface';
import {
  eventItems,
  officerQueueItem,
  type NudgeItem,
} from '#domain/utils/member-nudge-items';
import type { AiConsentService } from '../ai/ai-consent.service';
import type { AiGatewayService } from '../ai/ai-gateway.service';
import { MemberNudgeService } from './member-nudge.service';

// Wednesday 18 November 2026, 2:00 PM in New York.
const NOW = new Date('2026-11-18T19:00:00.000Z');
const HOUR = 3_600_000;
const DAY = 24 * HOUR;
const at = (ms: number) => new Date(NOW.getTime() + ms).toISOString();
const TZ = 'America/New_York';

function task(overrides: Partial<Task> = {}): Task {
  return {
    id: 'task-1',
    chapter_id: 'chapter-1',
    title: 'Book the formal venue',
    description: null,
    assignee_id: 'user-1',
    created_by: 'officer-1',
    due_date: '2026-11-20',
    due_at: null,
    status: TaskStatus.TODO,
    point_reward: null,
    points_awarded: false,
    completed_at: null,
    confirmed_at: null,
    sent_back_at: null,
    proof_kind: 'none',
    proof_link: null,
    sent_back_reason: null,
    completion_note: null,
    series_id: null,
    occurrence_date: null,
    group_id: null,
    meeting_id: null,
    followed_by: null,
    created_at: at(-5 * DAY),
    ...overrides,
  };
}

const tonight: NudgeItem[] = eventItems(
  [
    {
      id: 'event-1',
      name: 'Chapter Meeting',
      location: 'Chapter House',
      start_time: at(5 * HOUR),
      end_time: at(7 * HOUR),
      attendance: 'required',
      point_value: 5,
      checked_in: null,
      snoozed_until: null,
    },
  ],
  NOW,
  TZ,
);
const queue = officerQueueItem(
  { tasks: [], hours: [{ id: 'h1', created_at: at(-2 * DAY) }] },
  NOW,
) as NudgeItem;

function row(
  draft: MemberNudgeDraft,
  overrides: Partial<MemberNudge> = {},
): MemberNudge {
  return {
    id: `row-${draft.subject_key}`,
    ...draft,
    status: 'showing',
    dismiss_reason: null,
    seen_at: null,
    created_at: NOW.toISOString(),
    closed_at: null,
    ...overrides,
  };
}

function setup(
  options: {
    tasks?: Task[];
    showing?: MemberNudge | null;
    aiAllowed?: boolean;
    raised?: Pick<MemberNudge, 'task_id' | 'kind' | 'subject_key'>[];
    enabled?: boolean;
  } = {},
) {
  const tasks = options.tasks ?? [];
  const nudges: jest.Mocked<IMemberNudgeRepository> = {
    findShowing: jest.fn().mockResolvedValue(options.showing ?? null),
    findRecent: jest.fn().mockResolvedValue([]),
    findRaised: jest.fn().mockResolvedValue(options.raised ?? []),
    create: jest.fn(async (draft) => row(draft)),
    markSeen: jest.fn().mockResolvedValue(undefined),
    close: jest.fn().mockResolvedValue(true),
    deleteShowing: jest.fn().mockResolvedValue(undefined),
    stripWords: jest.fn().mockResolvedValue(undefined),
    deleteWrittenByUser: jest.fn().mockResolvedValue(undefined),
    dismissSubject: jest.fn().mockResolvedValue(undefined),
    deleteByUser: jest.fn().mockResolvedValue(undefined),
    closeExpired: jest.fn().mockResolvedValue(undefined),
    findSettings: jest
      .fn()
      .mockResolvedValue(
        options.enabled === false
          ? { enabled: false, quiet_until: null }
          : null,
      ),
    saveSettings: jest.fn(),
  };
  const taskRepo = {
    findById: jest.fn(
      async (id: string) => tasks.find((t) => t.id === id) ?? null,
    ),
    findByChapter: jest.fn(
      async (
        _c: string,
        query: { assigneeId?: string; status?: TaskStatus } = {},
      ) =>
        tasks.filter(
          (t) =>
            (query.assigneeId === undefined ||
              t.assignee_id === query.assigneeId) &&
            (query.status === undefined || t.status === query.status),
        ),
    ),
    findSubtasks: jest.fn().mockResolvedValue([]),
  };
  const consent = {
    check: jest.fn().mockResolvedValue({ allowed: options.aiAllowed ?? false }),
    chapterSwitchOn: jest.fn().mockResolvedValue(true),
    onConsentWithdrawn: jest.fn(),
  };
  const gateway = {
    generateObject: jest.fn(
      async (_task: string, request: { system: string }) =>
        request.system.includes('Return "line"')
          ? {
              status: 'ok',
              value: { line: 'Being there counts for 5 points.' },
              usage: {},
            }
          : {
              status: 'ok',
              value: {
                title: 'A good day to start',
                body: 'A call today keeps Friday calm.',
                start_here: 'Call the first venue.',
              },
              usage: {},
            },
    ),
  };
  const service = new MemberNudgeService(
    nudges,
    taskRepo,
    { findDisplayIdentitiesByIds: jest.fn().mockResolvedValue([]) },
    {
      findById: jest
        .fn()
        .mockResolvedValue({ id: 'chapter-1', enabled_modules: null }),
    },
    consent as unknown as AiConsentService,
    gateway as unknown as AiGatewayService,
  );
  return { service, nudges, gateway, consent };
}

const INPUT = {
  chapterId: 'chapter-1',
  userId: 'user-1',
  timeZone: TZ,
  tasksOn: true,
  aiUse: true,
};

describe('MemberNudgeService.card', () => {
  it('shows a plain card with no model call when AI is off', async () => {
    const { service, nudges, gateway } = setup({ aiAllowed: false });
    const result = await service.card(
      { ...INPUT, items: [...tonight, queue] },
      NOW,
    );

    expect(result.card).toMatchObject({
      kind: 'event_soon',
      headline: 'Chapter Meeting',
      meta: 'Tonight 7:00 PM · Chapter House · Required',
      line: null,
      target_type: 'event',
      target_id: 'event-1',
    });
    expect(result.card?.id).toBe('row-event-1');
    expect(result.tray.map((item) => item.kind)).toEqual(['officer_queue']);
    expect(result.tray[0]?.id).toBeNull();
    expect(gateway.generateObject).not.toHaveBeenCalled();
    expect(nudges.create).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: 'event_soon',
        subject_key: 'event-1',
        task_id: null,
        body: null,
        written_by: 'plain',
        expires_at: at(7 * HOUR),
      }),
    );
  });

  it('adds one checked sentence when AI is on', async () => {
    const { service, gateway } = setup({ aiAllowed: true });
    const result = await service.card({ ...INPUT, items: tonight }, NOW);

    expect(result.card?.line).toBe('Being there counts for 5 points.');
    expect(gateway.generateObject).toHaveBeenCalledWith(
      'nudges.write',
      expect.objectContaining({ promptVersion: 'nudges.item-line@v1' }),
      { chapterId: 'chapter-1', actingUserId: 'user-1' },
    );
  });

  it('never writes for a kind that already says everything', async () => {
    const { service, gateway } = setup({ aiAllowed: true });
    const result = await service.card({ ...INPUT, items: [queue] }, NOW);

    expect(result.card).toMatchObject({ kind: 'officer_queue', line: null });
    expect(gateway.generateObject).not.toHaveBeenCalled();
  });

  it('shows a task card plain when AI is off, which #4781 never did', async () => {
    const { service, nudges } = setup({ aiAllowed: false, tasks: [task()] });
    const result = await service.card({ ...INPUT, items: [] }, NOW);

    expect(result.card).toMatchObject({
      kind: 'task_due_soon',
      headline: 'Book the formal venue',
      meta: 'Due Friday',
      task_id: 'task-1',
      line: null,
      start_here: null,
    });
    expect(nudges.create).toHaveBeenCalledWith(
      expect.objectContaining({ task_id: 'task-1', written_by: 'plain' }),
    );
  });

  it('shows the AI words on a task card when AI wrote them', async () => {
    const { service } = setup({ aiAllowed: true, tasks: [task()] });
    const result = await service.card({ ...INPUT, items: [] }, NOW);

    expect(result.card).toMatchObject({
      line: 'A call today keeps Friday calm.',
      start_here: 'Call the first venue.',
    });
  });

  it('keeps the showing card while it is still the most useful', async () => {
    const showing = row({
      chapter_id: 'chapter-1',
      user_id: 'user-1',
      kind: 'event_soon',
      task_id: null,
      subject_key: 'event-1',
      title: 'Chapter Meeting',
      body: 'Being there counts for 5 points.',
      start_here: null,
      written_by: 'ai',
      expires_at: at(7 * HOUR),
    });
    const { service, nudges, gateway } = setup({ aiAllowed: true, showing });
    const result = await service.card(
      { ...INPUT, items: [...tonight, queue] },
      NOW,
    );

    expect(result.card).toMatchObject({
      id: showing.id,
      line: 'Being there counts for 5 points.',
    });
    expect(nudges.create).not.toHaveBeenCalled();
    expect(nudges.deleteShowing).not.toHaveBeenCalled();
    expect(gateway.generateObject).not.toHaveBeenCalled();
  });

  it('deletes a showing card something more useful overtook, so it can return', async () => {
    const showing = row({
      chapter_id: 'chapter-1',
      user_id: 'user-1',
      kind: 'officer_queue',
      task_id: null,
      subject_key: 'queue:h1',
      title: '1 waiting on you',
      body: null,
      start_here: null,
      written_by: 'plain',
      expires_at: at(DAY),
    });
    const { service, nudges } = setup({ showing });
    const result = await service.card(
      { ...INPUT, items: [queue, ...tonight] },
      NOW,
    );

    expect(nudges.deleteShowing).toHaveBeenCalledWith(
      'chapter-1',
      'user-1',
      showing.id,
    );
    expect(nudges.close).not.toHaveBeenCalled();
    expect(result.card?.kind).toBe('event_soon');
    expect(result.tray.map((item) => item.kind)).toEqual(['officer_queue']);
  });

  it('leaves out what the member waved off', async () => {
    const { service } = setup({
      raised: [{ kind: 'event_soon', subject_key: 'event-1', task_id: null }],
    });
    const result = await service.card(
      { ...INPUT, items: [...tonight, queue] },
      NOW,
    );

    expect(result.card?.kind).toBe('officer_queue');
    expect(result.tray).toEqual([]);
  });

  it('shows nothing when the member turned the cards off', async () => {
    const { service, nudges } = setup({ enabled: false });
    expect(await service.card({ ...INPUT, items: tonight }, NOW)).toEqual({
      card: null,
      tray: [],
    });
    expect(nudges.create).not.toHaveBeenCalled();
  });

  it('reads no task when the chapter has Tasks off', async () => {
    const { service } = setup({ tasks: [task()] });
    const result = await service.card(
      { ...INPUT, tasksOn: false, items: [] },
      NOW,
    );
    expect(result.card).toBeNull();
  });
});

describe('MemberNudgeService.card, what it keeps from #4781', () => {
  const taskRow = (overrides: Partial<MemberNudge> = {}) =>
    row(
      {
        chapter_id: 'chapter-1',
        user_id: 'user-1',
        kind: 'task_due_soon',
        task_id: 'task-1',
        subject_key: 'task-1',
        title: 'A good day to start',
        body: 'A call today keeps Friday calm.',
        start_here: 'Call the first venue.',
        written_by: 'ai',
        expires_at: at(DAY),
      },
      overrides,
    );

  it('paces task cards: none within 20 hours of the last', async () => {
    const { service, nudges } = setup({ tasks: [task()] });
    nudges.findRecent.mockResolvedValue([
      taskRow({
        id: 'earlier',
        task_id: 'task-0',
        subject_key: 'task-0',
        status: 'dismissed',
        created_at: at(-2 * HOUR),
      }),
    ]);
    const result = await service.card({ ...INPUT, items: [] }, NOW);
    expect(result.card).toBeNull();
    expect(nudges.create).not.toHaveBeenCalled();
  });

  it('closes a showing task card whose task is done, as done', async () => {
    const { service, nudges } = setup({
      showing: taskRow(),
      tasks: [task({ status: TaskStatus.COMPLETED, completed_at: at(-HOUR) })],
    });
    await service.card({ ...INPUT, items: [] }, NOW);
    expect(nudges.close).toHaveBeenCalledWith(
      'chapter-1',
      'user-1',
      taskRow().id,
      expect.objectContaining({ status: 'done' }),
    );
  });

  it('strips the AI words from a showing card once AI is off', async () => {
    const { service, nudges } = setup({
      aiAllowed: false,
      showing: taskRow(),
      tasks: [task()],
    });
    const result = await service.card({ ...INPUT, items: [] }, NOW);
    expect(nudges.stripWords).toHaveBeenCalledWith(
      'chapter-1',
      'user-1',
      taskRow().id,
      'Book the formal venue',
    );
    expect(result.card).toMatchObject({ line: null, start_here: null });
  });

  it('closes an overtaken task card the member saw, so pacing still counts it', async () => {
    const seen = taskRow({ seen_at: at(-HOUR) });
    const { service, nudges } = setup({ showing: seen, tasks: [task()] });
    const result = await service.card({ ...INPUT, items: tonight }, NOW);
    expect(nudges.close).toHaveBeenCalledWith(
      'chapter-1',
      'user-1',
      seen.id,
      expect.objectContaining({ status: 'expired' }),
    );
    expect(nudges.deleteShowing).not.toHaveBeenCalled();
    expect(result.card?.kind).toBe('event_soon');
  });

  it('deletes an overtaken task card the member never saw', async () => {
    const { service, nudges } = setup({ showing: taskRow(), tasks: [task()] });
    await service.card({ ...INPUT, items: tonight }, NOW);
    expect(nudges.deleteShowing).toHaveBeenCalledWith(
      'chapter-1',
      'user-1',
      taskRow().id,
    );
  });

  it('never asks about AI for a member without ai:use', async () => {
    const { service, consent, gateway } = setup({ aiAllowed: true });
    const result = await service.card(
      { ...INPUT, aiUse: false, items: tonight },
      NOW,
    );
    expect(consent.check).not.toHaveBeenCalled();
    expect(gateway.generateObject).not.toHaveBeenCalled();
    expect(result.card?.line).toBeNull();
  });

  it("sends no member's typed words to the model where Ask is off", async () => {
    const { service, consent, gateway } = setup({ aiAllowed: true });
    consent.chapterSwitchOn.mockResolvedValue(false);
    const result = await service.card({ ...INPUT, items: tonight }, NOW);
    expect(gateway.generateObject).not.toHaveBeenCalled();
    expect(result.card?.line).toBeNull();
  });
});

describe('MemberNudgeService.dismissSubject', () => {
  it('records any item kind for the member', async () => {
    const { service, nudges } = setup();
    await service.dismissSubject(
      'chapter-1',
      'user-1',
      { kind: 'mention_unread', subject_key: 'ch-1:m-1' },
      NOW,
    );
    expect(nudges.dismissSubject).toHaveBeenCalledWith(
      'chapter-1',
      'user-1',
      { kind: 'mention_unread', subject_key: 'ch-1:m-1', task_id: null },
      NOW.toISOString(),
    );
  });

  it("records a task card only for the member's own task", async () => {
    const { service, nudges } = setup({
      tasks: [
        task(),
        task({
          id: '00000000-0000-4000-8000-000000000002',
          assignee_id: 'other',
        }),
      ],
    });
    await service.dismissSubject('chapter-1', 'user-1', {
      kind: 'task_overdue',
      subject_key: 'not-a-uuid',
    });
    await service.dismissSubject('chapter-1', 'user-1', {
      kind: 'task_overdue',
      subject_key: '00000000-0000-4000-8000-000000000002',
    });
    expect(nudges.dismissSubject).not.toHaveBeenCalled();
  });
});

describe('MemberNudgeService.current, beside the widened card', () => {
  it('leaves a showing card that is not a task alone when AI is off', async () => {
    const showing = row({
      chapter_id: 'chapter-1',
      user_id: 'user-1',
      kind: 'event_soon',
      task_id: null,
      subject_key: 'event-1',
      title: 'Chapter Meeting',
      body: null,
      start_here: null,
      written_by: 'plain',
      expires_at: at(7 * HOUR),
    });
    const { service, nudges } = setup({ aiAllowed: false, showing });
    expect(
      await service.current(
        { chapterId: 'chapter-1', userId: 'user-1', timeZone: TZ },
        NOW,
      ),
    ).toBeNull();
    expect(nudges.close).not.toHaveBeenCalled();
  });

  it('draws nothing while a card that is not a task is showing', async () => {
    const showing = row({
      chapter_id: 'chapter-1',
      user_id: 'user-1',
      kind: 'event_soon',
      task_id: null,
      subject_key: 'event-1',
      title: 'Chapter Meeting',
      body: null,
      start_here: null,
      written_by: 'plain',
      expires_at: at(7 * HOUR),
    });
    const { service, nudges } = setup({
      aiAllowed: true,
      showing,
      tasks: [task()],
    });
    expect(
      await service.current(
        { chapterId: 'chapter-1', userId: 'user-1', timeZone: TZ },
        NOW,
      ),
    ).toBeNull();
    expect(nudges.close).not.toHaveBeenCalled();
    expect(nudges.create).not.toHaveBeenCalled();
  });
});
