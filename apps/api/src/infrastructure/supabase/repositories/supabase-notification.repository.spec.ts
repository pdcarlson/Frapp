import { SupabaseNotificationRepository } from './supabase-notification.repository';
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

  it("markChatChannelRead clears only the channel's chat rows read through the instant, in the caller chapter", async () => {
    const CHANNEL = 'c0000000-0000-4000-8000-000000003788';
    const OTHER_CHANNEL = 'c1000000-0000-4000-8000-000000003788';
    const chat = (channelId: string) => ({
      target: { screen: 'chat', channelId },
    });
    // Each row has a twin in the other chapter, as the harness requires; only
    // the caller chapter's rows may change.
    const rows = [
      // In the channel, before the read: cleared.
      {
        id: 'before',
        data: chat(CHANNEL),
        read_at: null,
        created_at: '2026-01-01T00:00:00.000Z',
      },
      // In the channel, after the read: a message not yet seen.
      {
        id: 'after',
        data: chat(CHANNEL),
        read_at: null,
        created_at: '2026-01-01T00:05:00.000Z',
      },
      // Already read: keeps its own timestamp.
      {
        id: 'read',
        data: chat(CHANNEL),
        read_at: '2025-12-31T00:00:00.000Z',
        created_at: '2025-12-30T00:00:00.000Z',
      },
      // Another channel, and a non-chat row: untouched.
      {
        id: 'other-channel',
        data: chat(OTHER_CHANNEL),
        read_at: null,
        created_at: '2026-01-01T00:00:00.000Z',
      },
      {
        id: 'event',
        data: { target: { screen: 'events' } },
        read_at: null,
        created_at: '2026-01-01T00:00:00.000Z',
      },
      // Not a chat row, though it names the channel: only chat rows clear.
      {
        id: 'report',
        data: { target: { screen: 'chat_reports', channelId: CHANNEL } },
        read_at: null,
        created_at: '2026-01-01T00:00:00.000Z',
      },
    ];
    const row = (r: (typeof rows)[number], prefix: string) => ({
      ...r,
      id: `${prefix}-${r.id}`,
      user_id: USER_SHARED,
      title: 'Alex',
      body: 'hi',
    });
    harness = createTenantHarness({
      tables: {
        notifications: [
          ...rows.map((r) => inA(row(r, 'a'))),
          ...rows.map((r) => inB(row(r, 'b'))),
        ],
      },
    });
    repo = new SupabaseNotificationRepository(harness.client);

    await harness.expectTenantScoped(CHAPTER_B, () =>
      repo.markChatChannelRead(
        USER_SHARED,
        CHAPTER_B,
        CHANNEL,
        '2026-01-01T00:01:00.000Z',
      ),
    );

    const readAt = Object.fromEntries(
      harness.rows('notifications').map((n) => [n.id, n.read_at]),
    );
    expect(readAt).toEqual({
      'b-before': '2026-01-01T00:01:00.000Z',
      'b-after': null,
      'b-read': '2025-12-31T00:00:00.000Z',
      'b-other-channel': null,
      'b-event': null,
      'b-report': null,
      'a-before': null,
      'a-after': null,
      'a-read': '2025-12-31T00:00:00.000Z',
      'a-other-channel': null,
      'a-event': null,
      'a-report': null,
    });
  });

  describe('markAllRead (#3929)', () => {
    const rows = [
      {
        id: 'chat',
        data: { target: { screen: 'chat', channelId: 'c-1' } },
        read_at: null,
        created_at: '2026-01-01T00:00:00.000Z',
      },
      {
        id: 'event',
        data: { target: { screen: 'events', eventId: 'e-1' } },
        read_at: null,
        created_at: '2026-01-01T00:00:00.000Z',
      },
      {
        id: 'task',
        data: { target: { screen: 'tasks', taskId: 't-1' } },
        read_at: null,
        created_at: '2026-01-01T00:00:00.000Z',
      },
      // Landed after the request began: not seen yet.
      {
        id: 'late',
        data: { target: { screen: 'events', eventId: 'e-2' } },
        read_at: null,
        created_at: '2026-01-01T00:05:00.000Z',
      },
      // Already read: keeps its own timestamp.
      {
        id: 'read',
        data: { target: { screen: 'events', eventId: 'e-3' } },
        read_at: '2025-12-31T00:00:00.000Z',
        created_at: '2025-12-30T00:00:00.000Z',
      },
    ];
    const READ_THROUGH = '2026-01-01T00:01:00.000Z';

    beforeEach(() => {
      const row = (r: (typeof rows)[number], prefix: string) => ({
        ...r,
        id: `${prefix}-${r.id}`,
        user_id: USER_SHARED,
        title: 'Alex',
        body: 'hi',
      });
      harness = createTenantHarness({
        tables: {
          notifications: [
            ...rows.map((r) => inA(row(r, 'a'))),
            ...rows.map((r) => inB(row(r, 'b'))),
          ],
        },
      });
      repo = new SupabaseNotificationRepository(harness.client);
    });

    const readAtById = () =>
      Object.fromEntries(
        harness.rows('notifications').map((n) => [n.id, n.read_at]),
      );
    const chapterAUntouched = {
      'a-chat': null,
      'a-event': null,
      'a-task': null,
      'a-late': null,
      'a-read': '2025-12-31T00:00:00.000Z',
    };

    it('marks every unread row read through the instant, in the caller chapter only', async () => {
      const updated = await harness.expectTenantScoped(CHAPTER_B, () =>
        repo.markAllRead(USER_SHARED, CHAPTER_B, READ_THROUGH),
      );

      expect(updated).toBe(3);
      expect(readAtById()).toEqual({
        ...chapterAUntouched,
        'b-chat': READ_THROUGH,
        'b-event': READ_THROUGH,
        'b-task': READ_THROUGH,
        'b-late': null,
        'b-read': '2025-12-31T00:00:00.000Z',
      });
    });

    it('marks only the named rows, in the caller chapter only (#3948)', async () => {
      const updated = await harness.expectTenantScoped(CHAPTER_B, () =>
        repo.markAllRead(USER_SHARED, CHAPTER_B, READ_THROUGH, undefined, [
          'b-chat',
          'b-task',
          'a-event',
        ]),
      );

      expect(updated).toBe(2);
      expect(readAtById()).toEqual({
        ...chapterAUntouched,
        'b-chat': READ_THROUGH,
        'b-event': null,
        'b-task': READ_THROUGH,
        'b-late': null,
        'b-read': '2025-12-31T00:00:00.000Z',
      });
    });

    it('marks only the rows that point at the named screens', async () => {
      const updated = await harness.expectTenantScoped(CHAPTER_B, () =>
        repo.markAllRead(USER_SHARED, CHAPTER_B, READ_THROUGH, [
          'events',
          'points',
        ]),
      );

      expect(updated).toBe(1);
      expect(readAtById()).toEqual({
        ...chapterAUntouched,
        'b-chat': null,
        'b-event': READ_THROUGH,
        'b-task': null,
        'b-late': null,
        'b-read': '2025-12-31T00:00:00.000Z',
      });
    });
  });

  describe('rewriteChatMessageBody (#4418)', () => {
    beforeEach(() => {
      const chatRow = (
        id: string,
        chatMessageId: string | null,
        userId = USER_SHARED,
      ) => ({
        id,
        user_id: userId,
        title: 'Alex in #general',
        body: 'old words',
        data: { target: { screen: 'chat', channelId: 'c-1' } },
        chat_message_id: chatMessageId,
        read_at: null,
        created_at: '2026-01-01T00:00:00.000Z',
      });
      harness = createTenantHarness({
        tables: {
          notifications: [
            inA(chatRow('a-m1', 'm-1')),
            inA(chatRow('a-m2', 'm-2')),
            inA(chatRow('a-bundle', null)),
            inA(chatRow('a-gone', 'm-1', USER_A)),
            inB(chatRow('b-m1', 'm-1')),
            inB(chatRow('b-m2', 'm-2')),
            inB(chatRow('b-bundle', null)),
            // Lost access to the channel since: an edit must not reach them.
            inB(chatRow('b-gone', 'm-1', USER_A)),
          ],
        },
      });
      repo = new SupabaseNotificationRepository(harness.client);
    });

    it("rewrites only the caller chapter's rows that quote the message, for the readers named", async () => {
      await harness.expectTenantScoped(CHAPTER_B, () =>
        repo.rewriteChatMessageBody(CHAPTER_B, 'm-1', 'new words', [
          USER_SHARED,
        ]),
      );

      expect(
        Object.fromEntries(
          harness.rows('notifications').map((n) => [n.id, n.body]),
        ),
      ).toEqual({
        'a-m1': 'old words',
        'a-m2': 'old words',
        'a-bundle': 'old words',
        'a-gone': 'old words',
        'b-m1': 'new words',
        'b-m2': 'old words',
        'b-bundle': 'old words',
        'b-gone': 'old words',
      });
    });
  });

  it('create stores the chat message a row quotes (#4418)', async () => {
    const created = await harness.expectTenantScoped(CHAPTER_B, () =>
      repo.create({
        chapter_id: CHAPTER_B,
        user_id: USER_SHARED,
        title: 'Alex in #general',
        body: 'Hello',
        data: {},
        chat_message_id: 'm-1',
      }),
    );

    expect(created?.chat_message_id).toBe('m-1');
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

    expect(created?.chapter_id).toBe(CHAPTER_B);
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
