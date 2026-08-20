import { SupabaseChatChannelRepository } from './supabase-chat-channel.repository';
import {
  CHAPTER_B,
  createTenantHarness,
  inA,
  inB,
  type TenantHarness,
} from '../../../../test/helpers/tenant-scope.harness';

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
});
