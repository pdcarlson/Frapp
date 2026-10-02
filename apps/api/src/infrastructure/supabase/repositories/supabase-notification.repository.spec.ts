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

/**
 * `withholdChatFrom` (#2715): the caller's blocked members' chat rows, and every
 * chat row with no recorded sender, are left out by the query itself. Each row
 * has a twin in the other chapter, so the tenant filter is still what narrows
 * the result to one chapter.
 */
describe('SupabaseNotificationRepository — withholding blocked senders', () => {
  const BLOCKED = '0c000000-0000-4000-8000-000000000001';
  const OTHER = '0c000000-0000-4000-8000-000000000002';
  const chatTarget = { screen: 'chat', channelId: 'channel-1' };

  const rowsFor = (
    tag: 'a' | 'b',
    inChapter: (row: Record<string, unknown>) => Record<string, unknown>,
  ) => [
    // `created_at` descending is the order the list serves.
    inChapter({
      id: `${tag}-from-blocked`,
      user_id: USER_SHARED,
      title: 'Blocked Member',
      body: 'something unkind',
      data: { target: chatTarget, senderId: BLOCKED },
      read_at: null,
      created_at: '2026-01-06T00:00:00.000Z',
    }),
    inChapter({
      id: `${tag}-bundle-from-blocked`,
      user_id: USER_SHARED,
      title: 'Blocked Member',
      body: '3 new messages',
      data: { target: chatTarget, senderId: BLOCKED, bundled: true, count: 3 },
      read_at: null,
      created_at: '2026-01-05T00:00:00.000Z',
    }),
    inChapter({
      id: `${tag}-from-other`,
      user_id: USER_SHARED,
      title: 'Other Member',
      body: 'see you there',
      data: { target: chatTarget, senderId: OTHER },
      read_at: null,
      created_at: '2026-01-04T00:00:00.000Z',
    }),
    inChapter({
      id: `${tag}-legacy-chat`,
      user_id: USER_SHARED,
      title: 'New Message',
      body: 'written before rows named a sender',
      data: { target: chatTarget },
      read_at: null,
      created_at: '2026-01-03T00:00:00.000Z',
    }),
    inChapter({
      id: `${tag}-task`,
      user_id: USER_SHARED,
      title: 'New task',
      body: 'Set up for rush',
      data: { target: { screen: 'tasks', taskId: 'task-1' } },
      read_at: null,
      created_at: '2026-01-02T00:00:00.000Z',
    }),
    inChapter({
      id: `${tag}-untargeted`,
      user_id: USER_SHARED,
      title: 'Dues reminder',
      body: 'Fall dues are due',
      data: {},
      read_at: null,
      created_at: '2026-01-01T00:00:00.000Z',
    }),
  ];

  let harness: TenantHarness;
  let repo: SupabaseNotificationRepository;

  beforeEach(() => {
    harness = createTenantHarness({
      tables: { notifications: [...rowsFor('a', inA), ...rowsFor('b', inB)] },
    });
    repo = new SupabaseNotificationRepository(harness.client);
  });

  it('leaves out the blocked member chat rows and the senderless chat rows, and keeps the rest', async () => {
    const rows = await harness.expectTenantScoped(CHAPTER_B, () =>
      repo.findByUser(USER_SHARED, CHAPTER_B, { withholdChatFrom: [BLOCKED] }),
    );

    expect(rows.map((n) => n.id)).toEqual([
      'b-from-other',
      'b-task',
      'b-untargeted',
    ]);
  });

  it('counts the limit over the rows it serves, not the rows it withholds', async () => {
    const rows = await harness.expectTenantScoped(CHAPTER_B, () =>
      repo.findByUser(USER_SHARED, CHAPTER_B, {
        limit: 2,
        withholdChatFrom: [BLOCKED],
      }),
    );

    expect(rows.map((n) => n.id)).toEqual(['b-from-other', 'b-task']);
  });

  it('withholds every chat row once the block list is too long for one URL', async () => {
    // Past `IN_FILTER_CHAR_BUDGET` the list would make the request line too
    // long and fail the whole read, so the query withholds every chat row
    // rather than none.
    const many = Array.from(
      { length: 120 },
      (_, i) => `0e000000-0000-4000-8000-${String(i).padStart(12, '0')}`,
    );
    const rows = await harness.expectTenantScoped(CHAPTER_B, () =>
      repo.findByUser(USER_SHARED, CHAPTER_B, { withholdChatFrom: many }),
    );

    expect(rows.map((n) => n.id)).toEqual(['b-task', 'b-untargeted']);
  });

  it('withholds nothing when the caller has blocked nobody', async () => {
    const rows = await harness.expectTenantScoped(CHAPTER_B, () =>
      repo.findByUser(USER_SHARED, CHAPTER_B, { withholdChatFrom: [] }),
    );

    expect(rows).toHaveLength(6);
  });
});
