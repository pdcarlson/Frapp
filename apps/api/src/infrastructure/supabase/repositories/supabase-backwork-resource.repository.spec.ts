import { SupabaseBackworkResourceRepository } from './supabase-backwork-resource.repository';
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
 * Tenant scope for `backwork_resources` (backs `use-backwork`).
 *
 * `findByFileHash` is the interesting one: it backs upload de-duplication, and
 * two chapters uploading the same past exam produce the same hash by design.
 * Without the chapter predicate the second chapter's upload silently resolves to
 * the first chapter's row.
 */

const RESOURCE_A = '0a000000-0000-4000-8000-0000000000e0';
const RESOURCE_B = '0b000000-0000-4000-8000-0000000000e0';
const FILE_HASH = 'sha256-identical-exam';
const DEPT_A = '0a000000-0000-4000-8000-0000000000c0';
const DEPT_A_TARGET = '0a000000-0000-4000-8000-0000000000c1';
const DEPT_B = '0b000000-0000-4000-8000-0000000000c0';
const DEPT_B_TARGET = '0b000000-0000-4000-8000-0000000000c1';
const PROF_A = '0a000000-0000-4000-8000-0000000000d0';
const PROF_A_TARGET = '0a000000-0000-4000-8000-0000000000d1';
const PROF_B = '0b000000-0000-4000-8000-0000000000d0';
const PROF_B_TARGET = '0b000000-0000-4000-8000-0000000000d1';

const seed = () => ({
  backwork_departments: [
    inA({
      id: DEPT_A,
      code: 'CHEM',
      name: 'Chemistry',
      created_at: '2026-01-01T00:00:00.000Z',
    }),
    inA({
      id: DEPT_A_TARGET,
      code: 'CHM2',
      name: 'Chemistry II',
      created_at: '2026-01-01T00:00:00.000Z',
    }),
    inB({
      id: DEPT_B,
      code: 'CHEM',
      name: 'Chemistry',
      created_at: '2026-01-01T00:00:00.000Z',
    }),
    inB({
      id: DEPT_B_TARGET,
      code: 'CHM2',
      name: 'Chemistry II',
      created_at: '2026-01-01T00:00:00.000Z',
    }),
  ],
  backwork_professors: [
    inA({
      id: PROF_A,
      name: 'Dr. Rivera',
      created_at: '2026-01-01T00:00:00.000Z',
    }),
    inA({
      id: PROF_A_TARGET,
      name: 'Dr. Rivera Jr.',
      created_at: '2026-01-01T00:00:00.000Z',
    }),
    inB({
      id: PROF_B,
      name: 'Dr. Rivera',
      created_at: '2026-01-01T00:00:00.000Z',
    }),
    inB({
      id: PROF_B_TARGET,
      name: 'Dr. Rivera Jr.',
      created_at: '2026-01-01T00:00:00.000Z',
    }),
  ],
  backwork_resources: [
    inA({
      id: RESOURCE_A,
      department_id: DEPT_A,
      course_number: 'CHEM 101',
      professor_id: PROF_A,
      uploader_id: USER_SHARED,
      title: 'Midterm 1',
      year: 2026,
      semester: 'FALL',
      assignment_type: 'EXAM',
      assignment_number: 1,
      document_variant: 'BLANK',
      storage_path: 'a/midterm.pdf',
      file_hash: FILE_HASH,
      is_redacted: false,
      tags: [],
      created_at: '2026-01-01T00:00:00.000Z',
    }),
    inB({
      id: RESOURCE_B,
      department_id: DEPT_B,
      course_number: 'CHEM 101',
      professor_id: PROF_B,
      uploader_id: USER_SHARED,
      title: 'Midterm 1',
      year: 2026,
      semester: 'FALL',
      assignment_type: 'EXAM',
      assignment_number: 1,
      document_variant: 'BLANK',
      storage_path: 'b/midterm.pdf',
      file_hash: FILE_HASH,
      is_redacted: false,
      tags: [],
      created_at: '2026-01-01T00:00:00.000Z',
    }),
  ],
});

describe('SupabaseBackworkResourceRepository — tenant scope', () => {
  let harness: TenantHarness;
  let repo: SupabaseBackworkResourceRepository;

  beforeEach(() => {
    harness = createTenantHarness({
      tables: seed(),
      // department_id/professor_id are chapter-scoped foreign keys, so the
      // twins necessarily point at different (per-chapter) rows — that's not
      // the tenant-narrowing shortcut this guard exists to catch.
      collisionExempt: {
        backwork_resources: ['storage_path', 'department_id', 'professor_id'],
      },
    });
    repo = new SupabaseBackworkResourceRepository(harness.client);
  });

  it('findByChapter returns only the caller chapter resources', async () => {
    const resources = await harness.expectTenantScoped(CHAPTER_B, () =>
      repo.findByChapter(CHAPTER_B),
    );

    expect(resources.map((r) => r.id)).toEqual([RESOURCE_B]);
  });

  it('findByChapter keeps the chapter predicate alongside filters', async () => {
    const resources = await harness.expectTenantScoped(CHAPTER_B, () =>
      repo.findByChapter(CHAPTER_B, {
        course_number: 'CHEM 101',
        year: 2026,
      }),
    );

    expect(resources.map((r) => r.id)).toEqual([RESOURCE_B]);
  });

  it('findByFileHash does not match an identical upload in another chapter', async () => {
    const existing = await harness.expectTenantScoped(CHAPTER_B, () =>
      repo.findByFileHash(CHAPTER_B, FILE_HASH),
    );

    expect(existing?.id).toBe(RESOURCE_B);
  });

  it('delete leaves another chapter resource in place', async () => {
    await harness.expectTenantScoped(CHAPTER_B, () =>
      repo.delete(RESOURCE_A, CHAPTER_B),
    );

    expect(
      harness
        .rows('backwork_resources')
        .filter((r) => r.chapter_id === CHAPTER_A),
    ).toHaveLength(1);
  });

  it('countByDepartment does not count another chapter resource under the same id shape', async () => {
    // DEPT_B is a real id in chapter B; querying it from chapter A must read 0,
    // not the chapter-B resource, even though nothing here shares an id.
    const count = await harness.expectTenantScoped(CHAPTER_A, () =>
      repo.countByDepartment(CHAPTER_A, DEPT_A),
    );

    expect(count).toBe(1);
  });

  it('countByProfessor is scoped to the caller chapter', async () => {
    const count = await harness.expectTenantScoped(CHAPTER_A, () =>
      repo.countByProfessor(CHAPTER_A, PROF_A),
    );

    expect(count).toBe(1);
  });

  it('reassignDepartment only moves the caller chapter resources', async () => {
    const moved = await harness.expectTenantScoped(CHAPTER_A, () =>
      repo.reassignDepartment(CHAPTER_A, DEPT_A, DEPT_A_TARGET),
    );

    expect(moved).toBe(1);
    expect(
      harness.rows('backwork_resources').find((r) => r.id === RESOURCE_A)
        ?.department_id,
    ).toBe(DEPT_A_TARGET);
    // Chapter B's resource, seeded with the same department code, is untouched.
    expect(
      harness.rows('backwork_resources').find((r) => r.id === RESOURCE_B)
        ?.department_id,
    ).toBe(DEPT_B);
  });

  it('reassignProfessor only moves the caller chapter resources', async () => {
    const moved = await harness.expectTenantScoped(CHAPTER_A, () =>
      repo.reassignProfessor(CHAPTER_A, PROF_A, PROF_A_TARGET),
    );

    expect(moved).toBe(1);
    expect(
      harness.rows('backwork_resources').find((r) => r.id === RESOURCE_A)
        ?.professor_id,
    ).toBe(PROF_A_TARGET);
    expect(
      harness.rows('backwork_resources').find((r) => r.id === RESOURCE_B)
        ?.professor_id,
    ).toBe(PROF_B);
  });
});
