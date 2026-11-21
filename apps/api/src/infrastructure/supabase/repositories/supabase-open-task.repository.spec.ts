import { SupabaseOpenTaskRepository } from './supabase-open-task.repository';
import {
  CHAPTER_A,
  CHAPTER_B,
  USER_SHARED,
  createTenantHarness,
  inA,
  inB,
  type TenantHarness,
} from '#test/helpers/tenant-scope.harness';

/** Tenant scope for `open_tasks`, tasks up for grabs (2026-11-18). */

const POSTING_A = '0a000000-0000-4000-8000-000000000071';
const POSTING_B = '0b000000-0000-4000-8000-000000000071';
const TASK_A = '0a000000-0000-4000-8000-000000000072';
const TASK_B = '0b000000-0000-4000-8000-000000000072';

const row = (id: string, claimedTaskId: string) => ({
  id,
  created_by: USER_SHARED,
  title: 'Drive to the store',
  description: null,
  due_date: '2026-11-21',
  due_at: null,
  point_reward: 10,
  proof_kind: 'none',
  subtask_titles: [],
  scope: 'chapter',
  scope_id: null,
  scope_name: null,
  scope_user_ids: null,
  status: 'open',
  claimed_task_id: claimedTaskId,
  claimed_by: null,
  claimed_at: null,
  created_at: '2026-11-18T00:00:00.000Z',
  updated_at: '2026-11-18T00:00:00.000Z',
});

const seed = () => ({
  open_tasks: [inA(row(POSTING_A, TASK_A)), inB(row(POSTING_B, TASK_B))],
});

describe('SupabaseOpenTaskRepository — tenant scope', () => {
  let harness: TenantHarness;
  let repo: SupabaseOpenTaskRepository;

  beforeEach(() => {
    harness = createTenantHarness({
      tables: seed(),
      // A posting names its own chapter's claimed task.
      collisionExempt: { open_tasks: ['claimed_task_id'] },
    });
    repo = new SupabaseOpenTaskRepository(harness.client);
  });

  it('findOpen returns only the caller chapter postings', async () => {
    const rows = await harness.expectTenantScoped(CHAPTER_B, () =>
      repo.findOpen(CHAPTER_B),
    );
    expect(rows.map((r) => r.id)).toEqual([POSTING_B]);
  });

  it('findById reads only within the chapter', async () => {
    const found = await harness.expectTenantScoped(CHAPTER_A, () =>
      repo.findById(CHAPTER_A, POSTING_B),
    );
    expect(found).toBeNull();
  });

  it('findClaimedFrom maps only the chapter tasks', async () => {
    const map = await harness.expectTenantScoped(CHAPTER_B, () =>
      repo.findClaimedFrom(CHAPTER_B, [TASK_A, TASK_B]),
    );
    expect([...map.entries()]).toEqual([[TASK_B, POSTING_B]]);
  });

  it('updateOpen and deleteOpen touch only the chapter posting', async () => {
    const updated = await harness.expectTenantScoped(CHAPTER_B, () =>
      repo.updateOpen(CHAPTER_B, POSTING_B, { title: 'Drive to Costco' }),
    );
    expect(updated?.title).toBe('Drive to Costco');
    const deleted = await harness.expectTenantScoped(CHAPTER_A, () =>
      repo.deleteOpen(CHAPTER_A, POSTING_B),
    );
    expect(deleted).toBe(false);
  });

  it('claim and release pass the chapter to their RPCs', async () => {
    harness = createTenantHarness({
      tables: seed(),
      collisionExempt: { open_tasks: ['claimed_task_id'] },
      rpc: {
        claim_open_task: { data: [{ id: TASK_B, chapter_id: CHAPTER_B }] },
        release_open_task: { data: [{ id: POSTING_B, chapter_id: CHAPTER_B }] },
      },
    });
    repo = new SupabaseOpenTaskRepository(harness.client);

    await harness.expectTenantScoped(CHAPTER_B, () =>
      repo.claim(CHAPTER_B, POSTING_B, USER_SHARED, USER_SHARED),
    );
    await harness.expectTenantScoped(CHAPTER_B, () =>
      repo.release(CHAPTER_B, TASK_B, USER_SHARED),
    );
    expect(harness.rpcCalls.map((c) => c.args.p_chapter_id)).toEqual([
      CHAPTER_B,
      CHAPTER_B,
    ]);
  });

  it.each([
    ['P0002', 'missing'],
    ['FR409', 'taken'],
  ])('maps a claim refused with %s to %s', async (code, reason) => {
    harness = createTenantHarness({
      tables: seed(),
      collisionExempt: { open_tasks: ['claimed_task_id'] },
      rpc: { claim_open_task: { error: { code, message: 'refused' } } },
    });
    repo = new SupabaseOpenTaskRepository(harness.client);
    await expect(
      repo.claim(CHAPTER_B, POSTING_B, USER_SHARED, USER_SHARED),
    ).resolves.toEqual({ ok: false, reason });
  });

  it.each([
    ['P0002', 'missing'],
    ['42501', 'not_assignee'],
    ['FR409', 'done'],
  ])('maps a release refused with %s to %s', async (code, reason) => {
    harness = createTenantHarness({
      tables: seed(),
      collisionExempt: { open_tasks: ['claimed_task_id'] },
      rpc: { release_open_task: { error: { code, message: 'refused' } } },
    });
    repo = new SupabaseOpenTaskRepository(harness.client);
    await expect(repo.release(CHAPTER_B, TASK_B, USER_SHARED)).resolves.toEqual(
      { ok: false, reason },
    );
  });
});
