import { BadRequestException, NotFoundException } from '@nestjs/common';
import type { AiSuggestion } from '#domain/entities/ai-suggestion.entity';
import type {
  AiSuggestionClaim,
  ListPendingAiSuggestionsQuery,
  NewAiSuggestion,
} from '#domain/repositories/ai-suggestion.repository.interface';
import { TaskStatus } from '#domain/entities/task.entity';
import { AiRunFailure, type AiRunContext } from './ai-run-registry';
import { EventSuggestionKind } from './ai-suggestion-event-kind';
import { TaskSuggestionKind } from './ai-suggestion-task-kind';
import { TaskSuggestionSource } from './ai-suggestion-sources';
import { AiSuggestionService } from './ai-suggestion.service';
import {
  LAST_YEAR_RUN_KIND,
  LastYearSuggestionsService,
  lastYearWeekIndex,
} from './last-year-suggestions.service';

const CHAPTER = '11111111-1111-4111-8111-111111111111';
const OTHER_CHAPTER = '99999999-9999-4999-8999-999999999999';
const PRESIDENT = '22222222-2222-4222-8222-222222222222';
const SOCIAL_CHAIR = '33333333-3333-4333-8333-333333333333';
const MEMBER = '44444444-4444-4444-8444-444444444444';
const PRESIDENT_ROLE = '55555555-5555-4555-8555-555555555555';
const RUN = '66666666-6666-4666-8666-666666666666';
const LAST_PHIL = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const LAST_FORMAL = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const LAST_CONTRACT = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const EXEC_RETREAT = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
const NEW_EVENT = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee';

// A new president in March. Philanthropy week was in April last year.
const NOW = new Date('2027-03-08T15:00:00.000Z');

/** `ai_suggestions`, in memory: the parts the two services under test use. */
class FakeRows {
  rows: AiSuggestion[] = [];
  private seq = 0;

  insertBatch = async (chapterId: string, rows: readonly NewAiSuggestion[]) => {
    const written = rows.map((row): AiSuggestion => ({
      ...row,
      dedupe_key: row.dedupe_key ?? null,
      id: `00000000-0000-4000-8000-${String(++this.seq).padStart(12, '0')}`,
      chapter_id: chapterId,
      status: 'pending',
      edited: false,
      decided_by: null,
      decided_at: null,
      result_id: null,
      notified_at: null,
      created_at: NOW.toISOString(),
    }));
    this.rows.push(...written);
    return written;
  };
  listUnnotified = async (chapterId: string, batchId: string) =>
    this.rows.filter(
      (row) =>
        row.chapter_id === chapterId &&
        row.batch_id === batchId &&
        row.notified_at === null,
    );
  markNotified = async (_c: string, ids: readonly string[], now: string) => {
    for (const row of this.rows) {
      if (ids.includes(row.id)) row.notified_at = now;
    }
  };
  listPending = async (
    chapterId: string,
    query: ListPendingAiSuggestionsQuery,
  ) =>
    this.rows
      .filter(
        (row) =>
          row.chapter_id === chapterId &&
          row.status === 'pending' &&
          (query.permissions === null ||
            query.permissions.includes(row.required_permission)),
      )
      .slice(query.offset, query.offset + query.limit);
  findTakenDedupeKeys = async (chapterId: string, keys: readonly string[]) =>
    new Set(
      this.rows
        .filter(
          (row) =>
            row.chapter_id === chapterId &&
            row.dedupe_key !== null &&
            keys.includes(row.dedupe_key),
        )
        .map((row) => row.dedupe_key as string),
    );
  deletePending = async (chapterId: string, ids: readonly string[]) => {
    const before = this.rows.length;
    this.rows = this.rows.filter(
      (row) =>
        !(
          row.chapter_id === chapterId &&
          row.status === 'pending' &&
          ids.includes(row.id)
        ),
    );
    return before - this.rows.length;
  };
  findById = async (chapterId: string, id: string) =>
    this.rows.find((row) => row.chapter_id === chapterId && row.id === id) ??
    null;
  claim = async (chapterId: string, id: string, claim: AiSuggestionClaim) => {
    const row = await this.findById(chapterId, id);
    if (!row || row.status !== 'pending') return null;
    row.status = claim.status;
    row.decided_by = claim.decidedBy;
    row.decided_at = claim.now;
    if (claim.status === 'dismissed') {
      row.payload = {};
      row.quote = null;
    }
    return { ...row };
  };
  finishAccept = async (chapterId: string, id: string, resultId: string) => {
    const row = await this.findById(chapterId, id);
    if (!row || row.status !== 'accepting') return null;
    Object.assign(row, {
      status: 'accepted',
      payload: {},
      quote: null,
      result_id: resultId,
    });
    return { ...row };
  };
  release = async (chapterId: string, id: string) => {
    const row = await this.findById(chapterId, id);
    if (row) Object.assign(row, { status: 'pending', decided_at: null });
  };
}

interface FakeEvent {
  id: string;
  name: string;
  start_time: string;
  end_time: string;
  /** Left out of a member's list unless they may update events. */
  execOnly?: boolean;
  created_by?: string | null;
}

interface FakeTask {
  id: string;
  title: string;
  description: string | null;
  due_date: string;
  created_at: string;
  assignee_id: string;
  stored_status: TaskStatus;
  subtasks?: { title: string }[];
}

const at = (day: string, hour = 22) => `${day}T${hour}:00:00.000Z`;

const anEvent = (
  id: string,
  name: string,
  day: string,
  extra: Partial<FakeEvent> = {},
): FakeEvent => ({
  id,
  name,
  start_time: at(day),
  end_time: at(day, 23),
  ...extra,
});

const aTask = (
  id: string,
  title: string,
  due: string,
  extra: Partial<FakeTask> = {},
): FakeTask => ({
  id,
  title,
  description: null,
  due_date: due,
  created_at: `${due}T00:00:00.000Z`,
  assignee_id: MEMBER,
  stored_status: TaskStatus.COMPLETED,
  ...extra,
});

function build(
  options: {
    events?: FakeEvent[];
    tasks?: FakeTask[];
    askOn?: boolean;
    permissions?: Record<string, string[]>;
    modules?: Record<string, boolean>;
    chapterCreatedAt?: string;
    presidents?: string[];
  } = {},
) {
  const rows = new FakeRows();
  const state = {
    events: options.events ?? [],
    tasks: options.tasks ?? [],
    askOn: options.askOn ?? true,
  };
  const permissions = options.permissions ?? {
    [PRESIDENT]: ['*'],
    [SOCIAL_CHAIR]: ['members:view', 'events:create'],
    [MEMBER]: ['members:view'],
  };
  const holds = (userId: string, wanted: readonly string[]) => {
    const held = permissions[userId] ?? [];
    return held.includes('*') || wanted.some((p) => held.includes(p));
  };
  const rbac = {
    getEffectivePermissions: jest.fn(
      async (_c: string, userId: string) => permissions[userId] ?? [],
    ),
    memberHasAnyPermission: jest.fn(
      async (_c: string, userId: string, wanted: string[]) =>
        holds(userId, wanted),
    ),
  };
  const visible = (event: FakeEvent, viewerId?: string) =>
    !viewerId || !event.execOnly || holds(viewerId, ['events:update']);
  const events = {
    findByChapter: jest.fn(
      async (
        _c: string,
        viewerId: string | undefined,
        window: { endsAfter: string; startsBefore: string },
      ) =>
        state.events.filter(
          (event) =>
            event.end_time >= window.endsAfter &&
            event.start_time <= window.startsBefore &&
            visible(event, viewerId),
        ),
    ),
    findById: jest.fn(async (id: string, _c: string, viewerId?: string) => {
      const event = state.events.find((row) => row.id === id);
      if (!event || !visible(event, viewerId)) {
        throw new NotFoundException('Event not found');
      }
      return event;
    }),
  };
  const tasks = {
    list: jest.fn(async () => state.tasks),
    findById: jest.fn(async (id: string) => {
      const task = state.tasks.find((row) => row.id === id);
      if (!task) throw new NotFoundException('Task not found');
      return task;
    }),
    create: jest.fn(async (input: { title: string }) => ({
      id: '77777777-7777-4777-8777-777777777777',
      ...input,
    })),
  };
  const notifications = { notifyMembers: jest.fn(async () => undefined) };
  const analytics = {
    track: jest.fn(async () => undefined),
    trackForChapter: jest.fn(async () => undefined),
  };
  const chapters = {
    findById: jest.fn(async (id: string) => ({
      id,
      created_at: options.chapterCreatedAt ?? '2024-08-20T00:00:00.000Z',
      enabled_modules: options.modules ?? {},
    })),
  };
  const eventAccess = {
    sourceType: 'event' as const,
    filterOpenable: async (
      _c: string,
      userId: string,
      ids: readonly string[],
    ) =>
      new Set(
        ids.filter((id) => {
          const event = state.events.find((row) => row.id === id);
          return event !== undefined && visible(event, userId);
        }),
      ),
  };
  const suggestions = new AiSuggestionService(
    rows as never,
    [
      new TaskSuggestionKind(tasks as never),
      new EventSuggestionKind(events as never),
    ],
    [eventAccess, new TaskSuggestionSource(tasks as never, rbac as never)],
    rbac as never,
    notifications as never,
    analytics as never,
    chapters as never,
  );
  suggestions.now = () => NOW;
  const consent = {
    chapterSwitchOn: jest.fn(async () => state.askOn),
    chaptersWithSwitchOn: jest.fn(async () =>
      state.askOn ? [CHAPTER, OTHER_CHAPTER] : [],
    ),
  };
  const presidents = options.presidents ?? [PRESIDENT];
  const members = {
    findByChapter: jest.fn(async (chapterId: string) =>
      chapterId === CHAPTER
        ? [
            { user_id: MEMBER, role_ids: [] },
            ...presidents.map((user_id) => ({
              user_id,
              role_ids: [PRESIDENT_ROLE],
            })),
          ]
        : [{ user_id: MEMBER, role_ids: [] }],
    ),
  };
  const roles = {
    findByChapterAndSystemKey: jest.fn(async () => ({ id: PRESIDENT_ROLE })),
  };
  const runs = { enqueue: jest.fn(async () => ({ status: 'queued' })) };
  const registry = { register: jest.fn() };
  const service = new LastYearSuggestionsService(
    rows as never,
    chapters as never,
    members as never,
    roles as never,
    suggestions,
    consent as never,
    events as never,
    tasks as never,
    rbac as never,
    notifications as never,
    runs as never,
    registry as never,
  );
  const run = (actor: string = PRESIDENT) =>
    service.run({
      run: {
        id: RUN,
        chapter_id: CHAPTER,
        kind: LAST_YEAR_RUN_KIND,
        requested_by: null,
        acting_user_id: actor,
        attempt_count: 1,
        max_attempts: 3,
      },
      input: {},
      signal: new AbortController().signal,
    });
  return {
    service,
    suggestions,
    rows,
    state,
    events,
    tasks,
    notifications,
    analytics,
    consent,
    runs,
    registry,
    run,
  };
}

const LAST_YEAR = [
  anEvent(LAST_PHIL, 'Philanthropy Week', '2026-04-13'),
  anEvent(LAST_FORMAL, 'Spring Formal', '2026-04-04'),
];

describe('LastYearSuggestionsService', () => {
  beforeAll(() => {
    jest.useFakeTimers({ now: NOW, doNotFake: ['nextTick', 'setImmediate'] });
    process.env.AI_ENABLED = 'true';
  });
  afterAll(() => {
    jest.useRealTimers();
    delete process.env.AI_ENABLED;
  });

  it('registers as a run kind that acts for a member', () => {
    const { service, registry } = build();
    service.onModuleInit();
    expect(registry.register).toHaveBeenCalledWith(service);
    expect(service.actsForMember).toBe(true);
  });

  describe('a run', () => {
    it('raises what the chapter held then and has not planned now, sourced on last year’s record', async () => {
      const { run, rows } = build({
        events: [...LAST_YEAR, anEvent('f', 'Formal', '2027-04-03')],
      });
      await expect(run()).resolves.toEqual({ proposed: 1, withdrawn: 0 });
      expect(rows.rows).toHaveLength(1);
      expect(rows.rows[0]).toMatchObject({
        kind: 'event',
        source_type: 'event',
        source_id: LAST_PHIL,
        run_id: RUN,
        requested_for: PRESIDENT,
        required_permission: 'events:create',
        quote: 'Philanthropy Week',
        payload: {
          name: 'Philanthropy Week',
          last_year_at: at('2026-04-13'),
          times: 1,
        },
      });
      expect(rows.rows[0].dedupe_key).toMatch(/^[0-9a-f]{32}$/);
    });

    it('raises a finished task with no assignee, its checklist, and the same weekday this year', async () => {
      const { run, rows } = build({
        tasks: [
          aTask(LAST_CONTRACT, 'Submit the housing contract', '2026-03-20', {
            description: 'Signed copy to the housing office.',
            subtasks: [{ title: 'Get signatures' }, { title: 'Scan and send' }],
          }),
        ],
      });
      await run();
      expect(rows.rows[0]).toMatchObject({
        kind: 'task',
        source_type: 'task',
        source_id: LAST_CONTRACT,
        required_permission: 'tasks:manage',
        quote: 'Submit the housing contract',
        payload: {
          title: 'Submit the housing contract',
          description: 'Signed copy to the housing office.',
          assignee_id: null,
          due_date: '2027-03-19',
          due_at: null,
          subtasks: ['Get signatures', 'Scan and send'],
          last_year_on: '2026-03-20',
        },
      });
    });

    it('tells the president once, however many it raised', async () => {
      const { run, notifications } = build({ events: LAST_YEAR });
      await run();
      expect(notifications.notifyMembers).toHaveBeenCalledTimes(1);
      const [chapterId, to, payload] = notifications.notifyMembers.mock
        .calls[0] as unknown as [
        string,
        string[],
        { title: string; body: string; data: { target: { screen: string } } },
      ];
      expect(chapterId).toBe(CHAPTER);
      expect(to).toEqual([PRESIDENT]);
      expect(payload.title).toBe('This time last year');
      expect(payload.body).toContain('2 things');
      expect(payload.data.target.screen).toBe('ai_suggestions');
    });

    it('raises nothing, and tells nobody, when this year already has it all', async () => {
      const { run, rows, notifications } = build({
        events: [
          ...LAST_YEAR,
          anEvent('p', 'Philanthropy Week 2027', '2027-04-12'),
          anEvent('f', 'Formal', '2027-04-03'),
        ],
      });
      await expect(run()).resolves.toEqual({ proposed: 0, withdrawn: 0 });
      expect(rows.rows).toEqual([]);
      expect(notifications.notifyMembers).not.toHaveBeenCalled();
    });

    it('a chapter with under a year of history gets nothing, silently', async () => {
      const { run, rows, notifications } = build({
        events: [anEvent('new', 'Chapter Meeting', '2027-03-01')],
        tasks: [aTask('t', 'Order shirts', '2027-03-02')],
      });
      await expect(run()).resolves.toEqual({ proposed: 0, withdrawn: 0 });
      expect(rows.rows).toEqual([]);
      expect(notifications.notifyMembers).not.toHaveBeenCalled();
    });

    it('raises a thing once a year: dismissed, it does not come back next week', async () => {
      const { run, rows, suggestions } = build({
        events: LAST_YEAR.slice(0, 1),
      });
      await run();
      await suggestions.dismiss(
        CHAPTER,
        PRESIDENT,
        rows.rows[0].id,
        'already_doing',
      );
      await expect(run()).resolves.toEqual({ proposed: 0, withdrawn: 0 });
      expect(rows.rows).toHaveLength(1);
      expect(rows.rows[0]).toMatchObject({ status: 'dismissed', payload: {} });
    });

    it('says why a dismissal was "already doing it" in the event, and stores nothing', async () => {
      const { run, rows, suggestions, analytics } = build({
        events: LAST_YEAR.slice(0, 1),
      });
      await run();
      await suggestions.dismiss(
        CHAPTER,
        PRESIDENT,
        rows.rows[0].id,
        'already_doing',
      );
      expect(analytics.track).toHaveBeenCalledWith(
        'ai-suggestion-dismissed',
        PRESIDENT,
        {
          chapterId: CHAPTER,
          properties: { kind: 'event', reason: 'already_doing' },
        },
      );
      expect(JSON.stringify(rows.rows[0])).not.toContain('already_doing');
    });

    it('takes back a waiting suggestion once the thing shows up on this year’s calendar', async () => {
      const { run, rows, state } = build({ events: LAST_YEAR.slice(0, 1) });
      await run();
      expect(rows.rows).toHaveLength(1);
      state.events.push(anEvent('p', 'Philanthropy week', '2027-04-12'));
      await expect(run()).resolves.toEqual({ proposed: 0, withdrawn: 1 });
      expect(rows.rows).toEqual([]);
    });

    it('raises at most three in a week, the soonest first, and none while five wait', async () => {
      const names = [
        'Parents Weekend',
        'Alumni Golf Outing',
        'Senior Dinner',
        'Highway Cleanup',
        'Blood Drive',
        'Faculty Mixer',
        'Car Wash',
      ];
      const { run, rows } = build({
        events: names.map((name, index) =>
          anEvent(
            `0000000${index}-0000-4000-8000-000000000000`,
            name,
            `2026-03-${String(12 + index).padStart(2, '0')}`,
          ),
        ),
      });
      await expect(run()).resolves.toMatchObject({ proposed: 3 });
      expect(rows.rows.map((row) => row.payload.name)).toEqual(
        names.slice(0, 3),
      );
      // Next week: two more reach the cap of five waiting.
      await expect(run()).resolves.toMatchObject({ proposed: 2 });
      await expect(run()).resolves.toMatchObject({ proposed: 0 });
      expect(rows.rows).toHaveLength(5);
    });

    it('reads last year as the member it acts for: an event they could not open is not raised', async () => {
      const { run, rows } = build({
        events: [
          anEvent(EXEC_RETREAT, 'Exec Retreat', '2026-03-28', {
            execOnly: true,
          }),
        ],
      });
      await expect(run(SOCIAL_CHAIR)).resolves.toEqual({
        proposed: 0,
        withdrawn: 0,
      });
      expect(rows.rows).toEqual([]);
    });

    it('stays quiet about something planned for a group the member is not in', async () => {
      const { run, rows } = build({
        events: [
          anEvent(LAST_PHIL, 'Philanthropy Week', '2026-04-13'),
          anEvent('p', 'Philanthropy Week', '2027-04-12', { execOnly: true }),
        ],
      });
      await run(SOCIAL_CHAIR);
      expect(rows.rows).toEqual([]);
    });

    it('raises no tasks for a member who does not manage tasks, and no events with events off', async () => {
      const input = {
        events: LAST_YEAR.slice(0, 1),
        tasks: [
          aTask(LAST_CONTRACT, 'Submit the housing contract', '2026-03-20'),
        ],
      };
      const chair = build(input);
      await chair.run(SOCIAL_CHAIR);
      expect(chair.rows.rows.map((row) => row.kind)).toEqual(['event']);

      const eventsOff = build({ ...input, modules: { events: false } });
      await eventsOff.run();
      expect(eventsOff.rows.rows.map((row) => row.kind)).toEqual(['task']);
    });

    it('fails without reading anything when the president has turned Ask off', async () => {
      const { run, events, tasks } = build({ events: LAST_YEAR, askOn: false });
      await expect(run()).rejects.toMatchObject({
        reason: 'ai_unavailable',
        retryable: false,
      });
      await expect(run()).rejects.toBeInstanceOf(AiRunFailure);
      expect(events.findByChapter).not.toHaveBeenCalled();
      expect(tasks.list).not.toHaveBeenCalled();
    });
  });

  describe('who sees and decides one', () => {
    it('lists an event suggestion for an officer who can add events, and not for a member', async () => {
      const { run, suggestions } = build({ events: LAST_YEAR.slice(0, 1) });
      await run();
      const chair = await suggestions.listForUser(CHAPTER, SOCIAL_CHAIR, {
        enabledModules: {},
      });
      expect(chair.items).toHaveLength(1);
      const member = await suggestions.listForUser(CHAPTER, MEMBER, {
        enabledModules: {},
      });
      expect(member.items).toEqual([]);
    });

    it('accepting an event records the event the officer added, and makes none', async () => {
      const { run, rows, suggestions, state, tasks } = build({
        events: LAST_YEAR.slice(0, 1),
      });
      await run();
      const id = rows.rows[0].id;
      // No event named: nothing to record yet.
      await expect(
        suggestions.accept(CHAPTER, SOCIAL_CHAIR, id, { enabledModules: {} }),
      ).rejects.toBeInstanceOf(BadRequestException);

      state.events.push(
        anEvent(NEW_EVENT, 'Philanthropy Week', '2027-04-12', {
          created_by: SOCIAL_CHAIR,
        }),
      );
      const decided = await suggestions.accept(CHAPTER, SOCIAL_CHAIR, id, {
        edits: { kind: 'event', fields: { event_id: NEW_EVENT } },
        enabledModules: {},
      });
      expect(decided.result).toEqual({ kind: 'event', id: NEW_EVENT });
      expect(rows.rows[0]).toMatchObject({
        status: 'accepted',
        payload: {},
        quote: null,
        result_id: NEW_EVENT,
      });
      expect(tasks.create).not.toHaveBeenCalled();
    });

    it('refuses to record an event someone else added, and leaves the suggestion waiting', async () => {
      const { run, rows, suggestions, state } = build({
        events: LAST_YEAR.slice(0, 1),
      });
      await run();
      state.events.push(
        anEvent(NEW_EVENT, 'Brotherhood Dinner', '2027-04-12', {
          created_by: PRESIDENT,
        }),
      );
      await expect(
        suggestions.accept(CHAPTER, SOCIAL_CHAIR, rows.rows[0].id, {
          edits: { kind: 'event', fields: { event_id: NEW_EVENT } },
          enabledModules: {},
        }),
      ).rejects.toMatchObject({
        response: { code: 'ai.suggestion.not_your_event' },
      });
      expect(rows.rows[0].status).toBe('pending');
    });

    it('accepting a task makes it through the task service, with who and when from the officer', async () => {
      const { run, rows, suggestions, tasks } = build({
        tasks: [
          aTask(LAST_CONTRACT, 'Submit the housing contract', '2026-03-20'),
        ],
      });
      await run();
      await suggestions.accept(CHAPTER, PRESIDENT, rows.rows[0].id, {
        edits: { kind: 'task', fields: { assignee_id: MEMBER } },
        enabledModules: {},
      });
      expect(tasks.create).toHaveBeenCalledWith(
        expect.objectContaining({
          title: 'Submit the housing contract',
          assignee_id: MEMBER,
          due_date: '2027-03-19',
          created_by: PRESIDENT,
          point_reward: null,
        }),
      );
      expect(tasks.create.mock.calls[0][0]).not.toHaveProperty('last_year_on');
    });
  });

  describe('the weekly sweep', () => {
    it('queues one run a week per chapter with Ask on and a president, acting for the president', async () => {
      const { service, runs } = build();
      await expect(service.sweep(NOW)).resolves.toBe(1);
      expect(runs.enqueue).toHaveBeenCalledTimes(1);
      expect(runs.enqueue).toHaveBeenCalledWith({
        chapterId: CHAPTER,
        kind: LAST_YEAR_RUN_KIND,
        dedupeKey: `last-year:${CHAPTER}:w${lastYearWeekIndex(NOW)}`,
        requestedBy: null,
        actingUserId: PRESIDENT,
        input: { week: lastYearWeekIndex(NOW) },
      });
      // The next day, same week: nothing more to do.
      await service.sweep(new Date(NOW.getTime() + 24 * 3600_000));
      expect(runs.enqueue).toHaveBeenCalledTimes(1);
      // The next week: again.
      await service.sweep(new Date(NOW.getTime() + 7 * 24 * 3600_000));
      expect(runs.enqueue).toHaveBeenCalledTimes(2);
    });

    it('starts a week on Monday', () => {
      const sunday = new Date('2027-03-07T23:59:59.000Z');
      const monday = new Date('2027-03-08T00:00:00.000Z');
      expect(lastYearWeekIndex(monday)).toBe(lastYearWeekIndex(sunday) + 1);
    });

    it('queues nothing for a chapter too young to have a last year', async () => {
      const { service, runs } = build({
        chapterCreatedAt: '2026-11-06T00:00:00.000Z',
      });
      await expect(service.sweep(NOW)).resolves.toBe(0);
      expect(runs.enqueue).not.toHaveBeenCalled();
    });

    it('queues nothing with Ask off in every chapter, or AI off on the server', async () => {
      const off = build({ askOn: false });
      await expect(off.service.sweep(NOW)).resolves.toBe(0);

      const { service, runs, consent } = build();
      delete process.env.AI_ENABLED;
      try {
        await expect(service.sweep(NOW)).resolves.toBe(0);
        expect(consent.chaptersWithSwitchOn).not.toHaveBeenCalled();
        expect(runs.enqueue).not.toHaveBeenCalled();
      } finally {
        process.env.AI_ENABLED = 'true';
      }
    });

    it('keeps going when one chapter cannot be queued, and tries it again the next day', async () => {
      const { service, runs } = build();
      runs.enqueue.mockRejectedValueOnce(new Error('database is down'));
      await expect(service.sweep(NOW)).resolves.toBe(0);
      await expect(
        service.sweep(new Date(NOW.getTime() + 24 * 3600_000)),
      ).resolves.toBe(1);
    });
  });
});
