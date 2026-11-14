import { SupabaseBirthdayPostRepository } from './supabase-birthday-post.repository';
import {
  CHAPTER_A,
  USER_SHARED,
  createTenantHarness,
  inA,
  inB,
} from '#test/helpers/tenant-scope.harness';

/**
 * Tenant scope for `birthday_posts` (#4959), the once-a-day claims behind the
 * birthday posts. The A/B twins agree on everything but their chapter, so a
 * claim or release that drops the chapter would reach the other chapter's.
 * The seeds carry an `id` only so the harness can tell rows apart; the table
 * is keyed by (chapter_id, user_id, local_date).
 */

const DATE = '2026-03-04';
const EARLIER = '2025-03-04';

describe('SupabaseBirthdayPostRepository — tenant scope', () => {
  it("claims a member's day once, in its own chapter", async () => {
    // Twins on another day, so the claim below is the day's first in A.
    const harness = createTenantHarness({
      tables: {
        birthday_posts: [
          inA({
            id: 'a',
            user_id: USER_SHARED,
            local_date: EARLIER,
            created_at: EARLIER,
          }),
          inB({
            id: 'b',
            user_id: USER_SHARED,
            local_date: EARLIER,
            created_at: EARLIER,
          }),
        ],
      },
    });
    const repo = new SupabaseBirthdayPostRepository(harness.client);

    await expect(
      harness.expectTenantScoped(CHAPTER_A, () =>
        repo.claim(CHAPTER_A, USER_SHARED, DATE),
      ),
    ).resolves.toBe(true);
    // A second sweep, on any replica, finds the claim and doesn't post.
    await expect(repo.claim(CHAPTER_A, USER_SHARED, DATE)).resolves.toBe(false);
  });

  it("gives back only the chapter's own claim", async () => {
    const harness = createTenantHarness({
      tables: {
        birthday_posts: [
          inA({
            id: 'a',
            user_id: USER_SHARED,
            local_date: DATE,
            created_at: DATE,
          }),
          inB({
            id: 'b',
            user_id: USER_SHARED,
            local_date: DATE,
            created_at: DATE,
          }),
        ],
      },
    });
    const repo = new SupabaseBirthdayPostRepository(harness.client);

    await harness.expectTenantScoped(CHAPTER_A, () =>
      repo.release(CHAPTER_A, USER_SHARED, DATE),
    );
    // Released, so A can claim again; B's stays.
    await expect(repo.claim(CHAPTER_A, USER_SHARED, DATE)).resolves.toBe(true);
  });
});
