import { SupabaseChapterDocumentStarRepository } from './supabase-chapter-document-star.repository';
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
 * Tenant and member scope for `chapter_document_stars` (#3934).
 *
 * Two boundaries, both enforced only here, since the table has RLS on with
 * no policies and the API reads it through the service role: a member's
 * stars in one chapter never show in another, and one member never reads or
 * removes another's. `USER_SHARED` belongs to both chapters, so a dropped
 * `chapter_id` filter returns the other chapter's twin; `USER_A` stars the
 * same folder, so a dropped `user_id` filter returns their row.
 */

const FOLDER_A = '0a000000-0000-4000-8000-000000003934';
const FOLDER_B = '0b000000-0000-4000-8000-000000003934';
const DOC_A = '0a000000-0000-4000-8000-000000003935';
const DOC_B = '0b000000-0000-4000-8000-000000003935';

const STAR_FOLDER_A = '0a000000-0000-4000-8000-000000003940';
const STAR_FOLDER_B = '0b000000-0000-4000-8000-000000003940';
const STAR_DOC_A = '0a000000-0000-4000-8000-000000003941';
const STAR_DOC_B = '0b000000-0000-4000-8000-000000003941';
const STAR_OTHER_A = '0a000000-0000-4000-8000-000000003942';
const STAR_OTHER_B = '0b000000-0000-4000-8000-000000003942';

const seed = () => ({
  chapter_document_stars: [
    inA({
      id: STAR_FOLDER_A,
      user_id: USER_SHARED,
      folder_id: FOLDER_A,
      document_id: null,
      created_at: '2026-11-01T00:00:00.000Z',
    }),
    inB({
      id: STAR_FOLDER_B,
      user_id: USER_SHARED,
      folder_id: FOLDER_B,
      document_id: null,
      created_at: '2026-11-01T00:00:00.000Z',
    }),
    inA({
      id: STAR_DOC_A,
      user_id: USER_SHARED,
      folder_id: null,
      document_id: DOC_A,
      created_at: '2026-11-02T00:00:00.000Z',
    }),
    inB({
      id: STAR_DOC_B,
      user_id: USER_SHARED,
      folder_id: null,
      document_id: DOC_B,
      created_at: '2026-11-02T00:00:00.000Z',
    }),
    inA({
      id: STAR_OTHER_A,
      user_id: USER_A,
      folder_id: FOLDER_A,
      document_id: null,
      created_at: '2026-11-03T00:00:00.000Z',
    }),
    inB({
      id: STAR_OTHER_B,
      user_id: USER_A,
      folder_id: FOLDER_B,
      document_id: null,
      created_at: '2026-11-03T00:00:00.000Z',
    }),
  ],
});

describe('SupabaseChapterDocumentStarRepository — tenant scope', () => {
  let harness: TenantHarness;
  let repo: SupabaseChapterDocumentStarRepository;

  beforeEach(() => {
    harness = createTenantHarness({
      tables: seed(),
      collisionExempt: {
        // The A/B twins differ on their targets by construction.
        chapter_document_stars: ['user_id', 'folder_id', 'document_id'],
      },
    });
    repo = new SupabaseChapterDocumentStarRepository(harness.client);
  });

  const ids = () => harness.rows('chapter_document_stars').map((r) => r.id);

  it("findByUser returns only the member's own stars in the caller chapter", async () => {
    const stars = await harness.expectTenantScoped(CHAPTER_B, () =>
      repo.findByUser(USER_SHARED, CHAPTER_B),
    );

    expect(stars.map((s) => s.id)).toEqual([STAR_FOLDER_B, STAR_DOC_B]);
  });

  it('add is idempotent and stamps the chapter it is given', async () => {
    await harness.expectTenantScoped(CHAPTER_B, () =>
      repo.add(USER_SHARED, CHAPTER_B, { folder_id: FOLDER_B }),
    );
    const rows = harness
      .rows('chapter_document_stars')
      .filter((r) => r.user_id === USER_SHARED && r.folder_id === FOLDER_B);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.chapter_id).toBe(CHAPTER_B);
  });

  it('add writes a new document star with only the document set', async () => {
    const NEW_DOC = '0b000000-0000-4000-8000-000000003999';
    await harness.expectTenantScoped(CHAPTER_B, () =>
      repo.add(USER_A, CHAPTER_B, { document_id: NEW_DOC }),
    );
    const row = harness
      .rows('chapter_document_stars')
      .find((r) => r.document_id === NEW_DOC);
    expect(row).toMatchObject({
      user_id: USER_A,
      chapter_id: CHAPTER_B,
      folder_id: null,
    });
  });

  it("remove deletes the member's own folder star and nobody else's", async () => {
    await harness.expectTenantScoped(CHAPTER_B, () =>
      repo.remove(USER_SHARED, CHAPTER_B, { folder_id: FOLDER_B }),
    );

    expect(ids()).not.toContain(STAR_FOLDER_B);
    expect(ids()).toEqual(
      expect.arrayContaining([STAR_FOLDER_A, STAR_OTHER_B, STAR_DOC_B]),
    );
  });

  it('remove will not reach a star in another chapter', async () => {
    await harness.expectTenantScoped(CHAPTER_B, () =>
      repo.remove(USER_SHARED, CHAPTER_B, { document_id: DOC_A }),
    );

    expect(ids()).toContain(STAR_DOC_A);
  });

  it('remove deletes a document star', async () => {
    await harness.expectTenantScoped(CHAPTER_A, () =>
      repo.remove(USER_SHARED, CHAPTER_A, { document_id: DOC_A }),
    );

    expect(ids()).not.toContain(STAR_DOC_A);
    expect(ids()).toContain(STAR_DOC_B);
  });
});
