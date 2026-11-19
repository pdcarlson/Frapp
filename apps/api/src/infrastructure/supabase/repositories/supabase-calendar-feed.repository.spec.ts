import { SupabaseCalendarFeedRepository } from './supabase-calendar-feed.repository';
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
 * Tenant scope for `calendar_feeds` (#3322).
 *
 * Two scopes, as for every per-member table: `chapter_id`, which the harness
 * checks, and `user_id`, which it does not know about, so both are asserted.
 * `findByTokenHash` spans chapters on purpose: a calendar app fetching a link
 * carries no chapter, and the secret token is the boundary, as an invite's is.
 * `sealLegacy` names one row by id, and only while it still holds plaintext.
 */

const FEED_A = '0a000000-0000-4000-8000-000000000300';
const FEED_B = '0b000000-0000-4000-8000-000000000300';
const FEED_A_OTHER = '0a000000-0000-4000-8000-000000000301';
const FEED_A_REVOKED = '0a000000-0000-4000-8000-000000000302';
const FEED_B_OTHER = '0b000000-0000-4000-8000-000000000301';
const FEED_B_REVOKED = '0b000000-0000-4000-8000-000000000302';
const HASH_A = 'a'.repeat(64);
const HASH_B = 'b'.repeat(64);

const seed = () => ({
  calendar_feeds: [
    inA({
      id: FEED_A,
      user_id: USER_SHARED,
      token: null,
      token_hash: HASH_A,
      token_sealed: 'v1.k1.sealed-a',
      created_at: '2026-11-12T00:00:00.000Z',
      revoked_at: null,
    }),
    inB({
      id: FEED_B,
      user_id: USER_SHARED,
      token: null,
      token_hash: HASH_B,
      token_sealed: 'v1.k1.sealed-b',
      created_at: '2026-11-12T00:00:00.000Z',
      revoked_at: null,
    }),
    inA({
      id: FEED_A_OTHER,
      user_id: USER_A,
      token: 'c'.repeat(43),
      token_hash: 'c'.repeat(64),
      token_sealed: null,
      created_at: '2026-11-12T00:00:00.000Z',
      revoked_at: null,
    }),
    inB({
      id: FEED_B_OTHER,
      user_id: USER_A,
      token: 'd'.repeat(43),
      token_hash: 'd'.repeat(64),
      token_sealed: null,
      created_at: '2026-11-12T00:00:00.000Z',
      revoked_at: null,
    }),
    inA({
      id: FEED_A_REVOKED,
      user_id: USER_SHARED,
      token: 'e'.repeat(43),
      token_hash: 'e'.repeat(64),
      token_sealed: null,
      created_at: '2026-11-11T00:00:00.000Z',
      revoked_at: '2026-11-12T00:00:00.000Z',
    }),
    inB({
      id: FEED_B_REVOKED,
      user_id: USER_SHARED,
      token: 'f'.repeat(43),
      token_hash: 'f'.repeat(64),
      token_sealed: null,
      created_at: '2026-11-11T00:00:00.000Z',
      revoked_at: '2026-11-12T00:00:00.000Z',
    }),
  ],
});

describe('SupabaseCalendarFeedRepository — tenant scope', () => {
  let harness: TenantHarness;
  let repo: SupabaseCalendarFeedRepository;

  beforeEach(() => {
    harness = createTenantHarness({
      tables: seed(),
      // A token names exactly one link (unique indexes on both forms);
      // making twins share one would model a state the database forbids.
      collisionExempt: {
        calendar_feeds: ['token', 'token_hash', 'token_sealed'],
      },
    });
    repo = new SupabaseCalendarFeedRepository(harness.client);
  });

  it('findLive reads the member’s live link in the chapter only', async () => {
    const feed = await harness.expectTenantScoped(CHAPTER_A, () =>
      repo.findLive(CHAPTER_A, USER_SHARED),
    );

    expect(feed?.id).toBe(FEED_A);
  });

  it('create writes the chapter and member given', async () => {
    const created = await harness.expectTenantScoped(CHAPTER_B, () =>
      repo.create({
        chapter_id: CHAPTER_B,
        user_id: USER_A,
        token_hash: 'g'.repeat(64),
        token_sealed: 'v1.k1.sealed-g',
      }),
    );

    expect(created).toMatchObject({ chapter_id: CHAPTER_B, user_id: USER_A });
  });

  it('revokeLive stamps only the member’s live link in the chapter', async () => {
    await harness.expectTenantScoped(CHAPTER_A, () =>
      repo.revokeLive(CHAPTER_A, USER_SHARED),
    );

    const revoked = harness
      .rows('calendar_feeds')
      .filter((row) => row.revoked_at !== null)
      .map((row) => row.id)
      .sort();
    expect(revoked).toEqual([FEED_A, FEED_A_REVOKED, FEED_B_REVOKED].sort());
    const earlier = harness
      .rows('calendar_feeds')
      .find((row) => row.id === FEED_A_REVOKED);
    // An already-revoked link keeps its first revoked time.
    expect(earlier?.revoked_at).toBe('2026-11-12T00:00:00.000Z');
  });

  it('findByTokenHash resolves across chapters — the token is the boundary', async () => {
    const fromA = await repo.findByTokenHash(HASH_A);
    const fromB = await repo.findByTokenHash(HASH_B);

    expect(fromA?.chapter_id).toBe(CHAPTER_A);
    expect(fromB?.chapter_id).toBe(CHAPTER_B);
    expect(harness.ops[0].filters.map((f) => f.column)).toEqual(['token_hash']);
  });

  it('sealLegacy replaces one legacy link’s plaintext with its sealed copy', async () => {
    await repo.sealLegacy(FEED_A_OTHER, 'v1.k1.sealed-c');

    const rows = harness.rows('calendar_feeds');
    const sealed = rows.find((row) => row.id === FEED_A_OTHER);
    expect(sealed).toMatchObject({
      token: null,
      token_sealed: 'v1.k1.sealed-c',
    });
    // Its twin in the other chapter keeps its own plaintext until fetched.
    expect(rows.find((row) => row.id === FEED_B_OTHER)?.token).toBe(
      'd'.repeat(43),
    );
    expect(harness.ops[0].filters.map((f) => f.column).sort()).toEqual(
      ['id', 'token'].sort(),
    );
  });
});
