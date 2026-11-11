import { SupabaseRoleTierRepository } from './supabase-role-tier.repository';
import {
  CHAPTER_A,
  CHAPTER_B,
  createTenantHarness,
  inA,
  inB,
  type TenantHarness,
} from '#test/helpers/tenant-scope.harness';

/**
 * Tenant scope for `role_tiers` (#4071). Each chapter's tiers collide with
 * the other's on name and position, so only a chapter filter tells them apart.
 */

const tier = (id: string, position: number) => ({
  id,
  name: `Tier ${position}`,
  position,
  permissions: ['members:view'],
  created_at: '2026-01-01T00:00:00.000Z',
  updated_at: '2026-01-01T00:00:00.000Z',
});

describe('SupabaseRoleTierRepository — tenant scope', () => {
  let harness: TenantHarness;
  let repo: SupabaseRoleTierRepository;

  beforeEach(() => {
    // Stored lowest first, so only the ordering can put them right.
    harness = createTenantHarness({
      tables: {
        role_tiers: [3, 1, 2].flatMap((position) => [
          inA(tier(`a-${position}`, position)),
          inB(tier(`b-${position}`, position)),
        ]),
      },
    });
    repo = new SupabaseRoleTierRepository(harness.client);
  });

  it("findByChapter returns only the caller chapter's tiers, highest first", async () => {
    const tiers = await harness.expectTenantScoped(CHAPTER_B, () =>
      repo.findByChapter(CHAPTER_B),
    );

    expect(tiers.map((t) => t.id)).toEqual(['b-1', 'b-2', 'b-3']);
  });

  it('createMany writes the rows into the chapter it is given', async () => {
    const created = await harness.expectTenantScoped(CHAPTER_A, () =>
      repo.createMany([
        { chapter_id: CHAPTER_A, name: 'Advisors', position: 4 },
        { chapter_id: CHAPTER_A, name: 'Guests', position: 5 },
      ]),
    );

    expect(created.map((t) => t.chapter_id)).toEqual([CHAPTER_A, CHAPTER_A]);
  });
});
