import { SupabaseActivityRecapPushRepository } from './supabase-activity-recap-push.repository';
import {
  CHAPTER_A,
  USER_SHARED,
  createTenantHarness,
  inA,
  inB,
} from '#test/helpers/tenant-scope.harness';

/**
 * Tenant scope for `activity_recap_pushes` (#4985), the once-a-week claims
 * behind the recap push. The A/B twins agree on everything but their chapter,
 * so a claim or release that drops the chapter would reach the other
 * chapter's. The seeds carry an `id` only so the harness can tell rows apart;
 * the table is keyed by (chapter_id, user_id, week_first_day).
 */

const WEEK = '2026-11-08';
const EARLIER = '2026-11-01';

describe('SupabaseActivityRecapPushRepository — tenant scope', () => {
  it("claims a member's week once, in its own chapter", async () => {
    // Twins on another week, so the claim below is the week's first in A.
    const harness = createTenantHarness({
      tables: {
        activity_recap_pushes: [
          inA({
            id: 'a',
            user_id: USER_SHARED,
            week_first_day: EARLIER,
            created_at: EARLIER,
          }),
          inB({
            id: 'b',
            user_id: USER_SHARED,
            week_first_day: EARLIER,
            created_at: EARLIER,
          }),
        ],
      },
    });
    const repo = new SupabaseActivityRecapPushRepository(harness.client);

    await expect(
      harness.expectTenantScoped(CHAPTER_A, () =>
        repo.claim(CHAPTER_A, USER_SHARED, WEEK),
      ),
    ).resolves.toBe(true);
    // A second sweep, on any replica, finds the claim and doesn't send.
    await expect(repo.claim(CHAPTER_A, USER_SHARED, WEEK)).resolves.toBe(false);
  });

  it("gives back only the chapter's own claim", async () => {
    const harness = createTenantHarness({
      tables: {
        activity_recap_pushes: [
          inA({
            id: 'a',
            user_id: USER_SHARED,
            week_first_day: WEEK,
            created_at: WEEK,
          }),
          inB({
            id: 'b',
            user_id: USER_SHARED,
            week_first_day: WEEK,
            created_at: WEEK,
          }),
        ],
      },
    });
    const repo = new SupabaseActivityRecapPushRepository(harness.client);

    await harness.expectTenantScoped(CHAPTER_A, () =>
      repo.release(CHAPTER_A, USER_SHARED, WEEK),
    );
    // Released, so A can claim again; B's stays.
    await expect(repo.claim(CHAPTER_A, USER_SHARED, WEEK)).resolves.toBe(true);
  });
});
