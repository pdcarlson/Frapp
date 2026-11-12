import { SupabaseEventExcuseRepository } from './supabase-event-excuse.repository';
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
 * Tenant scope for `event_excuses` (#3735). The same member holds a pending
 * excuse for the same event id in both chapters, so only the chapter filter (and,
 * on the RPCs, `p_chapter_id`) tells them apart.
 */

// One event id in both chapters: the twins must collide on every column but
// id and chapter_id, so that only the chapter filter can separate them.
const EVENT = '0c000000-0000-4000-8000-000000000150';
const EXCUSE_A = '0a000000-0000-4000-8000-000000000151';
const EXCUSE_B = '0b000000-0000-4000-8000-000000000151';

const row = {
  user_id: USER_SHARED,
  reason: 'Exam review',
  status: 'PENDING',
  decided_by: null,
  decided_at: null,
  created_at: '2026-11-10T00:00:00.000Z',
  updated_at: '2026-11-10T00:00:00.000Z',
};

const seed = () => ({
  event_excuses: [
    inA({ id: EXCUSE_A, event_id: EVENT, ...row }),
    inB({ id: EXCUSE_B, event_id: EVENT, ...row }),
  ],
});

describe('SupabaseEventExcuseRepository — tenant scope', () => {
  let harness: TenantHarness;
  let repo: SupabaseEventExcuseRepository;

  beforeEach(() => {
    harness = createTenantHarness({
      tables: seed(),
      rpc: {
        decide_event_excuse: { data: [{ id: EXCUSE_B }] },
        withdraw_event_excuse: { data: [{ id: EXCUSE_B }] },
      },
    });
    repo = new SupabaseEventExcuseRepository(harness.client);
  });

  it("findByEvent returns only the caller chapter's excuses", async () => {
    const rows = await harness.expectTenantScoped(CHAPTER_B, () =>
      repo.findByEvent(CHAPTER_B, EVENT),
    );

    expect(rows.map((r) => r.id)).toEqual([EXCUSE_B]);
  });

  it("findByEventAndUser returns only the caller chapter's excuse", async () => {
    const found = await harness.expectTenantScoped(CHAPTER_B, () =>
      repo.findByEventAndUser(CHAPTER_B, EVENT, USER_SHARED),
    );

    expect(found?.id).toBe(EXCUSE_B);
  });

  it('findUserIdsByEventAndStatus stays in the chapter', async () => {
    const ids = await harness.expectTenantScoped(CHAPTER_B, () =>
      repo.findUserIdsByEventAndStatus(CHAPTER_B, EVENT, ['PENDING']),
    );

    expect(ids).toEqual([USER_SHARED]);
  });

  it('create writes into the chapter it is given', async () => {
    const created = await repo.create({
      chapter_id: CHAPTER_A,
      event_id: EVENT,
      user_id: '66666666-6666-4666-8666-666666666666',
      reason: 'Away game',
    });

    expect(created?.chapter_id).toBe(CHAPTER_A);
  });

  it('decideAtomic passes the chapter to the RPC', async () => {
    await harness.expectTenantScoped(CHAPTER_B, () =>
      repo.decideAtomic(EXCUSE_B, CHAPTER_B, 'APPROVED', USER_SHARED, false),
    );

    expect(harness.rpcCalls[0].args).toMatchObject({
      p_excuse_id: EXCUSE_B,
      p_chapter_id: CHAPTER_B,
    });
  });

  it('withdrawAtomic passes the chapter to the RPC', async () => {
    await harness.expectTenantScoped(CHAPTER_B, () =>
      repo.withdrawAtomic(CHAPTER_B, EVENT, USER_SHARED),
    );

    expect(harness.rpcCalls[0].args).toMatchObject({
      p_event_id: EVENT,
      p_chapter_id: CHAPTER_B,
    });
  });
});
