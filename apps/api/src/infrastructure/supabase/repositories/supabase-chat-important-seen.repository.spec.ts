import { SupabaseChatImportantSeenRepository } from './supabase-chat-important-seen.repository';
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
 * Tenant scope for `chat_message_important_seen` (#4186).
 *
 * The table has two scopes: `chapter_id`, which the harness checks, and
 * `user_id`, which it does not know about. What one member has seen is theirs
 * alone, so a read that filtered the chapter but not the member would hand the
 * strip someone else's state. Both are asserted.
 *
 * The A/B twins agree on the member and `seen_at`; only `chapter_id` and
 * `message_id` differ. A second chapter-A row belongs to another member, on
 * the same message, so the member predicate has something real to exclude.
 */

const MESSAGE_A = '0a000000-0000-4000-8000-000000000190';
const MESSAGE_B = '0b000000-0000-4000-8000-000000000190';
const MESSAGE_A_UNSEEN = '0a000000-0000-4000-8000-000000000191';
const MESSAGE_A_OTHERS = '0a000000-0000-4000-8000-000000000192';
const MESSAGE_B_OTHERS = '0b000000-0000-4000-8000-000000000192';

/**
 * The table's key is `(user_id, message_id)`; the harness tracks rows by an
 * `id`, so the seed gives each one a synthetic id the repository never reads.
 */
const seed = () => ({
  chat_message_important_seen: [
    inA({
      id: 'seen-1',
      user_id: USER_SHARED,
      message_id: MESSAGE_A,
      seen_at: '2026-11-11T10:00:00.000Z',
    }),
    inB({
      id: 'seen-2',
      user_id: USER_SHARED,
      message_id: MESSAGE_B,
      seen_at: '2026-11-11T10:00:00.000Z',
    }),
    inA({
      id: 'seen-3',
      user_id: USER_A,
      message_id: MESSAGE_A_OTHERS,
      seen_at: '2026-11-11T10:00:00.000Z',
    }),
    inB({
      id: 'seen-4',
      user_id: USER_A,
      message_id: MESSAGE_B_OTHERS,
      seen_at: '2026-11-11T10:00:00.000Z',
    }),
  ],
});

describe('SupabaseChatImportantSeenRepository — tenant scope', () => {
  let harness: TenantHarness;
  let repo: SupabaseChatImportantSeenRepository;

  beforeEach(() => {
    harness = createTenantHarness({
      tables: seed(),
      collisionExempt: { chat_message_important_seen: ['message_id'] },
    });
    repo = new SupabaseChatImportantSeenRepository(harness.client);
  });

  it('findSeenMessageIds stays in the chapter', async () => {
    const seen = await harness.expectTenantScoped(CHAPTER_A, () =>
      repo.findSeenMessageIds(CHAPTER_A, USER_SHARED, [
        MESSAGE_A,
        MESSAGE_B,
        MESSAGE_A_UNSEEN,
      ]),
    );

    expect([...seen]).toEqual([MESSAGE_A]);
  });

  it("findSeenMessageIds does not count another member's row", async () => {
    const seen = await repo.findSeenMessageIds(CHAPTER_A, USER_SHARED, [
      MESSAGE_A_OTHERS,
    ]);

    expect(seen.size).toBe(0);
  });

  it('findSeenMessageIds asks nothing for no ids', async () => {
    const seen = await repo.findSeenMessageIds(CHAPTER_A, USER_SHARED, []);

    expect(seen.size).toBe(0);
    expect(harness.ops).toHaveLength(0);
  });

  it('markSeen writes the member and chapter given, once per message', async () => {
    await harness.expectTenantScoped(CHAPTER_A, () =>
      repo.markSeen(CHAPTER_A, USER_SHARED, [
        MESSAGE_A_UNSEEN,
        MESSAGE_A_UNSEEN,
      ]),
    );

    const written = harness
      .rows('chat_message_important_seen')
      .filter((row) => row.message_id === MESSAGE_A_UNSEEN);
    expect(written).toEqual([
      {
        user_id: USER_SHARED,
        message_id: MESSAGE_A_UNSEEN,
        chapter_id: CHAPTER_A,
      },
    ]);
  });

  it('markSeen leaves the other chapter alone', async () => {
    await repo.markSeen(CHAPTER_A, USER_SHARED, [MESSAGE_A]);

    const chapters = harness
      .rows('chat_message_important_seen')
      .map((row) => row.chapter_id);
    expect(chapters.filter((c) => c === CHAPTER_B)).toHaveLength(2);
  });

  it('markSeen keeps the first seen_at on a repeat', async () => {
    await repo.markSeen(CHAPTER_A, USER_SHARED, [MESSAGE_A]);

    // The payload never carries `seen_at`, so even a conflict that updated
    // the row would leave the stored time alone.
    const op = harness.ops.find((o) => o.mode === 'upsert');
    expect(op?.payload[0]).not.toHaveProperty('seen_at');
    const row = harness
      .rows('chat_message_important_seen')
      .find((r) => r.message_id === MESSAGE_A);
    expect(row?.seen_at).toBe('2026-11-11T10:00:00.000Z');
  });

  it('markSeen writes nothing for no ids', async () => {
    await repo.markSeen(CHAPTER_A, USER_SHARED, []);

    expect(harness.ops).toHaveLength(0);
  });
});
