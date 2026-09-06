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
// Extra CHAPTER_B rows so each filter has something to discriminate: without
// them every assertion below would pass on a repository that ignored its
// options entirely.
const LOG_B_OTHER_ACTOR = '0b000000-0000-4000-8000-000000000051';
const LOG_B_OTHER_ACTION = '0b000000-0000-4000-8000-000000000052';
const USER_OTHER = '00000000-0000-4000-8000-0000000000a1';
// Each B row needs an A twin identical in everything but chapter. The harness
// refuses an uneven seed, because a paired twin is what proves a filter
// narrowed on `chapter_id` rather than incidentally on the column under test.
const LOG_A_OTHER_ACTOR = '0a000000-0000-4000-8000-000000000051';
const LOG_A_OTHER_ACTION = '0a000000-0000-4000-8000-000000000052';
// One exec-only row per chapter (#1773). Seeded NEWEST so a repository that
// ignores `memberVisibleOnly` returns it first, where the ordered assertions
// below cannot miss it.
const LOG_A_EXEC_ONLY = '0a000000-0000-4000-8000-000000000053';
const LOG_B_EXEC_ONLY = '0b000000-0000-4000-8000-000000000053';

// One canonical timestamp spelling throughout. The tenant harness compares
// with `String(a).localeCompare(String(b))`, so it orders ISO strings
// lexicographically — correct for a single format, and unable to prove that
// '…Z' and '…+00:00' name the same instant. Postgres does that; this double
// does not, so do not read these cases as covering offset normalization.

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
    inA({
      id: LOG_A_OTHER_ACTOR,
      actor_user_id: USER_OTHER,
      action: 'member_removed',
      target_type: 'member',
      target_id: 'member-2',
      scope: 'chapter',
      diff: {},
      member_visible: true,
      created_at: '2026-07-01T00:00:00.000Z',
    }),
    inA({
      id: LOG_A_OTHER_ACTION,
      actor_user_id: USER_SHARED,
      action: 'chapter_config_updated',
      target_type: 'chapter',
      target_id: null,
      scope: 'chapter',
      diff: {},
      member_visible: true,
      created_at: '2026-08-01T00:00:00.000Z',
    }),
    inA({
      id: LOG_A_EXEC_ONLY,
      actor_user_id: USER_SHARED,
      action: 'member_removed',
      target_type: 'member',
      target_id: 'member-3',
      scope: 'chapter',
      diff: {},
      member_visible: false,
      created_at: '2026-09-01T00:00:00.000Z',
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
    inB({
      id: LOG_B_OTHER_ACTOR,
      actor_user_id: USER_OTHER,
      action: 'member_removed',
      target_type: 'member',
      target_id: 'member-2',
      scope: 'chapter',
      diff: {},
      member_visible: true,
      created_at: '2026-07-01T00:00:00.000Z',
    }),
    inB({
      id: LOG_B_OTHER_ACTION,
      actor_user_id: USER_SHARED,
      action: 'chapter_config_updated',
      target_type: 'chapter',
      target_id: null,
      scope: 'chapter',
      diff: {},
      member_visible: true,
      created_at: '2026-08-01T00:00:00.000Z',
    }),
    inB({
      id: LOG_B_EXEC_ONLY,
      actor_user_id: USER_SHARED,
      action: 'member_removed',
      target_type: 'member',
      target_id: 'member-3',
      scope: 'chapter',
      diff: {},
      member_visible: false,
      created_at: '2026-09-01T00:00:00.000Z',
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

    // Asserted in order, not sorted: the route contract says newest-first and
    // the harness's `order()` really sorts, so flipping the repository to
    // ascending has to fail here. Seeded 06-01 / 07-01 / 08-01 / 09-01. No
    // `memberVisibleOnly` means the President's view: the exec-only row is in.
    expect(rows.map((r) => r.id)).toEqual([
      LOG_B_EXEC_ONLY,
      LOG_B_OTHER_ACTION,
      LOG_B_OTHER_ACTOR,
      LOG_B,
    ]);
  });

  // #1773. This predicate is the whole of what keeps an exec-only row from a
  // non-president caller: the table has no SELECT policy, and this query runs
  // as service_role. Assert against seeded rows of BOTH visibilities, newest
  // first — remove `.eq('member_visible', true)` from the repository and
  // LOG_B_EXEC_ONLY comes back at the head of the list.
  it('findByChapter drops exec-only rows when memberVisibleOnly is set', async () => {
    const rows = await harness.expectTenantScoped(CHAPTER_B, () =>
      repo.findByChapter(CHAPTER_B, { memberVisibleOnly: true, limit: 50 }),
    );

    expect(rows.map((r) => r.id)).toEqual([
      LOG_B_OTHER_ACTION,
      LOG_B_OTHER_ACTOR,
      LOG_B,
    ]);
  });

  it('findByChapter applies the visibility predicate alongside a targeted filter', async () => {
    // The reach that made #1773 worth acting on: `?action=member_removed`
    // asks for exactly the rows a president just retracted.
    const rows = await harness.expectTenantScoped(CHAPTER_B, () =>
      repo.findByChapter(CHAPTER_B, {
        action: 'member_removed',
        memberVisibleOnly: true,
        limit: 50,
      }),
    );

    expect(rows.map((r) => r.id)).toEqual([LOG_B_OTHER_ACTOR, LOG_B]);
  });

  it('findByChapter filters by actor alongside the chapter predicate', async () => {
    const rows = await harness.expectTenantScoped(CHAPTER_B, () =>
      repo.findByChapter(CHAPTER_B, { actorUserId: USER_OTHER, limit: 50 }),
    );

    expect(rows.map((r) => r.id)).toEqual([LOG_B_OTHER_ACTOR]);
  });

  it('findByChapter filters by action', async () => {
    const rows = await harness.expectTenantScoped(CHAPTER_B, () =>
      repo.findByChapter(CHAPTER_B, {
        action: 'chapter_config_updated',
        limit: 50,
      }),
    );

    expect(rows.map((r) => r.id)).toEqual([LOG_B_OTHER_ACTION]);
  });

  // A degenerate window pinned to one seeded instant. Both bounds must be
  // inclusive for this to return anything, and BOTH must actually be applied:
  // dropping `.gte` admits the 06-01 row, dropping `.lte` admits the 08-01 row.
  // An earlier version of this test put both bounds past every row, so
  // deleting either predicate from the repository left it green.
  it('findByChapter applies both window bounds, inclusively', async () => {
    const rows = await harness.expectTenantScoped(CHAPTER_B, () =>
      repo.findByChapter(CHAPTER_B, {
        startDate: '2026-07-01T00:00:00.000Z',
        endDate: '2026-07-01T00:00:00.000Z',
        limit: 50,
      }),
    );

    expect(rows.map((r) => r.id)).toEqual([LOG_B_OTHER_ACTOR]);
  });

  it('findByChapter cuts rows outside the window at each edge', async () => {
    const rows = await harness.expectTenantScoped(CHAPTER_B, () =>
      repo.findByChapter(CHAPTER_B, {
        startDate: '2026-06-15T00:00:00.000Z',
        endDate: '2026-07-15T00:00:00.000Z',
        limit: 50,
      }),
    );

    // 06-01 is below the lower bound, 08-01 above the upper.
    expect(rows.map((r) => r.id)).toEqual([LOG_B_OTHER_ACTOR]);
  });

  it('findByChapter intersects every filter rather than replacing one with another', async () => {
    const rows = await harness.expectTenantScoped(CHAPTER_B, () =>
      repo.findByChapter(CHAPTER_B, {
        actorUserId: USER_SHARED,
        action: 'member_removed',
        startDate: '2026-05-15T00:00:00.000Z',
        endDate: '2026-07-15T00:00:00.000Z',
        before: '2026-06-15T00:00:00.000Z',
        limit: 50,
      }),
    );

    // Only LOG_B satisfies all five at once: LOG_B_OTHER_ACTOR fails the
    // actor, LOG_B_OTHER_ACTION fails the action, and LOG_A fails the chapter.
    expect(rows.map((r) => r.id)).toEqual([LOG_B]);
  });

  it('findByChapter applies the cursor and the window together, not one instead of the other', async () => {
    const rows = await harness.expectTenantScoped(CHAPTER_B, () =>
      repo.findByChapter(CHAPTER_B, {
        startDate: '2026-06-15T00:00:00.000Z',
        before: '2026-08-01T00:00:00.000Z',
        limit: 50,
      }),
    );

    // Each predicate removes a DIFFERENT row, which is what makes this a test
    // of composition rather than of whichever one happens to be narrower:
    // the lower bound cuts 06-01, the exclusive cursor cuts 08-01, and only
    // 07-01 survives both. Gating either on the absence of the other — the
    // exact bug this test is named for — returns two rows and fails.
    expect(rows.map((r) => r.id)).toEqual([LOG_B_OTHER_ACTOR]);
  });

  it('findByChapter applies the before cursor alongside the chapter predicate', async () => {
    const rows = await harness.expectTenantScoped(CHAPTER_B, () =>
      repo.findByChapter(CHAPTER_B, {
        before: '2026-07-01T00:00:00.000Z',
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
