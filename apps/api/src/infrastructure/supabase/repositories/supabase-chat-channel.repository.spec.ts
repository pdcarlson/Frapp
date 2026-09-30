import { SupabaseChatChannelRepository } from './supabase-chat-channel.repository';
import type { FrappSupabaseClient } from '../database.types';
import {
  CHAPTER_A,
  CHAPTER_B,
  createTenantHarness,
  inA,
  inB,
  type TenantHarness,
} from '#test/helpers/tenant-scope.harness';

/**
 * Tenant scope for `chat_channels`.
 *
 * This repository is the chapter boundary for the whole chat subtree.
 * `chat_messages`, `poll_votes`, `message_reactions` and `channel_read_receipts`
 * carry no `chapter_id`; they are reached through a channel, and
 * `ChannelAccessService.assertChannelAccess` establishes that channel with
 * `findById(channelId, chapterId)`. If that filter goes, every one of those
 * tables becomes cross-readable at once.
 */

const CHANNEL_A = '0a000000-0000-4000-8000-000000000080';
const CHANNEL_B = '0b000000-0000-4000-8000-000000000080';

const seed = () => ({
  chat_channels: [
    inA({
      id: CHANNEL_A,
      name: 'general',
      description: null,
      type: 'PUBLIC',
      required_permissions: [],
      member_ids: [],
      category_id: null,
      is_read_only: false,
      created_at: '2026-01-01T00:00:00.000Z',
    }),
    inB({
      id: CHANNEL_B,
      name: 'general',
      description: null,
      type: 'PUBLIC',
      required_permissions: [],
      member_ids: [],
      category_id: null,
      is_read_only: false,
      created_at: '2026-01-01T00:00:00.000Z',
    }),
  ],
});

describe('SupabaseChatChannelRepository — tenant scope', () => {
  let harness: TenantHarness;
  let repo: SupabaseChatChannelRepository;

  beforeEach(() => {
    harness = createTenantHarness({ tables: seed() });
    repo = new SupabaseChatChannelRepository(harness.client);
  });

  it('findByChapter returns only the caller chapter channels', async () => {
    const channels = await harness.expectTenantScoped(CHAPTER_B, () =>
      repo.findByChapter(CHAPTER_B),
    );

    expect(channels.map((c) => c.id)).toEqual([CHANNEL_B]);
  });

  describe('findByIds', () => {
    it('drops ids belonging to another chapter', async () => {
      // `filterAccessibleChannelIds` treats membership in CHAPTER_B as
      // `isChapterMember` for every returned row. CHANNEL_A is PUBLIC; if it
      // survived this query it would be returned as accessible.
      const channels = await harness.expectTenantScoped(CHAPTER_B, () =>
        repo.findByIds(CHAPTER_B, [CHANNEL_A, CHANNEL_B]),
      );

      expect(channels.map((c) => c.id)).toEqual([CHANNEL_B]);
    });

    it('returns [] without querying when ids is empty', async () => {
      await expect(repo.findByIds(CHAPTER_B, [])).resolves.toEqual([]);
      expect(harness.ops).toEqual([]);
    });

    it('does not filter archived_at', async () => {
      // Bookmarks pass `{ includeArchived: true }` and decide in memory.
      // Pushing the archive filter into SQL would redact rows that path can
      // still read (#348 / #736).
      const ARCHIVED_A = '0a000000-0000-4000-8000-000000000081';
      const ARCHIVED_B = '0b000000-0000-4000-8000-000000000081';
      harness = createTenantHarness({
        tables: {
          chat_channels: [
            ...seed().chat_channels,
            inA({
              id: ARCHIVED_A,
              name: 'archived',
              description: null,
              type: 'PUBLIC',
              required_permissions: [],
              member_ids: [],
              category_id: null,
              is_read_only: false,
              created_at: '2026-01-02T00:00:00.000Z',
              archived_at: '2026-01-02T00:00:00.000Z',
            }),
            inB({
              id: ARCHIVED_B,
              name: 'archived',
              description: null,
              type: 'PUBLIC',
              required_permissions: [],
              member_ids: [],
              category_id: null,
              is_read_only: false,
              created_at: '2026-01-02T00:00:00.000Z',
              archived_at: '2026-01-02T00:00:00.000Z',
            }),
          ],
        },
      });
      repo = new SupabaseChatChannelRepository(harness.client);

      const channels = await harness.expectTenantScoped(CHAPTER_B, () =>
        repo.findByIds(CHAPTER_B, [CHANNEL_B, ARCHIVED_A, ARCHIVED_B]),
      );

      expect(channels.map((c) => c.id).sort()).toEqual(
        [ARCHIVED_B, CHANNEL_B].sort(),
      );
    });
  });

  it('findById refuses a channel id from another chapter', async () => {
    // The single most load-bearing filter in chat: `assertChannelAccess` turns a
    // null here into a 404 and every message, reaction and vote under that
    // channel becomes unreachable with it.
    const foreign = await harness.expectTenantScoped(CHAPTER_B, () =>
      repo.findById(CHANNEL_A, CHAPTER_B),
    );

    expect(foreign).toBeNull();
  });

  it('delete leaves another chapter channel in place', async () => {
    await harness.expectTenantScoped(CHAPTER_B, () =>
      repo.delete(CHANNEL_A, CHAPTER_B),
    );

    expect(
      harness
        .rows('chat_channels')
        .map((c) => c.id)
        .sort(),
    ).toEqual([CHANNEL_A, CHANNEL_B].sort());
  });

  describe('createDm', () => {
    const LOW = '0c000000-0000-4000-8000-000000000001';
    const HIGH = '0c000000-0000-4000-8000-000000000002';

    it('writes the DM into the caller chapter, stored as the sorted pair', async () => {
      const created = await harness.expectTenantScoped(CHAPTER_B, () =>
        repo.createDm(CHAPTER_B, [HIGH, LOW]),
      );

      expect(created).toMatchObject({
        chapter_id: CHAPTER_B,
        type: 'DM',
        name: `dm-${LOW}-${HIGH}`,
        member_ids: [LOW, HIGH],
      });
    });

    it("findDm does not return another chapter's DM for the same pair", async () => {
      await repo.createDm(CHAPTER_A, [LOW, HIGH]);

      const foreign = await harness.expectTenantScoped(CHAPTER_B, () =>
        repo.findDm(CHAPTER_B, [HIGH, LOW]),
      );

      expect(foreign).toBeNull();
    });
  });
});

/**
 * The race `createDm` exists for (#2788), which the tenant harness cannot
 * reach: its `insert` appends unconditionally, so it never raises the `23505`
 * that `chat_channels_dm_pair_key` does when a concurrent call inserted the
 * pair first. PostgREST cannot use that expression index as an `ON CONFLICT`
 * arbiter, so the repository inserts, catches the violation, and re-selects.
 * `test/integration/chat-dm-pair.integration-spec.ts` proves the same against
 * a real database.
 */
describe('SupabaseChatChannelRepository — createDm when the pair already exists', () => {
  const CHAPTER = '0d000000-0000-4000-8000-000000000001';
  const LOW = '0d000000-0000-4000-8000-000000000011';
  const HIGH = '0d000000-0000-4000-8000-000000000012';
  const winner = {
    id: '0d000000-0000-4000-8000-000000000080',
    chapter_id: CHAPTER,
    name: `dm-${LOW}-${HIGH}`,
    type: 'DM',
    member_ids: [LOW, HIGH],
  };

  /**
   * Minimal PostgREST double: `.insert(...).select().single()` answers with
   * `insertError`, and `findDm`'s `.select().eq().eq().contains()` answers with
   * `reselect`. `filters` records the re-select's predicates.
   */
  function createClient(options: {
    insertError: unknown;
    reselect: Record<string, unknown>[];
  }) {
    const filters: Array<[string, unknown]> = [];
    const builder: Record<string, unknown> = {
      insert: jest.fn(() => builder),
      select: jest.fn(() => builder),
      eq: jest.fn((column: string, value: unknown) => {
        filters.push([column, value]);
        return builder;
      }),
      contains: jest.fn((column: string, value: unknown) => {
        filters.push([column, value]);
        return Promise.resolve({ data: options.reselect, error: null });
      }),
      single: jest.fn(() =>
        Promise.resolve({ data: null, error: options.insertError }),
      ),
    };
    const from = jest.fn(() => builder);
    const client = { from } as unknown as FrappSupabaseClient;
    return { client, filters, from };
  }

  it('returns the DM the other call inserted instead of surfacing 23505', async () => {
    const { client, filters, from } = createClient({
      insertError: { code: '23505', message: 'duplicate key value' },
      reselect: [winner],
    });
    const repo = new SupabaseChatChannelRepository(client);

    const result = await repo.createDm(CHAPTER, [HIGH, LOW]);

    expect(from).toHaveBeenCalledWith('chat_channels');
    expect(result.id).toBe(winner.id);
    // Scoped to the caller's chapter and pair, so the read-back cannot hand
    // over another chapter's DM between the same two users.
    expect(filters).toEqual([
      ['chapter_id', CHAPTER],
      ['type', 'DM'],
      ['member_ids', [LOW, HIGH]],
    ]);
  });

  it('re-reads the pair when the caller sent the ids in uppercase', async () => {
    // Postgres returns uuid[] lowercase. Compared as sent, an uppercase id
    // would miss its own pair here and turn the 23505 into a 500 on every retry.
    const { client, filters } = createClient({
      insertError: { code: '23505', message: 'duplicate key value' },
      reselect: [winner],
    });
    const repo = new SupabaseChatChannelRepository(client);

    const result = await repo.createDm(CHAPTER, [
      HIGH.toUpperCase(),
      LOW.toUpperCase(),
    ]);

    expect(result.id).toBe(winner.id);
    expect(filters).toContainEqual(['member_ids', [LOW, HIGH]]);
  });

  it('rethrows when the winning DM vanished between the insert and the re-select', async () => {
    const { client } = createClient({
      insertError: { code: '23505', message: 'duplicate key value' },
      reselect: [],
    });
    const repo = new SupabaseChatChannelRepository(client);

    await expect(repo.createDm(CHAPTER, [LOW, HIGH])).rejects.toMatchObject({
      code: '23505',
    });
  });

  it('rethrows an error that is not a unique violation', async () => {
    const { client } = createClient({
      insertError: { code: '23514', message: 'check violation' },
      reselect: [winner],
    });
    const repo = new SupabaseChatChannelRepository(client);

    await expect(repo.createDm(CHAPTER, [LOW, HIGH])).rejects.toMatchObject({
      code: '23514',
    });
  });
});
