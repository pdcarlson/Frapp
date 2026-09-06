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
      points_awarded: 0,
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
      points_awarded: 0,
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
        points_awarded: 0,
      }),
    );

    expect(created.chapter_id).toBe(CHAPTER_B);
  });

  it('update refuses a session id that belongs to another chapter', async () => {
    await expect(
      harness.expectTenantScoped(CHAPTER_B, () =>
        repo.update(SESSION_A, CHAPTER_B, { status: 'COMPLETED' }),
      ),
    ).rejects.toMatchObject({ code: 'PGRST116' });

    expect(
      harness.rows('study_sessions').find((s) => s.id === SESSION_A)?.status,
    ).toBe('ACTIVE');
  });

  it('update writes only the caller chapter session', async () => {
    await harness.expectTenantScoped(CHAPTER_B, () =>
      repo.update(SESSION_B, CHAPTER_B, { status: 'COMPLETED' }),
    );

    const rows = harness.rows('study_sessions');
    expect(rows.find((s) => s.id === SESSION_B)?.status).toBe('COMPLETED');
    expect(rows.find((s) => s.id === SESSION_A)?.status).toBe('ACTIVE');
  });
});
