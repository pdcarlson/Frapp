import { SupabaseNotificationRepository } from './supabase-notification.repository';
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
 * Tenant scope for `notifications`.
 *
 * The table has always carried `chapter_id` (NOT NULL). Until #1518 the list
 * and mark-read paths filtered by `user_id` (and id) only, so a member of two
 * chapters saw the other chapter's in-app history while one was active. The
 * twins share `user_id` so that predicate matches both; only `.eq('chapter_id',
 * …)` can narrow the result. `markRead` binds the chapter on the UPDATE itself
 * (TOCTOU), not a read-then-check.
 */

const NOTIF_A = '0a000000-0000-4000-8000-000000000140';
const NOTIF_B = '0b000000-0000-4000-8000-000000000140';

const seed = () => ({
  notifications: [
    inA({
      id: NOTIF_A,
      user_id: USER_SHARED,
      title: 'Dues reminder',
      body: 'Fall dues are due',
      data: {},
      read_at: null,
      created_at: '2026-01-01T00:00:00.000Z',
    }),
    inB({
      id: NOTIF_B,
      user_id: USER_SHARED,
      title: 'Dues reminder',
      body: 'Fall dues are due',
      data: {},
      read_at: null,
      created_at: '2026-01-01T00:00:00.000Z',
    }),
  ],
});

describe('SupabaseNotificationRepository — tenant scope', () => {
  let harness: TenantHarness;
  let repo: SupabaseNotificationRepository;

  beforeEach(() => {
    harness = createTenantHarness({ tables: seed() });
    repo = new SupabaseNotificationRepository(harness.client);
  });

  it('findByUser returns only the caller chapter rows for a dual-chapter member', async () => {
    const rows = await harness.expectTenantScoped(CHAPTER_B, () =>
      repo.findByUser(USER_SHARED, CHAPTER_B),
    );

    expect(rows.map((n) => n.id)).toEqual([NOTIF_B]);
  });

  it('findById refuses an id belonging to another chapter', async () => {
    const foreign = await harness.expectTenantScoped(CHAPTER_B, () =>
      repo.findById(NOTIF_A, CHAPTER_B),
    );

    expect(foreign).toBeNull();
  });

  it('markRead writes into the caller chapter and leaves the twin unread', async () => {
    const updated = await harness.expectTenantScoped(CHAPTER_B, () =>
      repo.markRead(NOTIF_B, USER_SHARED, CHAPTER_B),
    );

    expect(updated.id).toBe(NOTIF_B);
    expect(updated.read_at).toEqual(expect.any(String));

    const rows = harness.rows('notifications');
    expect(rows.find((n) => n.id === NOTIF_B)?.read_at).toEqual(
      expect.any(String),
    );
    expect(rows.find((n) => n.id === NOTIF_A)?.read_at).toBeNull();
  });

  it('create issues the row under the caller chapter', async () => {
    const created = await harness.expectTenantScoped(CHAPTER_B, () =>
      repo.create({
        chapter_id: CHAPTER_B,
        user_id: USER_SHARED,
        title: 'New message',
        body: 'Hello',
        data: {},
      }),
    );

    expect(created.chapter_id).toBe(CHAPTER_B);
    expect(
      harness.rows('notifications').filter((n) => n.chapter_id === CHAPTER_A),
    ).toHaveLength(1);
  });

  it('createMany issues every row under the caller chapter', async () => {
    const created = await harness.expectTenantScoped(CHAPTER_B, () =>
      repo.createMany([
        {
          chapter_id: CHAPTER_B,
          user_id: USER_SHARED,
          title: 'Batch one',
          body: 'Hello',
          data: {},
        },
        {
          chapter_id: CHAPTER_B,
          user_id: USER_SHARED,
          title: 'Batch two',
          body: 'Hello',
          data: {},
        },
      ]),
    );

    expect(created.every((n) => n.chapter_id === CHAPTER_B)).toBe(true);
    expect(
      harness.rows('notifications').filter((n) => n.chapter_id === CHAPTER_A),
    ).toHaveLength(1);
  });

  it('createMany issues no query for an empty list', async () => {
    const before = harness.ops.length;
    const rows = await repo.createMany([]);
    expect(rows).toEqual([]);
    expect(harness.ops.length).toBe(before);
  });
});
