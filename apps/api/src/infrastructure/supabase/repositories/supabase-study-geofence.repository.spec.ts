import { SupabaseStudyGeofenceRepository } from './supabase-study-geofence.repository';
import {
  CHAPTER_B,
  createTenantHarness,
  inA,
  inB,
  type TenantHarness,
} from '../../../../test/helpers/tenant-scope.harness';

/**
 * Tenant scope for `study_geofences` (backs `use-study`).
 *
 * `findById(id, chapterId)` is the check that keeps study sessions inside a
 * chapter: `StudyService` resolves the session's geofence through it on every
 * heartbeat, so a null is what stops a session pointing at another chapter's
 * geofence from continuing to accrue points.
 */

const FENCE_A = '0a000000-0000-4000-8000-000000000100';
const FENCE_B = '0b000000-0000-4000-8000-000000000100';

const seed = () => ({
  study_geofences: [
    inA({
      id: FENCE_A,
      name: 'Library',
      coordinates: { lat: 1, lng: 2, radius_m: 50 },
      is_active: true,
      minutes_per_point: 30,
      points_per_interval: 1,
      min_session_minutes: 15,
      pause_grace_minutes: 5,
      created_at: '2026-01-01T00:00:00.000Z',
    }),
    inB({
      id: FENCE_B,
      name: 'Library',
      coordinates: { lat: 1, lng: 2, radius_m: 50 },
      is_active: true,
      minutes_per_point: 30,
      points_per_interval: 1,
      min_session_minutes: 15,
      pause_grace_minutes: 5,
      created_at: '2026-01-01T00:00:00.000Z',
    }),
  ],
});

describe('SupabaseStudyGeofenceRepository — tenant scope', () => {
  let harness: TenantHarness;
  let repo: SupabaseStudyGeofenceRepository;

  beforeEach(() => {
    harness = createTenantHarness({ tables: seed() });
    repo = new SupabaseStudyGeofenceRepository(harness.client);
  });

  it('findByChapter returns only the caller chapter geofences', async () => {
    const fences = await harness.expectTenantScoped(CHAPTER_B, () =>
      repo.findByChapter(CHAPTER_B),
    );

    expect(fences.map((f) => f.id)).toEqual([FENCE_B]);
  });

  it('findById refuses a geofence from another chapter', async () => {
    const foreign = await harness.expectTenantScoped(CHAPTER_B, () =>
      repo.findById(FENCE_A, CHAPTER_B),
    );

    expect(foreign).toBeNull();
  });

  it('delete leaves another chapter geofence in place', async () => {
    await harness.expectTenantScoped(CHAPTER_B, () =>
      repo.delete(FENCE_A, CHAPTER_B),
    );

    expect(
      harness
        .rows('study_geofences')
        .map((f) => f.id)
        .sort(),
    ).toEqual([FENCE_A, FENCE_B].sort());
  });
});
