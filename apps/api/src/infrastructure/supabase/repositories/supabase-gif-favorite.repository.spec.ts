import { SupabaseGifFavoriteRepository } from './supabase-gif-favorite.repository';
import {
  USER_A,
  USER_B,
  createTenantHarness,
  type TenantHarness,
} from '#test/helpers/tenant-scope.harness';

/**
 * Member scope for `gif_favorites` (#5772). The table is per member, not per
 * chapter, and has RLS on with no policies: the service-role client bypasses
 * it, so the `user_id` predicate on every query is the whole privacy
 * boundary. The seed gives two members the same GIF, and member A a favorite
 * from a provider the server no longer uses, so both predicates have
 * something real to exclude.
 */

const row = (id: string, user: string, gif: string, provider = 'klipy') => ({
  id,
  user_id: user,
  provider,
  gif_id: gif,
  title: gif,
  full_url: `https://static.klipy.com/${gif}.gif`,
  full_width: 200,
  full_height: 150,
  preview_url: `https://static.klipy.com/${gif}.webp`,
  preview_width: 200,
  preview_height: 150,
  created_at: `2026-11-20T00:00:0${id.slice(-1)}.000Z`,
});

const A_DANCE = '0a000000-0000-4000-8000-000000000501';
const A_WAVE = '0a000000-0000-4000-8000-000000000502';
const A_OLD = '0a000000-0000-4000-8000-000000000503';
const B_DANCE = '0b000000-0000-4000-8000-000000000501';

describe('SupabaseGifFavoriteRepository (#5772)', () => {
  let harness: TenantHarness;
  let repo: SupabaseGifFavoriteRepository;

  beforeEach(() => {
    harness = createTenantHarness({
      tables: {
        gif_favorites: [
          row(A_DANCE, USER_A, 'dance'),
          row(A_WAVE, USER_A, 'wave'),
          row(A_OLD, USER_A, 'old', 'tenor'),
          row(B_DANCE, USER_B, 'dance'),
        ],
      },
      untenantedTables: ['gif_favorites'],
    });
    repo = new SupabaseGifFavoriteRepository(harness.client);
  });

  it("lists only the member's own favorites from this provider, newest first", async () => {
    const rows = await repo.listByUser(USER_A, 'klipy');
    expect(rows.map((r) => r.id)).toEqual([A_WAVE, A_DANCE]);
  });

  it("counts only the member's own favorites from this provider", async () => {
    await expect(repo.countByUser(USER_A, 'klipy')).resolves.toBe(2);
  });

  it('says whether the member starred a GIF, not whether anyone did', async () => {
    await expect(repo.has(USER_A, 'klipy', 'dance')).resolves.toBe(true);
    await expect(repo.has(USER_B, 'klipy', 'wave')).resolves.toBe(false);
  });

  it("unstars the member's row and leaves another member's star of the same GIF", async () => {
    await repo.remove(USER_A, 'klipy', 'dance');
    expect(harness.rows('gif_favorites').map((r) => r.id)).toEqual([
      A_WAVE,
      A_OLD,
      B_DANCE,
    ]);
  });
});
