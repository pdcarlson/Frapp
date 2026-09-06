import { SupabaseBackworkDepartmentRepository } from './supabase-backwork-department.repository';
import {
  CHAPTER_B,
  createTenantHarness,
  inA,
  inB,
  type TenantHarness,
} from '#test/helpers/tenant-scope.harness';

/**
 * Tenant scope for `backwork_departments` (backs `use-backwork`).
 *
 * Department codes are university-wide strings — two chapters at the same
 * school hold the identical "CHEM" row — so `findByCode` is only correct with
 * its chapter predicate.
 */

const DEPT_A = '0a000000-0000-4000-8000-0000000000c0';
const DEPT_B = '0b000000-0000-4000-8000-0000000000c0';

const seed = () => ({
  backwork_departments: [
    inA({
      id: DEPT_A,
      code: 'CHEM',
      name: 'Chemistry',
      created_at: '2026-01-01T00:00:00.000Z',
    }),
    inB({
      id: DEPT_B,
      code: 'CHEM',
      name: 'Chemistry',
      created_at: '2026-01-01T00:00:00.000Z',
    }),
  ],
});

describe('SupabaseBackworkDepartmentRepository — tenant scope', () => {
  let harness: TenantHarness;
  let repo: SupabaseBackworkDepartmentRepository;

  beforeEach(() => {
    harness = createTenantHarness({ tables: seed() });
    repo = new SupabaseBackworkDepartmentRepository(harness.client);
  });

  it('findByChapter returns only the caller chapter departments', async () => {
    const departments = await harness.expectTenantScoped(CHAPTER_B, () =>
      repo.findByChapter(CHAPTER_B),
    );

    expect(departments.map((d) => d.id)).toEqual([DEPT_B]);
  });

  it('findByCode does not resolve the same code in another chapter', async () => {
    const department = await harness.expectTenantScoped(CHAPTER_B, () =>
      repo.findByCode(CHAPTER_B, 'CHEM'),
    );

    expect(department?.id).toBe(DEPT_B);
  });

  it('update refuses an id belonging to another chapter', async () => {
    const updated = await harness.expectTenantScoped(CHAPTER_B, () =>
      repo.update(DEPT_A, CHAPTER_B, { name: 'Renamed' }),
    );

    expect(updated).toBeNull();
    expect(
      harness.rows('backwork_departments').find((d) => d.id === DEPT_A)?.name,
    ).toBe('Chemistry');
  });

  it('findById resolves to null for an id belonging to another chapter', async () => {
    const found = await harness.expectTenantScoped(CHAPTER_B, () =>
      repo.findById(DEPT_A, CHAPTER_B),
    );

    expect(found).toBeNull();
  });

  it('delete refuses an id belonging to another chapter', async () => {
    await harness.expectTenantScoped(CHAPTER_B, () =>
      repo.delete(DEPT_A, CHAPTER_B),
    );

    expect(
      harness.rows('backwork_departments').some((d) => d.id === DEPT_A),
    ).toBe(true);
  });
});
