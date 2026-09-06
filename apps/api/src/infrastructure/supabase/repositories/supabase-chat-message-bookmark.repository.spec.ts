import { SupabaseChatMessageBookmarkRepository } from './supabase-chat-message-bookmark.repository';
import {
  CHAPTER_A,
  CHAPTER_B,
  USER_SHARED,
  USER_A,
  createTenantHarness,
  inA,
  inB,
  type TenantHarness,
} from '#test/helpers/tenant-scope.harness';

/**
 * Tenant scope for `chat_message_bookmarks` (#462).
 *
 * This table carries its own `chapter_id`, so the ordinary predicate check
 * applies. What makes it worth more than the usual pass is that it has a
 * *second* scope the harness does not know about — `user_id` — and that one is
 * the spec's privacy guarantee: "no one else (not even channel admins) can see
 * who bookmarked what." A query that filtered chapter but not user would sail
 * through a tenant check and still hand one member another member's bookmarks,
 * so both predicates are asserted here, deliberately, on every read.
 *
 * The seed gives chapter A and chapter B a bookmark that agrees on everything
 * the two scopes are supposed to separate: same user, same `created_at`. Only
 * `chapter_id` and `message_id` differ. A second chapter-A bookmark belongs to
 * a *different* member so the user predicate has something real to exclude.
 */

const MESSAGE_A = '0a000000-0000-4000-8000-000000000160';
const MESSAGE_B = '0b000000-0000-4000-8000-000000000160';
const MESSAGE_A_DELETED = '0a000000-0000-4000-8000-000000000161';
const MESSAGE_B_DELETED = '0b000000-0000-4000-8000-000000000161';
const MESSAGE_A_OTHER_USER = '0a000000-0000-4000-8000-000000000162';
const MESSAGE_B_OTHER_USER = '0b000000-0000-4000-8000-000000000162';

const BOOKMARK_A = '0a000000-0000-4000-8000-000000000170';
const BOOKMARK_B = '0b000000-0000-4000-8000-000000000170';
const BOOKMARK_A_DELETED = '0a000000-0000-4000-8000-000000000171';
const BOOKMARK_B_DELETED = '0b000000-0000-4000-8000-000000000171';
const BOOKMARK_A_OTHER_USER = '0a000000-0000-4000-8000-000000000172';
const BOOKMARK_B_OTHER_USER = '0b000000-0000-4000-8000-000000000172';

/**
 * The harness ignores the `select()` projection and returns whatever the seed
 * row carries, so an embed is modelled by seeding the key the repository names
 * (`message:chat_messages(...)` → `message`).
 */
const message = (id: string, overrides: Record<string, unknown> = {}) => ({
  id,
  channel_id: '0a000000-0000-4000-8000-000000000180',
  content: 'the original message',
  is_deleted: false,
  created_at: '2026-01-01T00:00:00.000Z',
  ...overrides,
});

const seed = () => ({
  chat_message_bookmarks: [
    inA({
      id: BOOKMARK_A,
      user_id: USER_SHARED,
      message_id: MESSAGE_A,
      created_at: '2026-01-02T00:00:00.000Z',
      message: message(MESSAGE_A),
    }),
    inB({
      id: BOOKMARK_B,
      user_id: USER_SHARED,
      message_id: MESSAGE_B,
      created_at: '2026-01-02T00:00:00.000Z',
      message: message(MESSAGE_B),
    }),
    inA({
      id: BOOKMARK_A_DELETED,
      user_id: USER_SHARED,
      message_id: MESSAGE_A_DELETED,
      created_at: '2026-01-03T00:00:00.000Z',
      message: message(MESSAGE_A_DELETED, {
        content: '[message deleted]',
        is_deleted: true,
      }),
    }),
    inB({
      id: BOOKMARK_B_DELETED,
      user_id: USER_SHARED,
      message_id: MESSAGE_B_DELETED,
      created_at: '2026-01-03T00:00:00.000Z',
      message: message(MESSAGE_B_DELETED, {
        content: '[message deleted]',
        is_deleted: true,
      }),
    }),
    inA({
      id: BOOKMARK_A_OTHER_USER,
      user_id: USER_A,
      message_id: MESSAGE_A_OTHER_USER,
      created_at: '2026-01-02T00:00:00.000Z',
      message: message(MESSAGE_A_OTHER_USER),
    }),
    inB({
      id: BOOKMARK_B_OTHER_USER,
      user_id: USER_A,
      message_id: MESSAGE_B_OTHER_USER,
      created_at: '2026-01-02T00:00:00.000Z',
      message: message(MESSAGE_B_OTHER_USER),
    }),
  ],
});

describe('SupabaseChatMessageBookmarkRepository — tenant scope', () => {
  let harness: TenantHarness;
  let repo: SupabaseChatMessageBookmarkRepository;

  beforeEach(() => {
    harness = createTenantHarness({
      tables: seed(),
      collisionExempt: {
        // The A/B twins differ on these by construction — that is the point of
        // the seed. Everything else about them is identical.
        chat_message_bookmarks: ['user_id', 'message_id', 'message'],
      },
    });
    repo = new SupabaseChatMessageBookmarkRepository(harness.client);
  });

  it('findByUserAndChapter does not return the same user bookmark from another chapter', async () => {
    const rows = await harness.expectTenantScoped(CHAPTER_A, () =>
      repo.findByUserAndChapter(USER_SHARED, CHAPTER_A),
    );

    expect(rows.map((r) => r.id)).not.toContain(BOOKMARK_B);
  });

  it('findByUserAndChapter excludes another member bookmark in the same chapter', async () => {
    // The privacy guarantee, as a test rather than a comment: chapter scope
    // alone would return this row. Only the `user_id` predicate excludes it,
    // and nothing else in the stack would notice if it were dropped.
    const rows = await repo.findByUserAndChapter(USER_SHARED, CHAPTER_A);

    expect(rows.map((r) => r.id)).not.toContain(BOOKMARK_A_OTHER_USER);
  });

  it('findByUserAndChapter returns newest first', async () => {
    const rows = await repo.findByUserAndChapter(USER_SHARED, CHAPTER_A);

    expect(rows.map((r) => r.id)).toEqual([BOOKMARK_A_DELETED, BOOKMARK_A]);
  });

  /**
   * The acceptance criterion this repository is most likely to lose to a
   * well-meaning tidy-up.
   *
   * `spec/behavior/chat/README.md`: "If the original message is deleted, the
   * bookmark surfaces a '[message deleted]' placeholder." Adding the
   * `.eq('is_deleted', false)` that looks like an obvious omission would make
   * the bookmark vanish instead — the exact opposite of the requirement — and
   * every other test here would stay green.
   */
  it('keeps a bookmark whose message was deleted, carrying the placeholder', async () => {
    const rows = await repo.findByUserAndChapter(USER_SHARED, CHAPTER_A);

    const deleted = rows.find((r) => r.id === BOOKMARK_A_DELETED);
    expect(deleted).toBeDefined();
    expect(deleted?.message.is_deleted).toBe(true);
    expect(deleted?.message.content).toBe('[message deleted]');
  });

  it('delete removes only the caller own bookmark, not another member on the same message', async () => {
    await repo.delete(USER_SHARED, MESSAGE_A_OTHER_USER, CHAPTER_A);

    expect(harness.rows('chat_message_bookmarks').map((r) => r.id)).toContain(
      BOOKMARK_A_OTHER_USER,
    );
  });

  it('delete leaves the other chapter bookmark in place', async () => {
    await repo.delete(USER_SHARED, MESSAGE_A, CHAPTER_A);

    const remaining = harness
      .rows('chat_message_bookmarks')
      .map((r) => r.id as string);
    expect(remaining).not.toContain(BOOKMARK_A);
    expect(remaining).toContain(BOOKMARK_B);
    expect(remaining).toHaveLength(5);
  });

  it('never returns user_id to the caller', async () => {
    // A disclosure boundary, not tidiness: NestJS does not serialize to the
    // declared @ApiOkResponse DTO (no ClassSerializerInterceptor is registered
    // anywhere in this app), so the DTO is documentation and this strip is the
    // only thing keeping `user_id` off the wire. `/diff-review` caught the
    // spec claiming otherwise while the field shipped.
    const rows = await repo.findByUserAndChapter(USER_SHARED, CHAPTER_A);

    expect(rows.length).toBeGreaterThan(0);
    for (const row of rows) {
      expect(row).not.toHaveProperty('user_id');
    }
  });

  it('delete will not reach a bookmark in another chapter', async () => {
    // The predicate looks redundant against the (user_id, message_id) unique
    // constraint. It is the guard for a future caller that does not authorize
    // the message first — which, since the lost-access fix, is the bookmark
    // path itself.
    await repo.delete(USER_SHARED, MESSAGE_B, CHAPTER_A);

    expect(harness.rows('chat_message_bookmarks').map((r) => r.id)).toContain(
      BOOKMARK_B,
    );
  });

  it('create is idempotent and does not duplicate an existing bookmark', async () => {
    // `upsert` on the (user_id, message_id) conflict target rather than an
    // insert that raises 23505: a double-tap or an offline retry has to be a
    // no-op, not an error the client special-cases.
    await repo.create(USER_SHARED, MESSAGE_A, CHAPTER_A);

    expect(
      harness
        .rows('chat_message_bookmarks')
        .filter((r) => r.user_id === USER_SHARED && r.message_id === MESSAGE_A),
    ).toHaveLength(1);
  });

  it('create does not return user_id either', async () => {
    // `BookmarkRefDto` declares the field absent on the POST response too, and
    // nothing serializes to a DTO in this app — so the strip has to be on every
    // exit, not only the list read.
    const created = await repo.create(
      USER_A,
      '0a000000-0000-4000-8000-000000000191',
      CHAPTER_A,
    );

    expect(created).not.toHaveProperty('user_id');
  });

  it('create stamps the chapter it is given', async () => {
    const created = await repo.create(
      USER_A,
      '0a000000-0000-4000-8000-000000000190',
      CHAPTER_A,
    );

    expect(created.chapter_id).toBe(CHAPTER_A);
  });

  it('create never writes into another chapter', async () => {
    await harness.expectTenantScoped(CHAPTER_B, () =>
      repo.create(USER_A, '0b000000-0000-4000-8000-000000000190', CHAPTER_B),
    );
  });
});
