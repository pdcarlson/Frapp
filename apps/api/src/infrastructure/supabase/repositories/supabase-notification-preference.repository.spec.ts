import { SupabaseNotificationPreferenceRepository } from './supabase-notification-preference.repository';
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
 * Tenant scope for `notification_preferences`.
 *
 * This is one of the few surfaces where the chapter arrives from the client
 * rather than from `ChapterGuard` (`GET /v1/notifications/preferences?chapterId=`),
 * which `NotificationService.assertChapterMembership` and
 * `test/cross-tenant-isolation.e2e-spec.ts` cover at the route level. What is
 * asserted here is the layer underneath: given a chapter, the query is bound to
 * it, and the upsert writes into it rather than over the twin.
 */

const PREF_A = '0a000000-0000-4000-8000-000000000130';
const PREF_B = '0b000000-0000-4000-8000-000000000130';
const PREF_A_USER_A = '0a000000-0000-4000-8000-000000000131';
const PREF_B_USER_A = '0b000000-0000-4000-8000-000000000131';

const seed = () => ({
  notification_preferences: [
    inA({
      id: PREF_A,
      user_id: USER_SHARED,
      category: 'EVENTS',
      is_enabled: true,
      updated_at: '2026-01-01T00:00:00.000Z',
    }),
    inB({
      id: PREF_B,
      user_id: USER_SHARED,
      category: 'EVENTS',
      is_enabled: true,
      updated_at: '2026-01-01T00:00:00.000Z',
    }),
    inA({
      id: PREF_A_USER_A,
      user_id: USER_A,
      category: 'EVENTS',
      is_enabled: true,
      updated_at: '2026-01-01T00:00:00.000Z',
    }),
    inB({
      id: PREF_B_USER_A,
      user_id: USER_A,
      category: 'EVENTS',
      is_enabled: true,
      updated_at: '2026-01-01T00:00:00.000Z',
    }),
  ],
});

describe('SupabaseNotificationPreferenceRepository — tenant scope', () => {
  let harness: TenantHarness;
  let repo: SupabaseNotificationPreferenceRepository;

  beforeEach(() => {
    harness = createTenantHarness({ tables: seed() });
    repo = new SupabaseNotificationPreferenceRepository(harness.client);
  });

  it('findByUserAndChapter returns only the caller chapter preferences', async () => {
    const prefs = await harness.expectTenantScoped(CHAPTER_B, () =>
      repo.findByUserAndChapter(USER_SHARED, CHAPTER_B),
    );

    expect(prefs.map((p) => p.id)).toEqual([PREF_B]);
  });

  it('findByUserChapterCategory does not resolve the twin in another chapter', async () => {
    const pref = await harness.expectTenantScoped(CHAPTER_B, () =>
      repo.findByUserChapterCategory(USER_SHARED, CHAPTER_B, 'EVENTS'),
    );

    expect(pref?.id).toBe(PREF_B);
  });

  it('findByUsersChapterCategory binds chapter_id and does not return the twin chapter', async () => {
    const prefs = await harness.expectTenantScoped(CHAPTER_B, () =>
      repo.findByUsersChapterCategory(
        [USER_SHARED, USER_A],
        CHAPTER_B,
        'EVENTS',
      ),
    );

    expect(prefs.map((p) => p.id).sort()).toEqual(
      [PREF_B, PREF_B_USER_A].sort(),
    );
    expect(prefs.every((p) => p.chapter_id === CHAPTER_B)).toBe(true);
  });

  it('findByUsersChapterCategory issues no query for an empty audience', async () => {
    const before = harness.ops.length;
    await expect(
      repo.findByUsersChapterCategory([], CHAPTER_B, 'EVENTS'),
    ).resolves.toEqual([]);
    expect(harness.ops.length).toBe(before);
  });

  it('upsert writes into the caller chapter and leaves the twin alone', async () => {
    // The conflict target is (user_id, chapter_id, category). Drop `chapter_id`
    // from it and one member muting notifications in one chapter mutes them
    // everywhere they are a member.
    await harness.expectTenantScoped(CHAPTER_B, () =>
      repo.upsert({
        id: PREF_B,
        user_id: USER_SHARED,
        chapter_id: CHAPTER_B,
        category: 'EVENTS',
        is_enabled: false,
      }),
    );

    const rows = harness.rows('notification_preferences');
    expect(rows.find((p) => p.chapter_id === CHAPTER_B)?.is_enabled).toBe(
      false,
    );
    expect(rows.find((p) => p.chapter_id === CHAPTER_A)?.is_enabled).toBe(true);
  });
});
