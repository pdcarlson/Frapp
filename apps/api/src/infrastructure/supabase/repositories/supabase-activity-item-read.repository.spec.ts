import { SupabaseActivityItemReadRepository } from './supabase-activity-item-read.repository';
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
 * Tenant scope for `activity_item_reads` (#4173), which carries its own
 * `chapter_id`.
 *
 * The A/B twins agree on everything but their chapter: same member, same
 * kind, same item, same time. So a read or write that drops the chapter
 * predicate reaches the other chapter's twin, and only that predicate tells
 * them apart. The table has a second scope the harness doesn't know,
 * `user_id`; a chapter-A read of another member is seeded so it has
 * something real to exclude.
 */

const ITEM = '0c000000-0000-4000-8000-000000004173';
const OTHER_ITEM = '0c000000-0000-4000-8000-000000004174';
const READ_AT = '2026-11-12T10:00:00.000Z';

const read = (overrides: Record<string, unknown> = {}) => ({
  user_id: USER_SHARED,
  kind: 'poll',
  item_id: ITEM,
  read_at: READ_AT,
  ...overrides,
});

const seed = () => ({
  activity_item_reads: [
    inA({ id: 'read-a', ...read() }),
    inB({ id: 'read-b', ...read() }),
    inA({ id: 'read-a-other', ...read({ user_id: USER_A }) }),
    inB({ id: 'read-b-other', ...read({ user_id: USER_A }) }),
  ],
});

describe('SupabaseActivityItemReadRepository — tenant scope', () => {
  let harness: TenantHarness;
  let repo: SupabaseActivityItemReadRepository;

  beforeEach(() => {
    harness = createTenantHarness({ tables: seed() });
    repo = new SupabaseActivityItemReadRepository(harness.client);
  });

  describe('findReads', () => {
    it('reads only the member’s own reads in the chapter', async () => {
      const rows = await harness.expectTenantScoped(CHAPTER_A, () =>
        repo.findReads(CHAPTER_A, USER_SHARED, [ITEM, OTHER_ITEM]),
      );

      expect(rows).toEqual([
        expect.objectContaining({
          chapter_id: CHAPTER_A,
          user_id: USER_SHARED,
          kind: 'poll',
          item_id: ITEM,
        }),
      ]);
    });

    it('batches a long id list', async () => {
      const many = Array.from(
        { length: 150 },
        (_, i) => `0c000000-0000-4000-8000-${String(i).padStart(12, '0')}`,
      );
      await harness.expectTenantScoped(CHAPTER_A, () =>
        repo.findReads(CHAPTER_A, USER_SHARED, [...many, ITEM]),
      );

      expect(
        harness.ops.filter((op) => op.table === 'activity_item_reads'),
      ).toHaveLength(2);
    });

    it('reads nothing for no ids', async () => {
      await expect(repo.findReads(CHAPTER_A, USER_SHARED, [])).resolves.toEqual(
        [],
      );
      expect(harness.ops).toHaveLength(0);
    });
  });

  describe('markRead', () => {
    it('writes inside the chapter, for the member', async () => {
      await harness.expectTenantScoped(CHAPTER_B, () =>
        repo.markRead(
          CHAPTER_B,
          USER_SHARED,
          [{ kind: 'task', item_id: OTHER_ITEM }],
          '2026-11-13T09:00:00.000Z',
        ),
      );

      const written = harness
        .rows('activity_item_reads')
        .filter((row) => row.item_id === OTHER_ITEM);
      expect(written).toEqual([
        expect.objectContaining({
          chapter_id: CHAPTER_B,
          user_id: USER_SHARED,
          kind: 'task',
          read_at: '2026-11-13T09:00:00.000Z',
        }),
      ]);
    });

    it('writes nothing for no items', async () => {
      await repo.markRead(CHAPTER_A, USER_SHARED, [], READ_AT);
      expect(harness.ops).toHaveLength(0);
    });
  });
});
