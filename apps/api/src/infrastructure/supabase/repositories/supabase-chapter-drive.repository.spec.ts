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

const connection = (id: string, status: string) => ({
  id,
  folder_id: 'folder-1',
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
  created_at: '2026-11-16T00:00:00.000Z',
});

const seed = () => ({
  chapter_drive_connections: [
    inA(connection(CONN_A, 'active')),
    inB(connection(CONN_B, 'active')),
    inA(connection(CONN_A_OLD, 'disconnecting')),
    inB(connection(CONN_B_OLD, 'disconnecting')),
  ],
});

describe('SupabaseChapterDriveRepository — tenant scope', () => {
  let harness: TenantHarness;
  let repo: SupabaseChapterDriveRepository;
  const row = (id: string) =>
    harness.rows('chapter_drive_connections').find((r) => r.id === id);

  beforeEach(() => {
    harness = createTenantHarness({
      tables: seed(),
      // Two chapters may share one Drive folder with Frapp.
      collisionExempt: { chapter_drive_connections: ['folder_id'] },
    });
    repo = new SupabaseChapterDriveRepository(harness.client);
  });

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
