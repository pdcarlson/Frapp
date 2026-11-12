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
  code_verifier: 'verifier',
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
        code_verifier: 'verifier',
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

  describe('a member who disconnects mid-sync stays disconnecting', () => {
    const row = (id: string) =>
      harness.rows('google_calendar_connections').find((r) => r.id === id);

    it('finishSync writes over a live row but only frees a disconnecting one', async () => {
      const lease = { sync_lease_until: '2026-11-12T00:20:00.000Z' };
      await repo.finishSync(CONN_A, { last_error: 'x' });
      expect(row(CONN_A)).toMatchObject({ last_error: 'x' });

      // The worker's sync of a row the member has since disconnected:
      // neither Reconnect nor a new due time may land on it, or the cleanup
      // would never run, but its lease goes so the cleanup runs next tick.
      harness = createTenantHarness({
        tables: {
          ...seed(),
          google_calendar_connections: [
            inA({ ...connection(CONN_A_OLD, 'disconnecting'), ...lease }),
            inB({ ...connection(CONN_B_OLD, 'disconnecting'), ...lease }),
          ],
        },
      });
      repo = new SupabaseGoogleCalendarRepository(harness.client);
      await repo.finishSync(CONN_A_OLD, {
        status: 'needs_reconnect',
        last_error: 'invalid_grant',
        sync_due_at: '2026-11-13T00:00:00.000Z',
      });
      expect(row(CONN_A_OLD)).toMatchObject({
        status: 'disconnecting',
        last_error: null,
        sync_due_at: '2026-11-12T00:00:00.000Z',
        sync_lease_until: null,
      });
    });

    it('replaceToken leaves a disconnecting row alone', async () => {
      await repo.replaceToken(CONN_A_OLD, {
        google_email: 'other@gmail.com',
        refresh_token_sealed: 'v1.new',
      });
      expect(row(CONN_A_OLD)).toMatchObject({
        status: 'disconnecting',
        refresh_token_sealed: 'v1.k.n.t.c',
      });
    });

    it('deferCleanup touches only a disconnecting row', async () => {
      const until = new Date('2026-11-12T00:30:00.000Z');
      await repo.deferCleanup(CONN_A, until, 'backendError');
      expect(row(CONN_A)).toMatchObject({ sync_lease_until: null });

      await repo.deferCleanup(CONN_A_OLD, until, 'backendError');
      expect(row(CONN_A_OLD)).toMatchObject({
        sync_lease_until: until.toISOString(),
        // The give-up clock is when the disconnect was asked for: kept.
        sync_due_at: '2026-11-12T00:00:00.000Z',
      });
    });

    it('markDisconnecting keeps a sync’s lease and returns the row', async () => {
      harness = createTenantHarness({
        tables: {
          ...seed(),
          google_calendar_connections: [
            inA({
              ...connection(CONN_A, 'active'),
              sync_lease_until: '2026-11-12T00:20:00.000Z',
            }),
            inB({
              ...connection(CONN_B, 'active'),
              sync_lease_until: '2026-11-12T00:20:00.000Z',
            }),
          ],
        },
      });
      repo = new SupabaseGoogleCalendarRepository(harness.client);

      const marked = await repo.markDisconnecting(CONN_A);

      expect(marked).toMatchObject({
        id: CONN_A,
        status: 'disconnecting',
        sync_lease_until: '2026-11-12T00:20:00.000Z',
      });
    });
  });

  it('countForAccount counts the account’s other connections, in any chapter', async () => {
    await expect(
      repo.countForAccount('member@gmail.com', CONN_A),
    ).resolves.toBe(3);
    await expect(repo.countForAccount('nobody@gmail.com', null)).resolves.toBe(
      0,
    );
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
