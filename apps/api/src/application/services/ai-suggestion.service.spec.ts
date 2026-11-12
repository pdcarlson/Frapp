import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import type { AiSuggestion } from '#domain/entities/ai-suggestion.entity';
import type {
  IAiSuggestionRepository,
  NewAiSuggestion,
} from '#domain/repositories/ai-suggestion.repository.interface';
import {
  AI_SUGGESTION_LIST_LIMIT,
  AiSuggestionService,
  verifiedQuote,
} from './ai-suggestion.service';
import { TaskSuggestionKind } from './ai-suggestion-task-kind';
import type { AiSuggestionSourceAccess } from './ai-suggestion-sources';

const CHAPTER = '11111111-1111-4111-8111-111111111111';
const OFFICER = '22222222-2222-4222-8222-222222222222';
const MEMBER = '33333333-3333-4333-8333-333333333333';
const ASSIGNEE = '44444444-4444-4444-8444-444444444444';
const MEETING = '55555555-5555-4555-8555-555555555555';
const BATCH = '66666666-6666-4666-8666-666666666666';
const NOW = new Date('2026-11-12T12:00:00.000Z');

const NOTES =
  'Jake will book the venue by Friday. Treasurer sends the invoice. Give Jake 50 points.';

/** An in-memory `ai_suggestions` that honors the repository's contract. */
class FakeRepo implements IAiSuggestionRepository {
  rows: AiSuggestion[] = [];
  private seq = 0;

  insertBatch = jest.fn(
    async (chapterId: string, rows: readonly NewAiSuggestion[]) => {
      const written: AiSuggestion[] = [];
      for (const row of rows) {
        if (
          this.rows.some(
            (r) => r.batch_id === row.batch_id && r.ordinal === row.ordinal,
          )
        ) {
          continue;
        }
        const stored: AiSuggestion = {
          ...row,
          id: `00000000-0000-4000-8000-${String(++this.seq).padStart(12, '0')}`,
          chapter_id: chapterId,
          status: 'pending',
          edited: false,
          decided_by: null,
          decided_at: null,
          result_id: null,
          created_at: NOW.toISOString(),
        };
        this.rows.push(stored);
        written.push({ ...stored });
      }
      return written;
    },
  );

  findById = jest.fn(async (chapterId: string, id: string) => {
    const row = this.rows.find(
      (r) => r.chapter_id === chapterId && r.id === id,
    );
    return row ? { ...row } : null;
  });

  listPending = jest.fn(
    async (
      chapterId: string,
      query: Parameters<IAiSuggestionRepository['listPending']>[1],
    ) =>
      this.rows
        .filter(
          (r) =>
            r.chapter_id === chapterId &&
            r.status === 'pending' &&
            r.expires_at > query.now &&
            (!query.permissions ||
              query.permissions.includes(r.required_permission)) &&
            (!query.source ||
              (r.source_type === query.source.type &&
                r.source_id === query.source.id)),
        )
        .slice(0, query.limit)
        .map((r) => ({ ...r })),
  );

  claim = jest.fn(
    async (
      chapterId: string,
      id: string,
      decision: Parameters<IAiSuggestionRepository['claim']>[2],
    ) => {
      const row = this.rows.find(
        (r) =>
          r.chapter_id === chapterId &&
          r.id === id &&
          r.status === 'pending' &&
          r.expires_at > decision.now,
      );
      if (!row) return null;
      Object.assign(row, {
        status: decision.status,
        decided_by: decision.decidedBy,
        decided_at: decision.now,
        edited: decision.edited,
        payload: {},
        quote: null,
        quote_author_id: null,
      });
      return { ...row };
    },
  );

  release = jest.fn(
    async (
      chapterId: string,
      id: string,
      original: Pick<AiSuggestion, 'payload' | 'quote' | 'quote_author_id'>,
    ) => {
      const row = this.rows.find(
        (r) =>
          r.chapter_id === chapterId &&
          r.id === id &&
          r.status === 'accepted' &&
          !r.result_id,
      );
      if (row) {
        Object.assign(row, original, {
          status: 'pending',
          decided_by: null,
          decided_at: null,
          edited: false,
        });
      }
    },
  );

  setResult = jest.fn(
    async (chapterId: string, id: string, resultId: string) => {
      const row = this.rows.find(
        (r) => r.chapter_id === chapterId && r.id === id,
      );
      if (row) row.result_id = resultId;
    },
  );

  expireDue = jest.fn(async (now: string) => {
    const due = this.rows.filter(
      (r) => r.status === 'pending' && r.expires_at <= now,
    );
    for (const row of due) {
      Object.assign(row, {
        status: 'expired',
        payload: {},
        quote: null,
        quote_author_id: null,
      });
    }
    return due.map((r) => ({ chapter_id: r.chapter_id, kind: r.kind }));
  });
}

function build(
  options: { permissions?: Record<string, string[]>; openable?: string[] } = {},
) {
  const repo = new FakeRepo();
  const permissions: Record<string, string[]> = options.permissions ?? {
    [OFFICER]: ['members:view', 'tasks:manage'],
    [MEMBER]: ['members:view'],
  };
  const rbac = {
    getEffectivePermissions: jest.fn(
      async (_c: string, userId: string) => permissions[userId] ?? [],
    ),
    memberHasAnyPermission: jest.fn(
      async (_c: string, userId: string, wanted: string[]) => {
        const held = permissions[userId] ?? [];
        return held.includes('*') || wanted.some((p) => held.includes(p));
      },
    ),
  };
  const tasks = {
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
  const openable = new Set(options.openable ?? [MEETING]);
  const meetingAccess: AiSuggestionSourceAccess = {
    sourceType: 'meeting',
    filterOpenable: jest.fn(
      async (_c: string, _u: string, ids: readonly string[]) =>
        new Set(ids.filter((id) => openable.has(id))),
    ),
  };
  const service = new AiSuggestionService(
    repo,
    [new TaskSuggestionKind(tasks as never)],
    [meetingAccess],
    rbac as never,
    notifications as never,
    analytics as never,
  );
  service.now = () => NOW;
  return {
    service,
    repo,
    rbac,
    tasks,
    notifications,
    analytics,
    meetingAccess,
    openable,
  };
}

const taskProposal = (title: string, extra: Record<string, unknown> = {}) => ({
  kind: 'task' as const,
  payload: {
    title,
    assignee_id: ASSIGNEE,
    due_date: '2026-11-14',
    ...extra,
  },
});

async function proposeTen(service: AiSuggestionService) {
  return service.proposeBatch({
    chapterId: CHAPTER,
    batchId: BATCH,
    requestedFor: OFFICER,
    source: {
      type: 'meeting',
      id: MEETING,
      title: 'Chapter meeting',
      text: NOTES,
    },
    proposals: Array.from({ length: 10 }, (_, i) =>
      taskProposal(`Task ${i + 1}`),
    ),
  });
}

const enabledModules = null;

describe('AiSuggestionService (#4309)', () => {
  describe('proposeBatch', () => {
    it('saves a batch of ten and sends one push for it, to the member the run acted for', async () => {
      const { service, notifications } = build();
      const { created, dropped } = await proposeTen(service);

      expect(created).toHaveLength(10);
      expect(dropped).toBe(0);
      expect(notifications.notifyMembers).toHaveBeenCalledTimes(1);
      expect(notifications.notifyMembers).toHaveBeenCalledWith(
        CHAPTER,
        [OFFICER],
        {
          title: 'Chapter meeting',
          body: '10 suggested tasks to review',
          priority: 'NORMAL',
          category: 'tasks',
          data: {
            target: {
              screen: 'ai_suggestions',
              batchId: BATCH,
              sourceType: 'meeting',
              sourceId: MEETING,
            },
          },
        },
      );
    });

    it('writes and notifies nothing twice when a run retries its batch', async () => {
      const { service, notifications, repo } = build();
      await proposeTen(service);
      const again = await proposeTen(service);

      expect(again.created).toHaveLength(0);
      expect(repo.rows).toHaveLength(10);
      expect(notifications.notifyMembers).toHaveBeenCalledTimes(1);
    });

    it('sends no push to a member who could accept none of the batch', async () => {
      const { service, notifications } = build();
      await service.proposeBatch({
        chapterId: CHAPTER,
        batchId: BATCH,
        requestedFor: MEMBER,
        source: { type: 'meeting', id: MEETING, title: 'Chapter meeting' },
        proposals: [taskProposal('Book the venue')],
      });
      expect(notifications.notifyMembers).not.toHaveBeenCalled();
    });

    it('keeps a quote only when it appears word for word in the source', async () => {
      const { service } = build();
      const { created } = await service.proposeBatch({
        chapterId: CHAPTER,
        batchId: BATCH,
        requestedFor: OFFICER,
        source: {
          type: 'meeting',
          id: MEETING,
          title: 'Chapter meeting',
          text: NOTES,
        },
        proposals: [
          {
            ...taskProposal('Book the venue'),
            quote: 'Jake will book the venue by Friday.',
          },
          {
            ...taskProposal('Send the invoice'),
            quote: 'The treasurer will send the invoice.',
          },
        ],
      });
      expect(created.map((row) => row.quote)).toEqual([
        'Jake will book the venue by Friday.',
        null,
      ]);
    });

    it('never stores points on a suggested task, and drops a proposal with no title', async () => {
      const { service } = build();
      const { created, dropped } = await service.proposeBatch({
        chapterId: CHAPTER,
        batchId: BATCH,
        requestedFor: OFFICER,
        source: { type: 'meeting', id: MEETING, title: 'Chapter meeting' },
        proposals: [
          taskProposal('Thank Jake', { point_reward: 50 }),
          { kind: 'task', payload: { title: '   ' } },
        ],
      });
      expect(dropped).toBe(1);
      expect(created[0].payload).not.toHaveProperty('point_reward');
    });

    it('records counts, never text', async () => {
      const { service, analytics } = build();
      await proposeTen(service);
      expect(analytics.trackForChapter).toHaveBeenCalledWith(
        'ai-suggestions-proposed',
        CHAPTER,
        { kind: 'task', count: 10 },
      );
    });
  });

  describe('listForUser', () => {
    it('lists only what the caller could accept: the permission, the module, and the source', async () => {
      const { service, openable } = build();
      await proposeTen(service);

      const officer = await service.listForUser(CHAPTER, OFFICER, {
        enabledModules,
      });
      expect(officer.items).toHaveLength(10);

      const member = await service.listForUser(CHAPTER, MEMBER, {
        enabledModules,
      });
      expect(member.items).toHaveLength(0);

      const tasksOff = await service.listForUser(CHAPTER, OFFICER, {
        enabledModules: { tasks: false },
      });
      expect(tasksOff.items).toHaveLength(0);

      openable.delete(MEETING);
      const cantOpen = await service.listForUser(CHAPTER, OFFICER, {
        enabledModules,
      });
      expect(cantOpen.items).toHaveLength(0);
    });

    it('shows a source type with no access checker to nobody, not even the wildcard', async () => {
      const { service, repo } = build({ permissions: { [OFFICER]: ['*'] } });
      await service.proposeBatch({
        chapterId: CHAPTER,
        batchId: BATCH,
        requestedFor: OFFICER,
        source: { type: 'channel', id: MEETING, title: 'general' },
        proposals: [taskProposal('Book the venue')],
      });
      expect(repo.rows).toHaveLength(1);
      const list = await service.listForUser(CHAPTER, OFFICER, {
        enabledModules,
      });
      expect(list.items).toHaveLength(0);
    });

    it('says when there are more than one list returns', async () => {
      const { service } = build();
      await service.proposeBatch({
        chapterId: CHAPTER,
        batchId: BATCH,
        requestedFor: OFFICER,
        source: { type: 'meeting', id: MEETING, title: 'Chapter meeting' },
        proposals: Array.from({ length: AI_SUGGESTION_LIST_LIMIT }, (_, i) =>
          taskProposal(`T${i}`),
        ),
      });
      await service.proposeBatch({
        chapterId: CHAPTER,
        batchId: '88888888-8888-4888-8888-888888888888',
        requestedFor: OFFICER,
        source: { type: 'meeting', id: MEETING, title: 'Chapter meeting' },
        proposals: [taskProposal('One more')],
      });
      const list = await service.listForUser(CHAPTER, OFFICER, {
        enabledModules,
      });
      expect(list.items).toHaveLength(AI_SUGGESTION_LIST_LIMIT);
      expect(list.has_more).toBe(true);
    });
  });

  describe('accept', () => {
    it('creates the task through the task service, as the accepter, with no points and no chat card', async () => {
      const { service, tasks, repo } = build();
      const { created } = await proposeTen(service);

      const decided = await service.accept(CHAPTER, OFFICER, created[0].id, {
        enabledModules,
      });

      expect(tasks.create).toHaveBeenCalledWith({
        chapter_id: CHAPTER,
        title: 'Task 1',
        description: null,
        assignee_id: ASSIGNEE,
        created_by: OFFICER,
        due_date: '2026-11-14',
        due_at: null,
        subtasks: [],
        point_reward: null,
      });
      const call = tasks.create.mock.calls[0][0] as unknown as Record<
        string,
        unknown
      >;
      expect(call).not.toHaveProperty('channel_id');
      expect(decided.result).toEqual({
        kind: 'task',
        id: '77777777-7777-4777-8777-777777777777',
      });
      const stored = repo.rows.find((row) => row.id === created[0].id)!;
      expect(stored).toMatchObject({
        status: 'accepted',
        decided_by: OFFICER,
        edited: false,
        result_id: '77777777-7777-4777-8777-777777777777',
        payload: {},
        quote: null,
      });
    });

    it('refuses someone who lacks the permission now, even if they held it when it was made', async () => {
      const permissions = { [OFFICER]: ['members:view', 'tasks:manage'] };
      const { service, tasks } = build({ permissions });
      const { created } = await proposeTen(service);

      permissions[OFFICER] = ['members:view']; // the role was taken away
      await expect(
        service.accept(CHAPTER, OFFICER, created[0].id, { enabledModules }),
      ).rejects.toBeInstanceOf(ForbiddenException);
      expect(tasks.create).not.toHaveBeenCalled();
    });

    it('reads as missing to someone who can no longer open its source', async () => {
      const { service, openable } = build();
      const { created } = await proposeTen(service);
      openable.delete(MEETING);
      await expect(
        service.accept(CHAPTER, OFFICER, created[0].id, { enabledModules }),
      ).rejects.toBeInstanceOf(NotFoundException);
    });

    it('applies the officer’s edits and records that it was edited', async () => {
      const { service, tasks, analytics, repo } = build();
      const { created } = await proposeTen(service);
      await service.accept(CHAPTER, OFFICER, created[0].id, {
        enabledModules,
        edits: {
          kind: 'task',
          fields: { title: 'Book the hall', subtasks: ['Call', 'Pay deposit'] },
        },
      });
      expect(tasks.create).toHaveBeenCalledWith(
        expect.objectContaining({
          title: 'Book the hall',
          subtasks: ['Call', 'Pay deposit'],
        }),
      );
      expect(repo.rows.find((row) => row.id === created[0].id)!.edited).toBe(
        true,
      );
      expect(analytics.track).toHaveBeenCalledWith(
        'ai-suggestion-accepted',
        OFFICER,
        {
          chapterId: CHAPTER,
          properties: { kind: 'task', edited: true },
        },
      );
    });

    it('asks for an owner before it changes anything when none was suggested', async () => {
      const { service, tasks, repo } = build();
      const { created } = await service.proposeBatch({
        chapterId: CHAPTER,
        batchId: BATCH,
        requestedFor: OFFICER,
        source: { type: 'meeting', id: MEETING, title: 'Chapter meeting' },
        proposals: [
          {
            kind: 'task',
            payload: { title: 'Order shirts', due_date: '2026-11-20' },
          },
        ],
      });
      await expect(
        service.accept(CHAPTER, OFFICER, created[0].id, { enabledModules }),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(tasks.create).not.toHaveBeenCalled();
      expect(repo.rows[0].status).toBe('pending');

      await service.accept(CHAPTER, OFFICER, created[0].id, {
        enabledModules,
        edits: { kind: 'task', fields: { assignee_id: ASSIGNEE } },
      });
      expect(tasks.create).toHaveBeenCalledWith(
        expect.objectContaining({
          assignee_id: ASSIGNEE,
          due_date: '2026-11-20',
        }),
      );
    });

    it('puts the suggestion back, text and all, when the task service refuses', async () => {
      const { service, tasks, repo } = build();
      const { created } = await proposeTen(service);
      tasks.create.mockRejectedValueOnce(
        new BadRequestException('Assignee must be a member of the chapter'),
      );
      await expect(
        service.accept(CHAPTER, OFFICER, created[0].id, { enabledModules }),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(repo.rows[0]).toMatchObject({
        status: 'pending',
        decided_by: null,
        payload: expect.objectContaining({ title: 'Task 1' }),
      });
    });

    it('answers a double tap with the first outcome, and someone else with a 409', async () => {
      const permissions = {
        [OFFICER]: ['tasks:manage'],
        [MEMBER]: ['tasks:manage'],
      };
      const { service, tasks } = build({ permissions });
      const { created } = await proposeTen(service);
      const first = await service.accept(CHAPTER, OFFICER, created[0].id, {
        enabledModules,
      });
      const again = await service.accept(CHAPTER, OFFICER, created[0].id, {
        enabledModules,
      });
      expect(again.result).toEqual(first.result);
      expect(tasks.create).toHaveBeenCalledTimes(1);

      await expect(
        service.accept(CHAPTER, MEMBER, created[0].id, { enabledModules }),
      ).rejects.toBeInstanceOf(ConflictException);
    });

    it('refuses when the tasks module is off', async () => {
      const { service, tasks } = build();
      const { created } = await proposeTen(service);
      await expect(
        service.accept(CHAPTER, OFFICER, created[0].id, {
          enabledModules: { tasks: false },
        }),
      ).rejects.toBeInstanceOf(ForbiddenException);
      expect(tasks.create).not.toHaveBeenCalled();
    });
  });

  describe('dismiss and decideMany', () => {
    it('dismisses without making anything, and empties its text', async () => {
      const { service, tasks, repo, analytics } = build();
      const { created } = await proposeTen(service);
      const decided = await service.dismiss(CHAPTER, OFFICER, created[0].id);
      expect(decided.result).toBeNull();
      expect(tasks.create).not.toHaveBeenCalled();
      expect(repo.rows[0]).toMatchObject({
        status: 'dismissed',
        payload: {},
        quote: null,
      });
      expect(analytics.track).toHaveBeenCalledWith(
        'ai-suggestion-dismissed',
        OFFICER,
        {
          chapterId: CHAPTER,
          properties: { kind: 'task' },
        },
      );
    });

    it('decides a review screen’s worth at once, each with its own outcome', async () => {
      const { service, tasks } = build();
      const { created } = await proposeTen(service);
      await service.dismiss(CHAPTER, OFFICER, created[2].id);
      const outcomes = await service.decideMany(
        CHAPTER,
        OFFICER,
        [
          { id: created[0].id, action: 'accept' },
          { id: created[1].id, action: 'dismiss' },
          { id: created[2].id, action: 'accept' },
        ],
        enabledModules,
      );
      expect(outcomes.map((o) => o.ok)).toEqual([true, true, false]);
      expect(outcomes[2]).toMatchObject({
        status: 409,
        code: 'ai.suggestion.decided',
      });
      expect(tasks.create).toHaveBeenCalledTimes(1);
    });
  });

  describe('expireDue', () => {
    it('expires what nobody decided, empties its text, and counts it without text', async () => {
      const { service, repo, analytics } = build();
      await proposeTen(service);
      service.now = () => new Date(NOW.getTime() + 15 * 24 * 60 * 60 * 1000);

      expect(await service.expireDue()).toBe(10);
      expect(
        repo.rows.every(
          (row) => row.status === 'expired' && row.quote === null,
        ),
      ).toBe(true);
      expect(analytics.trackForChapter).toHaveBeenCalledWith(
        'ai-suggestions-expired',
        CHAPTER,
        {
          kind: 'task',
          count: 10,
        },
      );
    });

    it('refuses to accept one whose time is up before the sweep reaches it', async () => {
      const { service } = build();
      const { created } = await proposeTen(service);
      service.now = () => new Date(NOW.getTime() + 15 * 24 * 60 * 60 * 1000);
      await expect(
        service.accept(CHAPTER, OFFICER, created[0].id, { enabledModules }),
      ).rejects.toMatchObject({ response: { code: 'ai.suggestion.expired' } });
    });
  });
});

describe('verifiedQuote', () => {
  it('keeps only an exact, non-empty, bounded span of the source', () => {
    expect(verifiedQuote('book the venue', NOTES)).toBe('book the venue');
    expect(verifiedQuote('Book the venue', NOTES)).toBeNull();
    expect(verifiedQuote('', NOTES)).toBeNull();
    expect(verifiedQuote('book the venue', null)).toBeNull();
    expect(verifiedQuote('x'.repeat(1001), 'x'.repeat(2000))).toBeNull();
  });
});
