import { SupabaseStudySessionRepository } from './supabase-study-session.repository';
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
 * Tenant scope for `study_sessions` (backs `use-study`).
 *
 * Worth being exact about this one. `study_sessions` carries `chapter_id`, but
 * `findById` and `update` filter on `id` alone — unlike `event_attendance` or
 * `poll_votes`, that is not a structural limitation, the column is right there.
 * It is safe today only because no route accepts a session id: `StudyService`
 * reaches every row through `findActiveByUserAndChapter(userId, chapterId)`, and
 * `findById` has no callers at all.
 *
 * So the scoped lookups are asserted, and the id-only pair is characterised
 * rather than left to look intentional.
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

  describe('deliberately unscoped surfaces', () => {
    it('findById and update filter on id alone', async () => {
      // Characterisation. `StudyService` never passes a client-supplied id: the
      // study routes take only `@CurrentUser` and `@CurrentChapterId`, so the
      // row reaching `update` always came from a chapter-scoped lookup. If a
      // route ever starts accepting a session id, this repository has no filter
      // of its own to fall back on.
      const foreign = await repo.findById(SESSION_A);
      expect(foreign?.chapter_id).toBe(CHAPTER_A);

      await repo.update(SESSION_A, { status: 'COMPLETED' });
      const [, updateOp] = harness.ops;
      expect(updateOp.filters.map((f) => f.column)).toEqual(['id']);
    });
  });
});
