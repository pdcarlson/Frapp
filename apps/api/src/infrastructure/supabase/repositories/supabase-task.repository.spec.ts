import { SupabaseTaskRepository } from './supabase-task.repository';
import { TaskStatus } from '#domain/entities/task.entity';
import {
  CHAPTER_A,
  CHAPTER_B,
  USER_SHARED,
  createTenantHarness,
  inA,
  inB,
  type TenantHarness,
} from '#test/helpers/tenant-scope.harness';

/**
 * Tenant scope for `tasks`. `use-tasks` is one of the hooks due to migrate onto
 * `createChapterQueryKeys` in `packages/hooks`, so this is a repository whose
 * call sites are about to move.
 */

const TASK_A = '0a000000-0000-4000-8000-000000000060';
const TASK_B = '0b000000-0000-4000-8000-000000000060';

const seed = () => ({
  tasks: [
    inA({
      id: TASK_A,
      title: 'Collect dues',
      description: null,
      assignee_id: USER_SHARED,
      created_by: USER_SHARED,
      due_date: '2026-09-01',
      status: 'TODO',
      point_reward: 5,
      points_awarded: 0,
      completed_at: null,
      confirmed_at: null,
      created_at: '2026-01-01T00:00:00.000Z',
    }),
    inB({
      id: TASK_B,
      title: 'Collect dues',
      description: null,
      assignee_id: USER_SHARED,
      created_by: USER_SHARED,
      due_date: '2026-09-01',
      status: 'TODO',
      point_reward: 5,
      points_awarded: 0,
      completed_at: null,
      confirmed_at: null,
      created_at: '2026-01-01T00:00:00.000Z',
    }),
  ],
});

describe('SupabaseTaskRepository — tenant scope', () => {
  let harness: TenantHarness;
  let repo: SupabaseTaskRepository;

  beforeEach(() => {
    harness = createTenantHarness({ tables: seed() });
    repo = new SupabaseTaskRepository(harness.client);
  });

  it('findByChapter returns only the caller chapter tasks', async () => {
    const tasks = await harness.expectTenantScoped(CHAPTER_B, () =>
      repo.findByChapter(CHAPTER_B),
    );

    expect(tasks.map((t) => t.id)).toEqual([TASK_B]);
  });

  it.each([
    ['assignee', { assigneeId: USER_SHARED }],
    ['not-assignee', { notAssigneeId: '0c000000-0000-4000-8000-000000000060' }],
    ['creator', { createdBy: USER_SHARED }],
    ['status', { status: TaskStatus.TODO }],
    ['unconfirmed', { confirmed: false }],
    ['page', { limit: 10 }],
    [
      'cursor',
      {
        after: {
          created_at: '2026-02-01T00:00:00.000Z',
          id: 'ffffffff-ffff-4fff-8fff-ffffffffffff',
        },
        limit: 10,
      },
    ],
  ] as const)(
    'findByChapter keeps the chapter predicate with the %s filter (#4037)',
    async (_name, query) => {
      const tasks = await harness.expectTenantScoped(CHAPTER_B, () =>
        repo.findByChapter(CHAPTER_B, { ...query }),
      );

      expect(tasks.map((t) => t.id)).toEqual([TASK_B]);
    },
  );

  describe('findByChapter past the 1,000-row cap (#4037)', () => {
    /**
     * 2,500 tasks in each chapter (the harness pairs twins); the first 1,500
     * share one `created_at`, as one transaction's inserts do.
     */
    const many = () =>
      Array.from({ length: 2500 }, (_, index) => {
        const n = String(index).padStart(12, '0');
        return [inA, inB].map((scope, side) =>
          scope({
            id: `0${side === 0 ? 'a' : 'b'}000000-0000-4000-9000-${n}`,
            title: `Task ${index}`,
            description: null,
            assignee_id: USER_SHARED,
            created_by: USER_SHARED,
            due_date: '2026-09-01',
            status: 'TODO',
            point_reward: null,
            points_awarded: 0,
            completed_at: null,
            confirmed_at: index % 2 === 0 ? '2026-03-01T00:00:00.000Z' : null,
            created_at:
              index < 1500
                ? '2026-01-01T00:00:00.000Z'
                : `2026-02-01T00:00:${String(index % 60).padStart(2, '0')}.${String(index).padStart(6, '0')}Z`,
          }),
        );
      }).flat();

    beforeEach(() => {
      // The database answers at most 1,000 rows a request, as PostgREST does.
      harness = createTenantHarness({
        tables: { tasks: [...seed().tasks, ...many()] },
        maxRows: 1000,
      });
      repo = new SupabaseTaskRepository(harness.client);
    });

    it('reads every row when no page is asked for', async () => {
      const tasks = await harness.expectTenantScoped(CHAPTER_B, () =>
        repo.findByChapter(CHAPTER_B),
      );

      expect(tasks).toHaveLength(2501);
      expect(new Set(tasks.map((t) => t.id)).size).toBe(2501);
    });

    it('reaches every row page by page, through a tie on created_at', async () => {
      const seen: string[] = [];
      let after: { created_at: string; id: string } | undefined;
      for (;;) {
        const page = await repo.findByChapter(CHAPTER_B, { after, limit: 200 });
        seen.push(...page.map((t) => t.id));
        if (page.length < 200) break;
        const last = page[page.length - 1];
        after = { created_at: last.created_at, id: last.id };
      }

      expect(seen).toHaveLength(2501);
      expect(new Set(seen).size).toBe(2501);
    });

    it('filters on confirmation in SQL, past the cap', async () => {
      const open = await repo.findByChapter(CHAPTER_B, { confirmed: false });
      const confirmed = await repo.findByChapter(CHAPTER_B, {
        confirmed: true,
      });

      expect(open).toHaveLength(1251);
      expect(confirmed).toHaveLength(1250);
      expect(open.every((t) => t.confirmed_at === null)).toBe(true);
    });
  });

  it('update refuses an id belonging to another chapter', async () => {
    await expect(
      harness.expectTenantScoped(CHAPTER_B, () =>
        repo.update(TASK_A, CHAPTER_B, { status: TaskStatus.COMPLETED }),
      ),
    ).rejects.toMatchObject({ code: 'PGRST116' });

    expect(harness.rows('tasks').find((r) => r.id === TASK_A)?.status).toBe(
      'TODO',
    );
  });

  it('confirmCompletionAtomic passes the chapter to the RPC', async () => {
    harness = createTenantHarness({
      tables: seed(),
      rpc: { confirm_task_completion: { data: [{ id: TASK_B }] } },
    });
    repo = new SupabaseTaskRepository(harness.client);

    await harness.expectTenantScoped(CHAPTER_B, () =>
      repo.confirmCompletionAtomic(TASK_B, CHAPTER_B),
    );

    expect(harness.rpcCalls[0].args).toMatchObject({ p_chapter_id: CHAPTER_B });
  });

  it('reopenCompletion moves an unconfirmed completion back and clears completed_at', async () => {
    harness = createTenantHarness({
      tables: {
        tasks: seed().tasks.map((row) => ({
          ...row,
          status: 'COMPLETED',
          completed_at: '2026-08-30T00:00:00Z',
          points_awarded: false,
        })),
      },
    });
    repo = new SupabaseTaskRepository(harness.client);

    const reopened = await harness.expectTenantScoped(CHAPTER_B, () =>
      repo.reopenCompletion(TASK_B, CHAPTER_B),
    );

    expect(reopened).toMatchObject({
      id: TASK_B,
      status: 'IN_PROGRESS',
      completed_at: null,
    });
    // The assignee's own take-back is not a send-back.
    expect(reopened).not.toHaveProperty('sent_back_at', expect.any(String));
    expect(harness.rows('tasks').find((r) => r.id === TASK_A)?.status).toBe(
      'COMPLETED',
    );
  });

  it('reopenCompletion stamps an officer’s send-back', async () => {
    harness = createTenantHarness({
      tables: {
        tasks: seed().tasks.map((row) => ({
          ...row,
          status: 'COMPLETED',
          completed_at: '2026-08-30T00:00:00Z',
          points_awarded: false,
        })),
      },
    });
    repo = new SupabaseTaskRepository(harness.client);

    const reopened = await harness.expectTenantScoped(CHAPTER_B, () =>
      repo.reopenCompletion(TASK_B, CHAPTER_B, '2026-08-31T00:00:00.000Z'),
    );

    expect(reopened).toMatchObject({
      id: TASK_B,
      status: 'IN_PROGRESS',
      sent_back_at: '2026-08-31T00:00:00.000Z',
    });
    expect(
      harness.rows('tasks').find((r) => r.id === TASK_A)?.sent_back_at,
    ).toBeUndefined();
  });

  it('reopenCompletion leaves a confirmed task alone', async () => {
    harness = createTenantHarness({
      tables: {
        tasks: seed().tasks.map((row) => ({
          ...row,
          status: 'COMPLETED',
          completed_at: '2026-08-30T00:00:00Z',
          points_awarded: true,
        })),
      },
    });
    repo = new SupabaseTaskRepository(harness.client);

    const reopened = await repo.reopenCompletion(TASK_B, CHAPTER_B);

    expect(reopened).toBeNull();
    expect(harness.rows('tasks').find((r) => r.id === TASK_B)?.status).toBe(
      'COMPLETED',
    );
  });
});
