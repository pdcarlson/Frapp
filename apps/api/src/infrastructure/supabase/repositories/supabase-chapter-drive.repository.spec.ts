import { SupabaseChapterDriveRepository } from './supabase-chapter-drive.repository';
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
 * Tenant scope for `chapter_drive_connections` (#5157).
 *
 * Officer-facing reads and writes are by chapter. Unscoped on purpose: the
 * worker's writes by row id, whose row came from the claim.
 */

const CONN_A = '0a000000-0000-4000-8000-000000000510';
const CONN_B = '0b000000-0000-4000-8000-000000000510';
const CONN_A_OLD = '0a000000-0000-4000-8000-000000000511';
const CONN_B_OLD = '0b000000-0000-4000-8000-000000000511';

const connection = (
  id: string,
  status: string,
  folderId: string,
  createdAt = '2026-11-16T00:00:00.000Z',
) => ({
  id,
  folder_id: folderId,
  folder_name: 'Chapter files',
  connected_by: USER_SHARED,
  status,
  sync_due_at: '2026-11-16T00:00:00.000Z',
  sync_lease_until: null,
  last_synced_at: null,
  last_error: null,
  synced_count: 0,
  skipped_count: 0,
  folders_left_out: 0,
  created_at: createdAt,
});

const seed = (live = 'active') => ({
  chapter_drive_connections: [
    inA(connection(CONN_A, live, 'folder-a')),
    inB(connection(CONN_B, live, 'folder-b', '2026-11-16T01:00:00.000Z')),
    inA(connection(CONN_A_OLD, 'disconnecting', 'folder-old-a')),
    inB(connection(CONN_B_OLD, 'disconnecting', 'folder-old-b')),
  ],
  chapter_document_folders: [
    inA({
      id: '0a000000-0000-4000-8000-000000000512',
      name: 'Chapter files / Rush',
      drive_folder_id: 'sub-a',
    }),
    inB({
      id: '0b000000-0000-4000-8000-000000000512',
      name: 'Chapter files / Rush',
      drive_folder_id: 'sub-1',
    }),
  ],
});

describe('SupabaseChapterDriveRepository — tenant scope', () => {
  let harness: TenantHarness;
  let repo: SupabaseChapterDriveRepository;
  const row = (id: string) =>
    harness.rows('chapter_drive_connections').find((r) => r.id === id);

  const start = (tables = seed()) => {
    harness = createTenantHarness({
      tables,
      // Two chapters may share one Drive folder with Frapp.
      collisionExempt: {
        chapter_drive_connections: ['folder_id', 'created_at'],
        chapter_document_folders: ['drive_folder_id'],
      },
    });
    repo = new SupabaseChapterDriveRepository(harness.client);
  };

  beforeEach(() => start());

  it('findLive reads the chapter’s live connection only', async () => {
    const found = await harness.expectTenantScoped(CHAPTER_A, () =>
      repo.findLive(CHAPTER_A),
    );
    expect(found?.id).toBe(CONN_A);
  });

  it('create writes the chapter given', async () => {
    const created = await harness.expectTenantScoped(CHAPTER_B, () =>
      repo.create({
        chapter_id: CHAPTER_B,
        folder_id: 'folder-2',
        folder_name: 'Rush',
        connected_by: USER_SHARED,
        who_can_see: null,
      }),
    );
    expect(created).toMatchObject({ chapter_id: CHAPTER_B });
  });

  it('markDue and disconnect touch the caller chapter only', async () => {
    const now = new Date('2026-11-16T01:00:00.000Z');
    await harness.expectTenantScoped(CHAPTER_A, () =>
      repo.markDue(CHAPTER_A, now),
    );
    expect(row(CONN_B)?.sync_due_at).toBe('2026-11-16T00:00:00.000Z');

    const done = await harness.expectTenantScoped(CHAPTER_B, () =>
      repo.disconnect(CHAPTER_B, now),
    );
    expect(done).toBe(true);
    expect(row(CONN_B)?.status).toBe('disconnecting');
    expect(row(CONN_A)?.status).toBe('active');
  });

  // #5583: picking an unshared folder again brings it back at once.
  it('restoreAccess turns only the caller chapter’s no_access connection active and due', async () => {
    const now = new Date('2026-11-16T01:00:00.000Z');
    await expect(repo.restoreAccess(CHAPTER_A, now)).resolves.toBe(false);
    expect(row(CONN_A)?.status).toBe('active');

    start(seed('no_access'));
    const done = await harness.expectTenantScoped(CHAPTER_A, () =>
      repo.restoreAccess(CHAPTER_A, now),
    );
    expect(done).toBe(true);
    expect(row(CONN_A)).toMatchObject({
      status: 'active',
      last_error: null,
      sync_due_at: now.toISOString(),
    });
    expect(row(CONN_B)?.status).toBe('no_access');
  });

  // #5185: answers only whether a folder is taken elsewhere, never rows.
  it('folderTakenElsewhere sees other chapters’ live and synced folders, not the caller’s or a leaving one', async () => {
    const taken = (chapter: string, ids: string[]) =>
      repo.folderTakenElsewhere(chapter, ids);
    await expect(taken(CHAPTER_A, ['folder-b'])).resolves.toBe(true);
    await expect(taken(CHAPTER_A, ['x', 'sub-1'])).resolves.toBe(true);
    await expect(taken(CHAPTER_A, ['folder-a'])).resolves.toBe(false);
    await expect(taken(CHAPTER_A, ['folder-old-b'])).resolves.toBe(false);
    await expect(taken(CHAPTER_B, ['sub-1'])).resolves.toBe(false);
    await expect(taken(CHAPTER_A, ['x'])).resolves.toBe(false);
    await expect(taken(CHAPTER_A, [])).resolves.toBe(false);

    // B leaving: its synced folders are on their way out.
    await repo.disconnect(CHAPTER_B, new Date('2026-11-16T02:00:00.000Z'));
    await expect(taken(CHAPTER_A, ['sub-1'])).resolves.toBe(false);
    await expect(taken(CHAPTER_A, ['folder-b'])).resolves.toBe(false);
  });

  it('folderIdsConnectedEarlierElsewhere lists other chapters’ live folders connected first', async () => {
    const earlier = (chapter: string, at: string) =>
      repo.folderIdsConnectedEarlierElsewhere(chapter, at);
    await expect(
      earlier(CHAPTER_A, '2026-11-16T02:00:00.000Z'),
    ).resolves.toEqual(new Set(['folder-b']));
    await expect(
      earlier(CHAPTER_A, '2026-11-16T00:30:00.000Z'),
    ).resolves.toEqual(new Set());
    await expect(
      earlier(CHAPTER_B, '2026-11-16T02:00:00.000Z'),
    ).resolves.toEqual(new Set(['folder-a']));
    await repo.disconnect(CHAPTER_B, new Date('2026-11-16T02:00:00.000Z'));
    await expect(
      earlier(CHAPTER_A, '2026-11-16T02:00:00.000Z'),
    ).resolves.toEqual(new Set());
  });

  it('finishSync leaves a disconnecting row disconnecting', async () => {
    await repo.finishSync(CONN_A_OLD, { status: 'active', last_error: null });
    expect(row(CONN_A_OLD)?.status).toBe('disconnecting');
  });

  it('delete removes only a disconnecting row', async () => {
    await repo.delete(CONN_A);
    expect(row(CONN_A)).toBeDefined();
    await repo.delete(CONN_A_OLD);
    expect(row(CONN_A_OLD)).toBeUndefined();
  });
});
