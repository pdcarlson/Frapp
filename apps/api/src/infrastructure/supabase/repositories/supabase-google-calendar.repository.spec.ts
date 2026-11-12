import { SupabaseGoogleCalendarRepository } from './supabase-google-calendar.repository';
import {
  CHAPTER_A,
  CHAPTER_B,
  USER_A,
  USER_SHARED,
  createTenantHarness,
  inA,
  inB,
  type TenantHarness,
} from '#test/helpers/tenant-scope.harness';

/**
 * Tenant scope for `google_calendar_connections` and
 * `google_calendar_oauth_states` (#3322, step 2).
 *
 * Two scopes, as for every per-member table: `chapter_id`, which the harness
 * checks, and `user_id`, which it does not know about, so both are asserted.
 * Unscoped on purpose: `findState` (Google's redirect carries no chapter or
 * sign-in; the state id is the boundary), and the writes by row id, whose row
 * came from a scoped read or from the worker's claim.
 */

const STATE_A = '0a000000-0000-4000-8000-000000000400';
const STATE_B = '0b000000-0000-4000-8000-000000000400';
const CONN_A = '0a000000-0000-4000-8000-000000000410';
const CONN_B = '0b000000-0000-4000-8000-000000000410';
const CONN_A_OLD = '0a000000-0000-4000-8000-000000000411';
const CONN_B_OLD = '0b000000-0000-4000-8000-000000000411';

const connection = (id: string, status: string) => ({
  id,
  user_id: USER_SHARED,
  google_email: 'member@gmail.com',
  refresh_token_sealed: 'v1.k.n.t.c',
  calendar_id: 'cal@group.calendar.google.com',
  status,
  sync_due_at: '2026-11-12T00:00:00.000Z',
  sync_lease_until: null,
  last_synced_at: null,
  last_error: null,
  created_at: '2026-11-12T00:00:00.000Z',
});

const state = (id: string) => ({
  id,
  user_id: USER_SHARED,
  return_to: 'https://app.frapp.live/events',
  created_at: '2026-11-12T00:00:00.000Z',
  expires_at: '2026-11-12T00:10:00.000Z',
  consumed_at: null,
});

const seed = () => ({
  google_calendar_connections: [
    inA(connection(CONN_A, 'active')),
    inB(connection(CONN_B, 'active')),
    inA(connection(CONN_A_OLD, 'disconnecting')),
    inB(connection(CONN_B_OLD, 'disconnecting')),
  ],
  google_calendar_oauth_states: [inA(state(STATE_A)), inB(state(STATE_B))],
});

describe('SupabaseGoogleCalendarRepository — tenant scope', () => {
  let harness: TenantHarness;
  let repo: SupabaseGoogleCalendarRepository;

  beforeEach(() => {
    harness = createTenantHarness({ tables: seed() });
    repo = new SupabaseGoogleCalendarRepository(harness.client);
  });

  it('findLive reads the member’s live connection in the chapter only', async () => {
    const found = await harness.expectTenantScoped(CHAPTER_A, () =>
      repo.findLive(CHAPTER_A, USER_SHARED),
    );

    expect(found?.id).toBe(CONN_A);
    const filters = harness.ops.at(-1)?.filters.map((f) => f.column);
    expect(filters).toEqual(
      expect.arrayContaining(['chapter_id', 'user_id', 'status']),
    );
  });

  it('create writes the chapter and member given', async () => {
    const created = await harness.expectTenantScoped(CHAPTER_B, () =>
      repo.create({
        chapter_id: CHAPTER_B,
        user_id: USER_A,
        google_email: null,
        refresh_token_sealed: 'v1.k.n.t.c',
      }),
    );

    expect(created).toMatchObject({ chapter_id: CHAPTER_B, user_id: USER_A });
  });

  it('createState writes the chapter and member given', async () => {
    const created = await harness.expectTenantScoped(CHAPTER_A, () =>
      repo.createState({
        chapter_id: CHAPTER_A,
        user_id: USER_A,
        return_to: 'frapp://google-calendar',
        expires_at: '2026-11-12T00:10:00.000Z',
      }),
    );

    expect(created).toMatchObject({ chapter_id: CHAPTER_A, user_id: USER_A });
  });

  it('consumeState spends a sign-in only for its own chapter and member', async () => {
    const now = new Date('2026-11-12T00:05:00.000Z');
    const crossed = await harness.expectTenantScoped(CHAPTER_A, () =>
      repo.consumeState(STATE_B, CHAPTER_A, USER_SHARED, now),
    );
    expect(crossed).toBeNull();

    const someoneElse = await repo.consumeState(
      STATE_A,
      CHAPTER_A,
      USER_A,
      now,
    );
    expect(someoneElse).toBeNull();

    const own = await repo.consumeState(STATE_A, CHAPTER_A, USER_SHARED, now);
    expect(own?.id).toBe(STATE_A);
    const again = await repo.consumeState(STATE_A, CHAPTER_A, USER_SHARED, now);
    expect(again).toBeNull();
  });

  it('findState resolves across chapters — the state id is the boundary', async () => {
    const fromB = await repo.findState(STATE_B);

    expect(fromB?.chapter_id).toBe(CHAPTER_B);
    expect(harness.ops[0].filters.map((f) => f.column)).toEqual(['id']);
  });

  it('claim hands the function the time, the limit and the lease', async () => {
    await repo.claim(new Date('2026-11-12T00:00:00.000Z'), 12, 1200);

    expect(harness.rpcCalls).toEqual([
      {
        fn: 'claim_google_calendar_syncs',
        args: {
          p_now: '2026-11-12T00:00:00.000Z',
          p_limit: 12,
          p_lease_seconds: 1200,
        },
      },
    ]);
  });
});
