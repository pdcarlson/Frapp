import { SupabaseBackworkResourceRepository } from './supabase-backwork-resource.repository';
import type { BackworkPublishedColumns } from '#domain/repositories/backwork.repository.interface';
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

  it('findByIds signs nothing from another chapter, even when asked by id', async () => {
    const resources = await harness.expectTenantScoped(CHAPTER_B, () =>
      repo.findByIds([RESOURCE_A, RESOURCE_B], CHAPTER_B),
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

  it('countByDepartment is scoped to the caller chapter', async () => {
    // `expectTenantScoped` fails this test outright if the query is missing
    // its `.eq('chapter_id', ...)` predicate, regardless of which ids are
    // passed in — so this is a structural guarantee, not merely "these two
    // particular ids don't collide."
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

/**
 * Drafts (#5208): a row with `draft_fields` set is visible only to its
 * uploader. These filters are what keeps a half-filled exam out of the
 * chapter's library, so they get CI-run coverage here as well as the
 * live-PostgREST integration suite. Every pair is a colliding twin, so the
 * chapter predicate is proven too.
 */
describe('SupabaseBackworkResourceRepository — drafts', () => {
  const PUBLISHED_A = '0a000000-0000-4000-8000-0000000000f0';
  const PUBLISHED_B = '0b000000-0000-4000-8000-0000000000f0';
  const MINE_A = '0a000000-0000-4000-8000-0000000000f1';
  const MINE_B = '0b000000-0000-4000-8000-0000000000f1';
  const THEIRS_A = '0a000000-0000-4000-8000-0000000000f2';
  const THEIRS_B = '0b000000-0000-4000-8000-0000000000f2';

  const row = (
    id: string,
    uploaderId: string,
    draft: object | null,
    hash: string,
  ) => ({
    id,
    department_id: null,
    course_number: null,
    professor_id: null,
    uploader_id: uploaderId,
    title: draft ? null : 'Published midterm',
    year: null,
    semester: null,
    assignment_type: null,
    assignment_number: null,
    document_variant: null,
    storage_path: `drafts/${hash}.pdf`,
    file_hash: hash,
    is_redacted: true,
    tags: [],
    draft_fields: draft,
    created_at: '2026-01-01T00:00:00.000Z',
  });

  const published: BackworkPublishedColumns = {
    title: 'Final title',
    department_id: null,
    course_number: null,
    professor_id: null,
    year: 2025,
    semester: 'Fall',
    assignment_type: null,
    assignment_number: null,
    document_variant: null,
    tags: [],
  };
  let harness: TenantHarness;
  let repo: SupabaseBackworkResourceRepository;

  beforeEach(() => {
    harness = createTenantHarness({
      tables: {
        backwork_resources: [
          inA(row(PUBLISHED_A, USER_SHARED, null, 'published')),
          inB(row(PUBLISHED_B, USER_SHARED, null, 'published')),
          inA(row(MINE_A, USER_SHARED, { title: 'My draft' }, 'mine')),
          inB(row(MINE_B, USER_SHARED, { title: 'My draft' }, 'mine')),
          inA(row(THEIRS_A, USER_A, { title: 'Their draft' }, 'theirs')),
          inB(row(THEIRS_B, USER_A, { title: 'Their draft' }, 'theirs')),
        ],
      },
      collisionExempt: { backwork_resources: ['storage_path'] },
    });
    repo = new SupabaseBackworkResourceRepository(harness.client);
  });

  it('leaves every draft out of the library, the single read and the zip links', async () => {
    const list = await harness.expectTenantScoped(CHAPTER_B, () =>
      repo.findByChapter(CHAPTER_B),
    );
    expect(list.map((r) => r.id)).toEqual([PUBLISHED_B]);

    await expect(
      harness.expectTenantScoped(CHAPTER_B, () =>
        repo.findById(MINE_B, CHAPTER_B),
      ),
    ).resolves.toBeNull();

    const zipped = await harness.expectTenantScoped(CHAPTER_B, () =>
      repo.findByIds([PUBLISHED_B, MINE_B, THEIRS_B], CHAPTER_B),
    );
    expect(zipped.map((r) => r.id)).toEqual([PUBLISHED_B]);
  });

  it('finds a draft by id only when asked to, for the admin delete', async () => {
    const found = await harness.expectTenantScoped(CHAPTER_B, () =>
      repo.findById(THEIRS_B, CHAPTER_B, { includeDrafts: true }),
    );
    expect(found?.id).toBe(THEIRS_B);
  });

  it('still finds a draft by its file hash, so a re-upload is a duplicate', async () => {
    const existing = await harness.expectTenantScoped(CHAPTER_B, () =>
      repo.findByFileHash(CHAPTER_B, 'theirs'),
    );
    expect(existing?.id).toBe(THEIRS_B);
  });

  it("lists and reads only the uploader's own drafts", async () => {
    const mine = await harness.expectTenantScoped(CHAPTER_B, () =>
      repo.findDrafts(CHAPTER_B, USER_SHARED),
    );
    expect(mine.map((r) => r.id)).toEqual([MINE_B]);

    const asked = await harness.expectTenantScoped(CHAPTER_B, () =>
      repo.findDraftsByIds(
        [MINE_B, THEIRS_B, PUBLISHED_B],
        CHAPTER_B,
        USER_SHARED,
      ),
    );
    expect(asked.map((r) => r.id)).toEqual([MINE_B]);
  });

  it("never edits, publishes or deletes someone else's draft", async () => {
    await expect(
      harness.expectTenantScoped(CHAPTER_B, () =>
        repo.updateDraftFields(THEIRS_B, CHAPTER_B, USER_SHARED, {
          title: 'Hijacked',
        }),
      ),
    ).resolves.toBeNull();
    await expect(
      harness.expectTenantScoped(CHAPTER_B, () =>
        repo.publishDraft(THEIRS_B, CHAPTER_B, USER_SHARED, published),
      ),
    ).resolves.toBeNull();
    await expect(
      harness.expectTenantScoped(CHAPTER_B, () =>
        repo.deleteDraft(THEIRS_B, CHAPTER_B, USER_SHARED),
      ),
    ).resolves.toBe(false);

    const theirs = harness
      .rows('backwork_resources')
      .find((r) => r.id === THEIRS_B);
    expect(theirs?.draft_fields).toEqual({ title: 'Their draft' });
  });

  it('lets one AI fill hold a draft at a time, until it releases or goes stale', async () => {
    const now = new Date('2026-11-17T12:00:00.000Z');
    const stale = new Date(now.getTime() - 5 * 60_000);
    const claim = await harness.expectTenantScoped(CHAPTER_B, () =>
      repo.claimAiFill(MINE_B, CHAPTER_B, USER_SHARED, now, stale),
    );
    expect(claim).toBe(now.toISOString());

    // A second fill a moment later finds the claim and gets nothing.
    const later = new Date(now.getTime() + 1_000);
    await expect(
      harness.expectTenantScoped(CHAPTER_B, () =>
        repo.claimAiFill(
          MINE_B,
          CHAPTER_B,
          USER_SHARED,
          later,
          new Date(later.getTime() - 5 * 60_000),
        ),
      ),
    ).resolves.toBeNull();

    // Chapter A's twin is untouched.
    expect(
      harness.rows('backwork_resources').find((r) => r.id === MINE_A)
        ?.ai_fill_started_at,
    ).toBeUndefined();

    await harness.expectTenantScoped(CHAPTER_B, () =>
      repo.releaseAiFill(MINE_B, CHAPTER_B, claim!),
    );
    await expect(
      harness.expectTenantScoped(CHAPTER_B, () =>
        repo.claimAiFill(MINE_B, CHAPTER_B, USER_SHARED, later, stale),
      ),
    ).resolves.toBe(later.toISOString());

    // Ten minutes on, a claim nobody released is taken over.
    const muchLater = new Date(now.getTime() + 10 * 60_000);
    await expect(
      harness.expectTenantScoped(CHAPTER_B, () =>
        repo.claimAiFill(
          MINE_B,
          CHAPTER_B,
          USER_SHARED,
          muchLater,
          new Date(muchLater.getTime() - 5 * 60_000),
        ),
      ),
    ).resolves.toBe(muchLater.toISOString());

    // A release of the stale claim leaves the new one in place.
    await harness.expectTenantScoped(CHAPTER_B, () =>
      repo.releaseAiFill(MINE_B, CHAPTER_B, later.toISOString()),
    );
    expect(
      harness.rows('backwork_resources').find((r) => r.id === MINE_B)
        ?.ai_fill_started_at,
    ).toBe(muchLater.toISOString());
  });

  it("never claims someone else's draft or a published row for an AI fill", async () => {
    const now = new Date('2026-11-17T12:00:00.000Z');
    const stale = new Date(now.getTime() - 5 * 60_000);
    for (const id of [THEIRS_B, PUBLISHED_B]) {
      await expect(
        harness.expectTenantScoped(CHAPTER_B, () =>
          repo.claimAiFill(id, CHAPTER_B, USER_SHARED, now, stale),
        ),
      ).resolves.toBeNull();
    }
  });

  it('publishes a draft once, stamped with the time it was published', async () => {
    const row = await harness.expectTenantScoped(CHAPTER_B, () =>
      repo.publishDraft(MINE_B, CHAPTER_B, USER_SHARED, published),
    );
    expect(row).toMatchObject({ ...published, draft_fields: null });
    expect(row!.created_at > '2026-01-01T00:00:00.000Z').toBe(true);

    await expect(
      harness.expectTenantScoped(CHAPTER_B, () =>
        repo.publishDraft(MINE_B, CHAPTER_B, USER_SHARED, published),
      ),
    ).resolves.toBeNull();
    // Chapter A's twin stays a draft.
    expect(
      harness.rows('backwork_resources').find((r) => r.id === MINE_A)
        ?.draft_fields,
    ).toEqual({ title: 'My draft' });
  });
});
