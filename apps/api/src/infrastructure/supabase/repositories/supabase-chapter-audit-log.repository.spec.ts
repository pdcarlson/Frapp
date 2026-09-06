import { SupabaseChapterAuditLogRepository } from './supabase-chapter-audit-log.repository';
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
 * Tenant scope for `chapter_audit_log` (#334). Every mutation reaches this
 * table, so a dropped `chapter_id` predicate here is a read that leaks
 * another chapter's officer-action history, not just a display bug.
 */

const LOG_A = '0a000000-0000-4000-8000-000000000040';
const LOG_B = '0b000000-0000-4000-8000-000000000040';

const seed = () => ({
  chapter_audit_log: [
    inA({
      id: LOG_A,
      actor_user_id: USER_SHARED,
      action: 'member_removed',
      target_type: 'member',
      target_id: 'member-1',
      scope: 'chapter',
      diff: {},
      member_visible: true,
      created_at: '2026-06-01T00:00:00.000Z',
    }),
    inB({
      id: LOG_B,
      actor_user_id: USER_SHARED,
      action: 'member_removed',
      target_type: 'member',
      target_id: 'member-1',
      scope: 'chapter',
      diff: {},
      member_visible: true,
      created_at: '2026-06-01T00:00:00.000Z',
    }),
  ],
});

describe('SupabaseChapterAuditLogRepository — tenant scope', () => {
  let harness: TenantHarness;
  let repo: SupabaseChapterAuditLogRepository;

  beforeEach(() => {
    harness = createTenantHarness({ tables: seed() });
    repo = new SupabaseChapterAuditLogRepository(harness.client);
  });

  it('findByChapter returns only the caller chapter history', async () => {
    const rows = await harness.expectTenantScoped(CHAPTER_B, () =>
      repo.findByChapter(CHAPTER_B, { limit: 50 }),
    );

    expect(rows.map((r) => r.id)).toEqual([LOG_B]);
  });

  it('findByChapter applies the before cursor alongside the chapter predicate', async () => {
    const rows = await harness.expectTenantScoped(CHAPTER_B, () =>
      repo.findByChapter(CHAPTER_B, {
        before: '2027-01-01T00:00:00.000Z',
        limit: 50,
      }),
    );

    expect(rows.map((r) => r.id)).toEqual([LOG_B]);
  });

  it('create writes the entry under the caller chapter', async () => {
    const created = await harness.expectTenantScoped(CHAPTER_A, () =>
      repo.create({
        id: '0a000000-0000-4000-8000-000000000041',
        chapter_id: CHAPTER_A,
        actor_user_id: USER_SHARED,
        action: 'member_removed',
        target_type: 'member',
        target_id: 'member-2',
        scope: 'chapter',
        diff: {},
        member_visible: true,
      }),
    );

    expect(created.chapter_id).toBe(CHAPTER_A);
  });

  it('never issues an update or delete — the table is append-only', async () => {
    await harness.expectTenantScoped(CHAPTER_B, () =>
      repo.findByChapter(CHAPTER_B, { limit: 50 }),
    );
    await harness.expectTenantScoped(CHAPTER_A, () =>
      repo.create({
        id: '0a000000-0000-4000-8000-000000000042',
        chapter_id: CHAPTER_A,
        actor_user_id: USER_SHARED,
        action: 'member_removed',
        target_type: 'member',
        target_id: 'member-3',
        scope: 'chapter',
        diff: {},
        member_visible: true,
      }),
    );

    const modes = harness.ops.map((op) => op.mode);
    expect(modes).not.toContain('update');
    expect(modes).not.toContain('delete');
  });
});
