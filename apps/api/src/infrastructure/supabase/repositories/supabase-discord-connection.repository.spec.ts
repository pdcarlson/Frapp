import { SupabaseDiscordConnectionRepository } from './supabase-discord-connection.repository';
import {
  CHAPTER_A,
  CHAPTER_B,
  createTenantHarness,
  inA,
  inB,
  type TenantHarness,
} from '../../../../test/helpers/tenant-scope.harness';

/**
 * Tenant scope for the Discord bot connection and its OAuth handshake.
 *
 * This is the highest-stakes scoping in the feature, and it is worth being
 * explicit about why. One Signet-owned bot token holds read access to EVERY
 * connected chapter's Discord server at once. The only thing that decides which
 * server a given import may read is `discord_connections.guild_id`, resolved by
 * `chapter_id` — so a `findByChapter` that could return another chapter's row
 * would not be a listing bug, it would hand one chapter's import the other's
 * entire message history, with the bot's own credentials behind it.
 *
 * `consumeState` is the deliberate exception and cannot be otherwise. Discord's
 * callback is an unauthenticated top-level browser redirect: no session, no
 * bearer token, no `x-chapter-id`. The state row is what *establishes* the
 * chapter rather than something checked against it. Its safety is therefore not
 * a chapter predicate but three other properties, each tested below: the id is
 * an unguessable server-minted uuid, it is single-use, and it expires.
 */

const CONN_A = '0a000000-0000-4000-8000-0000000002a0';
const CONN_B = '0b000000-0000-4000-8000-0000000002a0';
const STATE_A = '0a000000-0000-4000-8000-0000000002a1';
const STATE_B = '0b000000-0000-4000-8000-0000000002a1';

const GUILD_A = '800000000000000001';
const GUILD_B = '800000000000000002';

const NOW = new Date('2026-08-24T12:00:00Z');
const LATER = new Date(NOW.getTime() + 60_000).toISOString();
const EARLIER = new Date(NOW.getTime() - 60_000).toISOString();

describe('SupabaseDiscordConnectionRepository — tenant scope', () => {
  let harness: TenantHarness;
  let repo: SupabaseDiscordConnectionRepository;

  beforeEach(() => {
    harness = createTenantHarness({
      collisionExempt: {
        // `guild_id` is THE per-chapter value and is exactly what must differ —
        // the assertion below is that chapter A's read yields guild A. Every
        // other column is seeded identically so the tenant predicate is the
        // only thing that can possibly narrow the result.
        discord_connections: ['guild_id'],
      },
      tables: {
        discord_connections: [
          inA({
            id: CONN_A,
            guild_id: GUILD_A,
            guild_name: 'Tau Nu',
            connected_discord_user_id: '2000000000000000002',
          }),
          inB({
            id: CONN_B,
            guild_id: GUILD_B,
            guild_name: 'Tau Nu',
            connected_discord_user_id: '2000000000000000002',
          }),
        ],
        discord_oauth_states: [
          inA({ id: STATE_A, expires_at: LATER, consumed_at: null }),
          inB({ id: STATE_B, expires_at: LATER, consumed_at: null }),
        ],
      },
    });
    repo = new SupabaseDiscordConnectionRepository(harness.client);
  });

  it('findByChapter is scoped to the caller chapter', async () => {
    const found = await harness.expectTenantScoped(CHAPTER_B, () =>
      repo.findByChapter(CHAPTER_B),
    );
    expect(found?.guild_id).toBe(GUILD_B);
  });

  it('NEVER answers with another chapter’s guild', async () => {
    // The single most important assertion in this file. Everything downstream —
    // discovery, the message walk, the attachment fetch — takes the guild from
    // this call, so a leak here aims the shared bot at another tenant.
    const found = await repo.findByChapter(CHAPTER_A);
    expect(found?.guild_id).toBe(GUILD_A);
    expect(found?.guild_id).not.toBe(GUILD_B);
  });

  it('answers nothing for a chapter with no connection', async () => {
    expect(
      await repo.findByChapter('0c000000-0000-4000-8000-00000000ffff'),
    ).toBeNull();
  });

  it('deleteByChapter cannot reach another chapter’s connection', async () => {
    await harness.expectTenantScoped(CHAPTER_B, () =>
      repo.deleteByChapter(CHAPTER_B),
    );
    // A's connection survives B disconnecting.
    expect(harness.rows('discord_connections').map((row) => row.id)).toEqual([
      CONN_A,
    ]);
  });

  it('deleteByChapter reports false when there was nothing to remove', async () => {
    await repo.deleteByChapter(CHAPTER_B);
    expect(await repo.deleteByChapter(CHAPTER_B)).toBe(false);
  });
});

describe('SupabaseDiscordConnectionRepository — the OAuth state', () => {
  /**
   * Built per test rather than in a shared `beforeEach`.
   *
   * `harness.rows()` hands back a CLONE, so mutating what it returns does not
   * change what the repository will query — expiry has to be seeded, not
   * patched afterwards.
   */
  function build(expiry: { a?: string; b?: string } = {}) {
    const harness = createTenantHarness({
      collisionExempt: {
        // Expiry is the whole subject of half these tests, so it has to be
        // settable per chapter.
        discord_oauth_states: ['expires_at'],
      },
      tables: {
        discord_oauth_states: [
          inA({
            id: STATE_A,
            expires_at: expiry.a ?? LATER,
            consumed_at: null,
            return_path: '/discord-import',
          }),
          inB({
            id: STATE_B,
            expires_at: expiry.b ?? LATER,
            consumed_at: null,
            return_path: '/discord-import',
          }),
        ],
      },
    });
    return {
      harness,
      repo: new SupabaseDiscordConnectionRepository(harness.client),
    };
  }

  it('spends a live state and returns the chapter it names', async () => {
    const { repo } = build();
    const consumed = await repo.consumeState(STATE_A, NOW);
    expect(consumed?.chapter_id).toBe(CHAPTER_A);
  });

  it('is SINGLE-USE: a replayed callback gets nothing', async () => {
    // Both conditions live in the UPDATE rather than in a read before it. A
    // read-then-write would let two callbacks replaying one state each see it
    // unspent, and each bind a guild onto a chapter.
    const { repo } = build();
    expect(await repo.consumeState(STATE_A, NOW)).not.toBeNull();
    expect(await repo.consumeState(STATE_A, NOW)).toBeNull();
  });

  it('refuses an expired state', async () => {
    const { repo } = build({ a: EARLIER });
    expect(await repo.consumeState(STATE_A, NOW)).toBeNull();
  });

  it('refuses a state id that does not exist', async () => {
    const { repo } = build();
    expect(
      await repo.consumeState('0c000000-0000-4000-8000-00000000ffff', NOW),
    ).toBeNull();
  });

  it('spending one chapter’s state leaves another chapter’s untouched', async () => {
    const { harness, repo } = build();
    await repo.consumeState(STATE_A, NOW);
    const other = harness
      .rows('discord_oauth_states')
      .find((row) => row.id === STATE_B);
    expect(other?.consumed_at).toBeNull();
  });

  it('createState records the chapter that will be recovered on callback', async () => {
    const { repo } = build();
    const created = await repo.createState({
      chapter_id: CHAPTER_B,
      created_by: 'user-1',
      return_path: '/discord-import',
      expires_at: LATER,
    });
    expect(created.chapter_id).toBe(CHAPTER_B);
    expect(created.consumed_at ?? null).toBeNull();
  });

  it('deleteExpiredStates reaps only what is past its expiry', async () => {
    const { harness, repo } = build({ a: EARLIER });
    expect(await repo.deleteExpiredStates(NOW)).toBe(1);
    expect(harness.rows('discord_oauth_states').map((row) => row.id)).toEqual([
      STATE_B,
    ]);
  });
});
