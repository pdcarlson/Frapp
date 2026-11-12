import { SupabaseStudySessionRepository } from './supabase-study-session.repository';
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
 * Tenant scope for `study_sessions` (backs `use-study`).
 *
 * `study_sessions` carries `chapter_id`. `update` binds it next to `id`
 * (defence-in-depth: every live caller already resolved the chapter via
 * `findActiveByUserAndChapter`). Orphan `findById` was deleted — it had no
 * production caller, and adding a chapter-scoped version would have been new
 * dead surface (#1088 / #1090).
 */

const SESSION_A = '0a000000-0000-4000-8000-000000000110';
const SESSION_B = '0b000000-0000-4000-8000-000000000110';

const seed = () => ({
  study_sessions: [
    inA({
      id: SESSION_A,
      user_id: USER_SHARED,
      geofence_id: '0a000000-0000-4000-8000-000000000111',
      status: 'ACTIVE',
      start_time: '2026-05-01T10:00:00.000Z',
      end_time: null,
      last_heartbeat_at: '2026-05-01T10:05:00.000Z',
      paused_at: null,
      total_foreground_minutes: 5,
      points_awarded: false,
      created_at: '2026-05-01T10:00:00.000Z',
    }),
    inB({
      id: SESSION_B,
      user_id: USER_SHARED,
      geofence_id: '0b000000-0000-4000-8000-000000000111',
      status: 'ACTIVE',
      start_time: '2026-05-01T10:00:00.000Z',
      end_time: null,
      last_heartbeat_at: '2026-05-01T10:05:00.000Z',
      paused_at: null,
      total_foreground_minutes: 5,
      points_awarded: false,
      created_at: '2026-05-01T10:00:00.000Z',
    }),
  ],
});

describe('SupabaseStudySessionRepository — tenant scope', () => {
  let harness: TenantHarness;
  let repo: SupabaseStudySessionRepository;

  beforeEach(() => {
    harness = createTenantHarness({
      tables: seed(),
      // A geofence belongs to one chapter, so its id cannot collide.
      collisionExempt: { study_sessions: ['geofence_id'] },
    });
    repo = new SupabaseStudySessionRepository(harness.client);
  });

  it('findByUserAndChapter returns only the caller chapter sessions', async () => {
    const sessions = await harness.expectTenantScoped(CHAPTER_B, () =>
      repo.findByUserAndChapter(USER_SHARED, CHAPTER_B),
    );

    expect(sessions.map((s) => s.id)).toEqual([SESSION_B]);
  });

  it('findByUserAndChapter keeps only sessions started at or after startedSince', async () => {
    const started = (since: string) =>
      repo.findByUserAndChapter(USER_SHARED, CHAPTER_B, {
        startedSince: new Date(since),
      });

    expect(
      (await started('2026-05-01T10:00:00.000Z')).map((s) => s.id),
    ).toEqual([SESSION_B]);
    expect(await started('2026-05-01T10:00:00.001Z')).toEqual([]);
  });

  it('findActiveByUserAndChapter does not return the same user session in another chapter', async () => {
    // The same member studying in two chapters is exactly the state that makes
    // an unscoped "active session" lookup return the wrong row, and every
    // heartbeat, pause and stop then writes to that row.
    const session = await harness.expectTenantScoped(CHAPTER_B, () =>
      repo.findActiveByUserAndChapter(USER_SHARED, CHAPTER_B),
    );

    expect(session?.id).toBe(SESSION_B);
  });

  it('create writes the session under the caller chapter', async () => {
    const created = await harness.expectTenantScoped(CHAPTER_B, () =>
      repo.create({
        id: '0b000000-0000-4000-8000-000000000112',
        chapter_id: CHAPTER_B,
        user_id: USER_SHARED,
        geofence_id: '0b000000-0000-4000-8000-000000000111',
        status: 'ACTIVE',
        start_time: '2026-05-02T10:00:00.000Z',
        last_heartbeat_at: '2026-05-02T10:00:00.000Z',
        total_foreground_minutes: 0,
        points_awarded: false,
      }),
    );

    expect(created.chapter_id).toBe(CHAPTER_B);
  });

  // What the service read before deciding: `updateIfUnchanged` writes only
  // while the row still looks like this.
  const readB = {
    id: SESSION_B,
    last_heartbeat_at: '2026-05-01T10:05:00.000Z',
    paused_at: null,
  };

  it('updateIfUnchanged refuses a session id that belongs to another chapter', async () => {
    const result = await harness.expectTenantScoped(CHAPTER_B, () =>
      repo.updateIfUnchanged({ ...readB, id: SESSION_A }, CHAPTER_B, {
        status: 'EXPIRED',
      }),
    );

    expect(result).toBeNull();
    expect(
      harness.rows('study_sessions').find((s) => s.id === SESSION_A)?.status,
    ).toBe('ACTIVE');
  });

  it('updateIfUnchanged writes the caller chapter session while it is unchanged', async () => {
    const updated = await harness.expectTenantScoped(CHAPTER_B, () =>
      repo.updateIfUnchanged(readB, CHAPTER_B, { status: 'EXPIRED' }),
    );

    expect(updated?.status).toBe('EXPIRED');
    const rows = harness.rows('study_sessions');
    expect(rows.find((s) => s.id === SESSION_B)?.status).toBe('EXPIRED');
    expect(rows.find((s) => s.id === SESSION_A)?.status).toBe('ACTIVE');
  });

  it('updateIfUnchanged writes nothing once the session has ended', async () => {
    // A Stop finished the session; an out-of-zone heartbeat that read it as
    // ACTIVE must not turn it into EXPIRED.
    await repo.updateIfUnchanged(readB, CHAPTER_B, { status: 'COMPLETED' });

    const second = await harness.expectTenantScoped(CHAPTER_B, () =>
      repo.updateIfUnchanged(readB, CHAPTER_B, { status: 'EXPIRED' }),
    );

    expect(second).toBeNull();
    expect(
      harness.rows('study_sessions').find((s) => s.id === SESSION_B)?.status,
    ).toBe('COMPLETED');
  });

  it('updateIfUnchanged writes nothing once the watermark has moved', async () => {
    // A heartbeat banked minutes after this request read the row; a pause
    // computed from the old watermark would credit them twice.
    await repo.updateIfUnchanged(readB, CHAPTER_B, {
      last_heartbeat_at: '2026-05-01T10:10:00.000Z',
      total_foreground_minutes: 10,
    });

    const stale = await harness.expectTenantScoped(CHAPTER_B, () =>
      repo.updateIfUnchanged(readB, CHAPTER_B, {
        paused_at: '2026-05-01T10:10:00.000Z',
        total_foreground_minutes: 10,
      }),
    );

    expect(stale).toBeNull();
    const row = harness.rows('study_sessions').find((s) => s.id === SESSION_B);
    expect(row?.paused_at).toBeNull();
  });

  it('updateIfUnchanged writes nothing once the pause has changed', async () => {
    // A resume cleared the pause after this request read the row paused; a
    // late grace expiry computed from that read must not end the session.
    const pausedRead = { ...readB, paused_at: '2026-05-01T10:06:00.000Z' };
    await repo.updateIfUnchanged(readB, CHAPTER_B, {
      paused_at: pausedRead.paused_at,
    });
    await repo.updateIfUnchanged(pausedRead, CHAPTER_B, { paused_at: null });

    const stale = await repo.updateIfUnchanged(pausedRead, CHAPTER_B, {
      status: 'EXPIRED',
    });

    expect(stale).toBeNull();
    expect(
      harness.rows('study_sessions').find((s) => s.id === SESSION_B)?.status,
    ).toBe('ACTIVE');
  });
});

describe('SupabaseStudySessionRepository — finish', () => {
  const finish = {
    status: 'COMPLETED' as const,
    end_time: '2026-05-01T11:00:00.000Z',
    last_heartbeat_at: '2026-05-01T11:00:00.000Z',
    total_foreground_minutes: 60,
    points: 2,
    description: 'Study session: Library',
  };
  const read = {
    id: SESSION_B,
    last_heartbeat_at: '2026-05-01T10:05:00.000Z',
    paused_at: null,
  };

  it('passes the read snapshot and the chapter to finish_study_session', async () => {
    const harness = createTenantHarness({
      tables: seed(),
      collisionExempt: { study_sessions: ['geofence_id'] },
      rpc: { finish_study_session: { data: [{ id: SESSION_B }] } },
    });
    const repo = new SupabaseStudySessionRepository(harness.client);

    const finished = await harness.expectTenantScoped(CHAPTER_B, () =>
      repo.finish(read, CHAPTER_B, finish),
    );

    expect(finished).toEqual({ id: SESSION_B });
    expect(harness.rpcCalls).toEqual([
      {
        fn: 'finish_study_session',
        args: {
          p_session_id: SESSION_B,
          p_chapter_id: CHAPTER_B,
          p_expected_last_heartbeat_at: '2026-05-01T10:05:00.000Z',
          p_expected_paused_at: null,
          p_status: 'COMPLETED',
          p_end_time: '2026-05-01T11:00:00.000Z',
          p_last_heartbeat_at: '2026-05-01T11:00:00.000Z',
          p_total_foreground_minutes: 60,
          p_points: 2,
          p_description: 'Study session: Library',
        },
      },
    ]);
  });

  it('returns null when the compare-and-set lost (empty set)', async () => {
    const harness = createTenantHarness({
      tables: seed(),
      collisionExempt: { study_sessions: ['geofence_id'] },
      rpc: { finish_study_session: { data: [] } },
    });
    const repo = new SupabaseStudySessionRepository(harness.client);

    await expect(repo.finish(read, CHAPTER_B, finish)).resolves.toBeNull();
  });
});
