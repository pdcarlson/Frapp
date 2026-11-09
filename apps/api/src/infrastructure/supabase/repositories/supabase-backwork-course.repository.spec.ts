import { SupabaseBackworkCourseRepository } from './supabase-backwork-course.repository';
import {
  CHAPTER_B,
  createTenantHarness,
  inA,
  inB,
  type TenantHarness,
} from '#test/helpers/tenant-scope.harness';

/**
 * Tenant scope for `backwork_courses` (backs `useBackworkCourses`).
 *
 * Two chapters at one school name the same course the same way, so every
 * lookup by department and number is only correct with its chapter predicate.
 */

const DEPT = '0a000000-0000-4000-8000-0000000000d0';
const COURSE_A = '0a000000-0000-4000-8000-0000000000c1';
const COURSE_B = '0b000000-0000-4000-8000-0000000000c1';

const course = {
  department_id: DEPT,
  course_number: '1010',
  course_key: '1010',
  name: 'Calculus I',
  nicknames: ['Calc 1'],
  created_at: '2026-01-01T00:00:00.000Z',
  updated_at: '2026-01-01T00:00:00.000Z',
};

const seed = () => ({
  backwork_courses: [
    inA({ id: COURSE_A, ...course }),
    inB({ id: COURSE_B, ...course }),
  ],
});

describe('SupabaseBackworkCourseRepository — tenant scope', () => {
  let harness: TenantHarness;
  let repo: SupabaseBackworkCourseRepository;

  beforeEach(() => {
    harness = createTenantHarness({
      tables: seed(),
      rpc: {
        backwork_course_write: { data: { id: COURSE_B, ...course } },
      },
    });
    repo = new SupabaseBackworkCourseRepository(harness.client);
  });

  it('findByChapter returns only the caller chapter courses', async () => {
    const courses = await harness.expectTenantScoped(CHAPTER_B, () =>
      repo.findByChapter(CHAPTER_B),
    );

    expect(courses.map((c) => c.id)).toEqual([COURSE_B]);
  });

  it('findByDepartment returns only the caller chapter courses', async () => {
    const courses = await harness.expectTenantScoped(CHAPTER_B, () =>
      repo.findByDepartment(CHAPTER_B, DEPT),
    );

    expect(courses.map((c) => c.id)).toEqual([COURSE_B]);
  });

  it('findByCourse matches the number trimmed and case-insensitively, in the caller chapter only', async () => {
    const found = await harness.expectTenantScoped(CHAPTER_B, () =>
      repo.findByCourse(CHAPTER_B, DEPT, ' 1010 '),
    );

    expect(found?.id).toBe(COURSE_B);
  });

  it('findById resolves to null for an id belonging to another chapter', async () => {
    const found = await harness.expectTenantScoped(CHAPTER_B, () =>
      repo.findById(COURSE_A, CHAPTER_B),
    );

    expect(found).toBeNull();
  });

  it('update refuses an id belonging to another chapter', async () => {
    const updated = await harness.expectTenantScoped(CHAPTER_B, () =>
      repo.update(COURSE_A, CHAPTER_B, { name: 'Renamed' }),
    );

    expect(updated).toBeNull();
    expect(
      harness.rows('backwork_courses').find((c) => c.id === COURSE_A)?.name,
    ).toBe('Calculus I');
  });

  it('delete refuses an id belonging to another chapter', async () => {
    await harness.expectTenantScoped(CHAPTER_B, () =>
      repo.delete(COURSE_A, CHAPTER_B),
    );

    expect(
      harness.rows('backwork_courses').some((c) => c.id === COURSE_A),
    ).toBe(true);
  });

  it('write passes the chapter to the one-statement write', async () => {
    const written = await harness.expectTenantScoped(CHAPTER_B, () =>
      repo.write(CHAPTER_B, {
        departmentId: DEPT,
        courseNumber: '1010',
        setName: true,
        name: 'Calculus I',
        mayRename: false,
        add: ['Calc I'],
        remove: [],
      }),
    );

    expect(written?.id).toBe(COURSE_B);
    expect(harness.rpcCalls).toEqual([
      {
        fn: 'backwork_course_write',
        args: {
          p_chapter_id: CHAPTER_B,
          p_department_id: DEPT,
          p_course_number: '1010',
          p_set_name: true,
          p_name: 'Calculus I',
          p_may_rename: false,
          p_add: ['Calc I'],
          p_remove: [],
        },
      },
    ]);
  });
});
