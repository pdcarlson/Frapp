import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  ACTIVITY_ITEM_READS_CONFLICT,
  ACTIVITY_ITEM_SNOOZES_CONFLICT,
  ACTIVITY_UNREAD_STARTS_CONFLICT,
  SupabaseActivityItemReadRepository,
} from './supabase-activity-item-read.repository';
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
 * Tenant scope for `activity_item_reads` and `activity_unread_starts`
 * (#4173), which carry their own `chapter_id`.
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

const STARTED = '2026-11-12T08:00:00.000Z';
const UNTIL = '2026-11-15T09:00:00.000Z';

const snooze = (overrides: Record<string, unknown> = {}) => ({
  user_id: USER_SHARED,
  kind: 'task',
  item_id: ITEM,
  until: UNTIL,
  created_at: READ_AT,
  ...overrides,
});

const seed = () => ({
  activity_item_reads: [
    inA({ id: 'read-a', ...read() }),
    inB({ id: 'read-b', ...read() }),
    inA({ id: 'read-a-other', ...read({ user_id: USER_A }) }),
    inB({ id: 'read-b-other', ...read({ user_id: USER_A }) }),
  ],
  activity_unread_starts: [
    inA({ id: 'start-a', user_id: USER_SHARED, started_at: STARTED }),
    inB({ id: 'start-b', user_id: USER_SHARED, started_at: STARTED }),
  ],
  activity_item_snoozes: [
    inA({ id: 'snooze-a', ...snooze() }),
    inB({ id: 'snooze-b', ...snooze() }),
    inA({ id: 'snooze-a-other', ...snooze({ user_id: USER_A }) }),
    inB({ id: 'snooze-b-other', ...snooze({ user_id: USER_A }) }),
    inA({
      id: 'snooze-a-old',
      ...snooze({ item_id: OTHER_ITEM, until: '2026-10-01T09:00:00.000Z' }),
    }),
    inB({
      id: 'snooze-b-old',
      ...snooze({ item_id: OTHER_ITEM, until: '2026-10-01T09:00:00.000Z' }),
    }),
  ],
});

/** The primary key columns of `table` as the migration declares them. */
function primaryKeyOf(
  table: string,
  migration = '20261111220000_activity_item_reads.sql',
): string {
  const sql = readFileSync(
    join(__dirname, '../../../../../../supabase/migrations', migration),
    'utf8',
  );
  const body = new RegExp(
    `create table if not exists public\\.${table} \\(([\\s\\S]*?)\\n\\);`,
  ).exec(sql)?.[1];
  const key = body && /primary key \(([^)]+)\)/.exec(body)?.[1];
  if (!key) throw new Error(`no primary key found for ${table}`);
  return key.replace(/\s+/g, '');
}

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

  describe('upsert targets', () => {
    // The harness matches any column list, so only this ties a target to a
    // constraint Postgres would accept; a mismatch is a 42P10 on every write.
    it('name each table’s primary key', () => {
      expect(ACTIVITY_ITEM_READS_CONFLICT).toBe(
        primaryKeyOf('activity_item_reads'),
      );
      expect(ACTIVITY_UNREAD_STARTS_CONFLICT).toBe(
        primaryKeyOf('activity_unread_starts'),
      );
      expect(ACTIVITY_ITEM_SNOOZES_CONFLICT).toBe(
        primaryKeyOf(
          'activity_item_snoozes',
          '20261114040716_activity_item_snoozes.sql',
        ),
      );
    });
  });

  describe('findSnoozes', () => {
    it('reads only the member’s own snoozes in the chapter that end after the cut', async () => {
      const rows = await harness.expectTenantScoped(CHAPTER_A, () =>
        repo.findSnoozes(CHAPTER_A, USER_SHARED, '2026-11-01T00:00:00.000Z'),
      );

      expect(rows).toEqual([
        expect.objectContaining({
          chapter_id: CHAPTER_A,
          user_id: USER_SHARED,
          kind: 'task',
          item_id: ITEM,
          until: UNTIL,
        }),
      ]);
    });
  });

  describe('snooze', () => {
    it('replaces the member’s snooze of the item, and not the other chapter’s twin', async () => {
      await harness.expectTenantScoped(CHAPTER_A, () =>
        repo.snooze(
          CHAPTER_A,
          USER_SHARED,
          { kind: 'task', item_id: ITEM },
          '2026-11-20T09:00:00.000Z',
        ),
      );

      const mine = harness
        .rows('activity_item_snoozes')
        .filter((row) => row.user_id === USER_SHARED && row.item_id === ITEM);
      expect(mine).toHaveLength(2);
      expect(mine.find((row) => row.chapter_id === CHAPTER_A)?.until).toBe(
        '2026-11-20T09:00:00.000Z',
      );
      expect(mine.find((row) => row.chapter_id === CHAPTER_B)?.until).toBe(
        UNTIL,
      );
    });
  });

  describe('unsnooze', () => {
    it('drops only the member’s snooze of the item in the chapter', async () => {
      await harness.expectTenantScoped(CHAPTER_A, () =>
        repo.unsnooze(CHAPTER_A, USER_SHARED, { kind: 'task', item_id: ITEM }),
      );

      expect(
        harness
          .rows('activity_item_snoozes')
          .map((row) => row.id)
          .sort(),
      ).toEqual([
        'snooze-a-old',
        'snooze-a-other',
        'snooze-b',
        'snooze-b-old',
        'snooze-b-other',
      ]);
    });
  });

  describe('findUnreadStart', () => {
    it('reads only the member’s own start in the chapter', async () => {
      await expect(
        harness.expectTenantScoped(CHAPTER_A, () =>
          repo.findUnreadStart(CHAPTER_A, USER_SHARED),
        ),
      ).resolves.toBe(STARTED);
      await expect(repo.findUnreadStart(CHAPTER_A, USER_A)).resolves.toBeNull();
    });
  });

  describe('startUnread', () => {
    it('begins a member’s dots inside the chapter', async () => {
      await harness.expectTenantScoped(CHAPTER_A, () =>
        repo.startUnread(CHAPTER_A, USER_A, '2026-11-13T09:00:00.000Z'),
      );

      expect(
        harness
          .rows('activity_unread_starts')
          .filter((row) => row.user_id === USER_A),
      ).toEqual([
        expect.objectContaining({
          chapter_id: CHAPTER_A,
          started_at: '2026-11-13T09:00:00.000Z',
        }),
      ]);
    });

    it('never moves a start that already began, or the other chapter’s', async () => {
      await harness.expectTenantScoped(CHAPTER_A, () =>
        repo.startUnread(CHAPTER_A, USER_SHARED, '2026-11-13T09:00:00.000Z'),
      );

      const starts = harness
        .rows('activity_unread_starts')
        .filter((row) => row.user_id === USER_SHARED);
      expect(starts).toHaveLength(2);
      expect(starts.map((row) => row.started_at)).toEqual([STARTED, STARTED]);
    });
  });

  describe('markRead', () => {
    it('moves the time of an item opened again, and not the other chapter’s twin', async () => {
      await harness.expectTenantScoped(CHAPTER_A, () =>
        repo.markRead(
          CHAPTER_A,
          USER_SHARED,
          [{ kind: 'poll', item_id: ITEM }],
          '2026-11-13T09:00:00.000Z',
        ),
      );

      const mine = harness
        .rows('activity_item_reads')
        .filter((row) => row.user_id === USER_SHARED && row.item_id === ITEM);
      expect(mine).toHaveLength(2);
      expect(mine.find((row) => row.chapter_id === CHAPTER_A)?.read_at).toBe(
        '2026-11-13T09:00:00.000Z',
      );
      expect(mine.find((row) => row.chapter_id === CHAPTER_B)?.read_at).toBe(
        READ_AT,
      );
    });

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
