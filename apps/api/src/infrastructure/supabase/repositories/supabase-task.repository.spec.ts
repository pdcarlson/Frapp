import { SupabaseTaskRepository } from './supabase-task.repository';
import {
  CHAPTER_A,
  CHAPTER_B,
  USER_SHARED,
  createTenantHarness,
  inA,
  inB,
  type TenantHarness,
} from '../../../../test/helpers/tenant-scope.harness';

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

  it('update refuses an id belonging to another chapter', async () => {
    await expect(
      harness.expectTenantScoped(CHAPTER_B, () =>
        repo.update(TASK_A, CHAPTER_B, { status: 'COMPLETED' }),
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
});
