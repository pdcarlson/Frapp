import { SupabaseChatMemberBlockRepository } from './supabase-chat-member-block.repository';
import {
  CHAPTER_A,
  CHAPTER_B,
  USER_SHARED,
  USER_A,
  USER_B,
  createTenantHarness,
  inA,
  inB,
  type TenantHarness,
} from '#test/helpers/tenant-scope.harness';
import { ID_CHUNK_SIZE } from '#domain/utils/chunk-ids';

/**
 * Tenant scope for `chat_member_blocks` (#2257).
 *
 * The table carries its own `chapter_id`, so the ordinary predicate check
 * applies — and the chapter is a product rule here, not just hygiene: a block is
 * scoped **per chapter**, because a member can belong to more than one and
 * blocking someone in one chapter says nothing about another they may both also
 * belong to (`spec/behavior/multi-tenancy.md`).
 *
 * Like the bookmarks spec, this table has a *second* scope the harness knows
 * nothing about — `blocker_user_id` — and that one is the safety guarantee: a
 * query that filtered chapter but not blocker would sail through a tenancy check
 * and still answer "who has blocked me", which is exactly what the feature must
 * never do. Both predicates are asserted on every read.
 *
 * The seed pairs each chapter-A row with an identical chapter-B twin, and adds a
 * pair belonging to a *different* blocker so the blocker predicate has something
 * real to exclude.
 */

const BLOCK_A_MINE = '0a000000-0000-4000-8000-000000000220';
const BLOCK_B_MINE = '0b000000-0000-4000-8000-000000000220';
const BLOCK_A_THEIRS = '0a000000-0000-4000-8000-000000000221';
const BLOCK_B_THEIRS = '0b000000-0000-4000-8000-000000000221';

const mine = () => ({
  blocker_user_id: USER_SHARED,
  blocked_user_id: USER_A,
  created_at: '2026-03-01T00:00:00.000Z',
});

/** Somebody else's block, in the same chapter, against the same member. */
const theirs = () => ({
  blocker_user_id: USER_B,
  blocked_user_id: USER_A,
  created_at: '2026-03-01T00:00:00.000Z',
});

const seed = () => ({
  chat_member_blocks: [
    inA({ id: BLOCK_A_MINE, ...mine() }),
    inA({ id: BLOCK_A_THEIRS, ...theirs() }),
    inB({ id: BLOCK_B_MINE, ...mine() }),
    inB({ id: BLOCK_B_THEIRS, ...theirs() }),
  ],
});

describe('SupabaseChatMemberBlockRepository — tenant scope', () => {
  let harness: TenantHarness;
  let repo: SupabaseChatMemberBlockRepository;

  beforeEach(() => {
    harness = createTenantHarness({ tables: seed() });
    repo = new SupabaseChatMemberBlockRepository(harness.client);
  });

  it('findBlockedUserIds is scoped to the chapter', async () => {
    const ids = await harness.expectTenantScoped(CHAPTER_A, () =>
      repo.findBlockedUserIds(CHAPTER_A, USER_SHARED),
    );

    expect(ids).toEqual([USER_A]);
  });

  it('findBlockersAmong chunks a chapter-sized audience rather than sending one oversized in()', async () => {
    // An audience can be the whole roster (a PUBLIC channel, the announcement
    // fan-out), and one `.in()` over a few hundred UUIDs is a 414 from
    // PostgREST (`chunk-ids.ts`). The blocker sits past the first chunk, so a
    // single-query version that someone "simplified" back would miss it too.
    const audience = Array.from(
      { length: 250 },
      (_, i) => `0c000000-0000-4000-8000-${String(i).padStart(12, '0')}`,
    );
    audience.splice(180, 0, USER_SHARED);

    const blockers = await repo.findBlockersAmong(CHAPTER_A, USER_A, audience);

    expect([...blockers]).toEqual([USER_SHARED]);
    const selects = harness.ops.filter(
      (op) => op.table === 'chat_member_blocks' && op.mode === 'select',
    );
    expect(selects).toHaveLength(Math.ceil(audience.length / ID_CHUNK_SIZE));
    for (const op of selects) {
      const inList = op.filters.find(
        (filter) => filter.column === 'blocker_user_id',
      )?.value as string[];
      expect(inList.length).toBeLessThanOrEqual(ID_CHUNK_SIZE);
    }
  });

  it('findBlockedUserIds never returns another member block list', async () => {
    // The safety guarantee, as a test: chapter scope alone would return
    // USER_B's row too, and nothing else in the stack would notice if the
    // blocker predicate were dropped. "Who has blocked me" must have no answer.
    const ids = await repo.findBlockedUserIds(CHAPTER_A, USER_A);

    expect(ids).toEqual([]);
  });

  it('create is idempotent and does not duplicate an existing block', async () => {
    await repo.create(CHAPTER_A, USER_SHARED, USER_A);

    expect(
      harness
        .rows('chat_member_blocks')
        .filter(
          (r) =>
            r.chapter_id === CHAPTER_A &&
            r.blocker_user_id === USER_SHARED &&
            r.blocked_user_id === USER_A,
        ),
    ).toHaveLength(1);
  });

  it('create keeps the original created_at on a repeat', async () => {
    // `created_at` is not in the upsert payload, so a re-block does not reset
    // the clock — a member who taps twice has blocked once.
    await repo.create(CHAPTER_A, USER_SHARED, USER_A);

    const row = harness
      .rows('chat_member_blocks')
      .find((r) => r.id === BLOCK_A_MINE);
    expect(row?.created_at).toBe('2026-03-01T00:00:00.000Z');
  });

  it('create never writes into another chapter', async () => {
    const created = await harness.expectTenantScoped(CHAPTER_B, () =>
      repo.create(CHAPTER_B, USER_SHARED, USER_B),
    );

    expect(created.chapter_id).toBe(CHAPTER_B);
  });

  it('blocks the same member in a second chapter rather than moving the first block', async () => {
    // The conflict target is a tenancy control, not a detail. Drop `chapter_id`
    // from `onConflict` and the second upsert matches the first row on
    // (blocker, blocked) and REWRITES it — so blocking the same person in a
    // second chapter silently unblocks them in the first, and every other test
    // in this file still passes. A block is scoped to one chapter precisely
    // because a member can belong to several and blocking someone in one says
    // nothing about another (`spec/behavior/multi-tenancy.md`).
    //
    // `USER_B` rather than the seeded `USER_A`, because the seed pairs every
    // chapter-A row with an identical chapter-B twin: re-blocking `USER_A` in
    // chapter B is the idempotent case, which is a different test and would
    // survive this mutation.
    await repo.create(CHAPTER_A, USER_SHARED, USER_B);
    const created = await repo.create(CHAPTER_B, USER_SHARED, USER_B);

    const rows = harness.rows('chat_member_blocks');
    expect(rows).toHaveLength(6);
    expect(created.chapter_id).toBe(CHAPTER_B);
    expect(
      rows.filter(
        (r) =>
          r.chapter_id === CHAPTER_A &&
          r.blocker_user_id === USER_SHARED &&
          r.blocked_user_id === USER_B,
      ),
    ).toHaveLength(1);
  });

  it('never returns blocker_user_id to the caller', async () => {
    const created = await repo.create(CHAPTER_A, USER_SHARED, USER_B);

    expect(created).not.toHaveProperty('blocker_user_id');
  });

  it('delete removes only the caller own block, not another member on the same target', async () => {
    await repo.delete(CHAPTER_A, USER_SHARED, USER_A);

    const remaining = harness
      .rows('chat_member_blocks')
      .map((r) => r.id as string);
    expect(remaining).not.toContain(BLOCK_A_MINE);
    expect(remaining).toContain(BLOCK_A_THEIRS);
  });

  it('delete will not reach a block in another chapter', async () => {
    await repo.delete(CHAPTER_A, USER_SHARED, USER_A);

    expect(harness.rows('chat_member_blocks').map((r) => r.id)).toContain(
      BLOCK_B_MINE,
    );
  });

  it('delete on a block that is not there is a silent no-op', async () => {
    // Every unblock outcome has to be the same 204: a status that distinguished
    // "was blocked" from "wasn't" is an oracle on a feature whose whole point is
    // silence.
    await expect(
      repo.delete(CHAPTER_A, USER_SHARED, USER_B),
    ).resolves.toBeUndefined();
    expect(harness.rows('chat_member_blocks')).toHaveLength(4);
  });
});
