import { SupabaseChapterDriveLinkRepository } from './supabase-chapter-drive-link.repository';
import {
  CHAPTER_A,
  CHAPTER_B,
  USER_SHARED,
  createTenantHarness,
  inA,
  inB,
  type TenantHarness,
} from '#test/helpers/tenant-scope.harness';

/**
 * Tenant scope for `chapter_drive_links` (#5434).
 *
 * Member-facing reads and writes are by chapter. Unscoped on purpose: the
 * worker's claim (every chapter's due links) and its write back to a row it
 * leased, by id.
 */

const LINK_A = '0a000000-0000-4000-8000-000000000520';
const LINK_B = '0b000000-0000-4000-8000-000000000520';
// One id in both chapters, so only the chapter filter tells the rows apart.
const DOC = '0c000000-0000-4000-8000-000000000521';
const DUE = '2026-11-17T00:00:00.000Z';

const link = (id: string, documentId: string) => ({
  id,
  document_id: documentId,
  file_id: 'drive-file',
  resource_key: null,
  linked_by: USER_SHARED,
  proven: false,
  sync_due_at: DUE,
  sync_lease_until: null,
  last_error: null,
  created_at: DUE,
});

describe('SupabaseChapterDriveLinkRepository — tenant scope', () => {
  let harness: TenantHarness;
  let repo: SupabaseChapterDriveLinkRepository;
  const row = (id: string) =>
    harness.rows('chapter_drive_links').find((r) => r.id === id);

  beforeEach(() => {
    harness = createTenantHarness({
      tables: {
        chapter_drive_links: [inA(link(LINK_A, DOC)), inB(link(LINK_B, DOC))],
      },
    });
    repo = new SupabaseChapterDriveLinkRepository(harness.client);
  });

  it('create writes the chapter given', async () => {
    const created = await harness.expectTenantScoped(CHAPTER_B, () =>
      repo.create({
        chapter_id: CHAPTER_B,
        document_id: '0b000000-0000-4000-8000-000000000522',
        file_id: 'drive-file-2',
        resource_key: null,
        linked_by: USER_SHARED,
        proven: true,
      }),
    );
    expect(created).toMatchObject({ chapter_id: CHAPTER_B });
  });

  it('findByDocument reads the caller chapter only', async () => {
    const found = await harness.expectTenantScoped(CHAPTER_A, () =>
      repo.findByDocument(DOC, CHAPTER_A),
    );
    expect(found?.id).toBe(LINK_A);
  });

  it('markDue touches the caller chapter’s link only', async () => {
    const now = new Date('2026-11-17T01:00:00.000Z');
    await expect(
      harness.expectTenantScoped(CHAPTER_A, () =>
        repo.markDue(DOC, CHAPTER_A, now),
      ),
    ).resolves.toBe(true);
    expect(row(LINK_A)?.sync_due_at).toBe(now.toISOString());
    expect(row(LINK_B)?.sync_due_at).toBe(DUE);
  });

  it('finish writes the leased row by id and releases its lease', async () => {
    await repo.finish(LINK_A, { last_error: 'no_access' });
    expect(row(LINK_A)).toMatchObject({
      last_error: 'no_access',
      sync_lease_until: null,
    });
    expect(row(LINK_B)?.last_error).toBeNull();
  });
});
