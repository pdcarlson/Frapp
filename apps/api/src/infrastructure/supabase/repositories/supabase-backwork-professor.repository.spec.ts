import { SupabaseBackworkProfessorRepository } from './supabase-backwork-professor.repository';
import {
  CHAPTER_B,
  createTenantHarness,
  inA,
  inB,
  type TenantHarness,
} from '#test/helpers/tenant-scope.harness';

/**
 * Tenant scope for `backwork_professors` (backs `use-backwork`).
 *
 * `findByName` backs a get-or-create on upload, so a cross-chapter match does
 * not just read another chapter's row — it attaches this chapter's resource to
 * it.
 */

const PROF_A = '0a000000-0000-4000-8000-0000000000d0';
const PROF_B = '0b000000-0000-4000-8000-0000000000d0';

const seed = () => ({
  backwork_professors: [
    inA({
      id: PROF_A,
      name: 'Dr. Rivera',
      created_at: '2026-01-01T00:00:00.000Z',
    }),
    inB({
      id: PROF_B,
      name: 'Dr. Rivera',
      created_at: '2026-01-01T00:00:00.000Z',
    }),
  ],
});

describe('SupabaseBackworkProfessorRepository — tenant scope', () => {
  let harness: TenantHarness;
  let repo: SupabaseBackworkProfessorRepository;

  beforeEach(() => {
    harness = createTenantHarness({ tables: seed() });
    repo = new SupabaseBackworkProfessorRepository(harness.client);
  });

  it('findByChapter returns only the caller chapter professors', async () => {
    const professors = await harness.expectTenantScoped(CHAPTER_B, () =>
      repo.findByChapter(CHAPTER_B),
    );

    expect(professors.map((p) => p.id)).toEqual([PROF_B]);
  });

  it('findByName does not resolve the same professor in another chapter', async () => {
    const professor = await harness.expectTenantScoped(CHAPTER_B, () =>
      repo.findByName(CHAPTER_B, 'Dr. Rivera'),
    );

    expect(professor?.id).toBe(PROF_B);
  });

  it('findById resolves to null for an id belonging to another chapter', async () => {
    const found = await harness.expectTenantScoped(CHAPTER_B, () =>
      repo.findById(PROF_A, CHAPTER_B),
    );

    expect(found).toBeNull();
  });

  it('update refuses an id belonging to another chapter', async () => {
    const updated = await harness.expectTenantScoped(CHAPTER_B, () =>
      repo.update(PROF_A, CHAPTER_B, { name: 'Renamed' }),
    );

    expect(updated).toBeNull();
    expect(
      harness.rows('backwork_professors').find((p) => p.id === PROF_A)?.name,
    ).toBe('Dr. Rivera');
  });

  it('delete refuses an id belonging to another chapter', async () => {
    await harness.expectTenantScoped(CHAPTER_B, () =>
      repo.delete(PROF_A, CHAPTER_B),
    );

    expect(
      harness.rows('backwork_professors').some((p) => p.id === PROF_A),
    ).toBe(true);
  });
});
