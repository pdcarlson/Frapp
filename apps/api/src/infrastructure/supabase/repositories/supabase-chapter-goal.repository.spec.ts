import { SupabaseChapterGoalRepository } from './supabase-chapter-goal.repository';
import {
  CHAPTER_A,
  CHAPTER_B,
  createTenantHarness,
  inA,
  inB,
  type TenantHarness,
} from '#test/helpers/tenant-scope.harness';

/**
 * Tenant scope for `chapter_goals` (#1062), keyed by (`chapter_id`, `metric`).
 * Every member's bar reads it, so a dropped predicate holds a chapter to
 * another's goals, and a misdirected upsert rewrites them.
 */

const GOALS = { everyone: 40, roles: [] };

// Keyed by (chapter_id, metric) with no `id` column; each seeded row carries
// one only because the harness tracks rows by `id`.
const seed = () => ({
  chapter_goals: [
    inA({ id: 'goal-a', metric: 'points', goals: GOALS }),
    inB({ id: 'goal-b', metric: 'points', goals: GOALS }),
  ],
});

describe('SupabaseChapterGoalRepository — tenant scope', () => {
  let harness: TenantHarness;
  let repo: SupabaseChapterGoalRepository;

  beforeEach(() => {
    harness = createTenantHarness({ tables: seed() });
    repo = new SupabaseChapterGoalRepository(harness.client);
  });

  it('findByChapter returns only the caller chapter rows', async () => {
    const rows = await harness.expectTenantScoped(CHAPTER_B, () =>
      repo.findByChapter(CHAPTER_B),
    );

    expect(rows.map((row) => row.chapter_id)).toEqual([CHAPTER_B]);
  });

  it('upsert overwrites the caller chapter row on (chapter_id, metric)', async () => {
    await harness.expectTenantScoped(CHAPTER_B, () =>
      repo.upsert(
        CHAPTER_B,
        'points',
        { everyone: 60, roles: [] },
        '0b000000-0000-4000-8000-0000000000f1',
      ),
    );

    const rows = harness.rows('chapter_goals');
    expect(rows.find((r) => r.id === 'goal-b')).toMatchObject({
      goals: { everyone: 60, roles: [] },
    });
    // Same metric in A: only a conflict target that includes chapter_id
    // spares it.
    expect(rows.find((r) => r.id === 'goal-a')).toMatchObject({
      chapter_id: CHAPTER_A,
      goals: GOALS,
    });
  });
});
