import { SupabaseChatMessageRepository } from './supabase-chat-message.repository';
import {
  CHAPTER_A,
  CHAPTER_B,
  USER_SHARED,
  createTenantHarness,
  inA,
  inB,
  type TenantHarness,
} from '../../../../test/helpers/tenant-scope.harness';

/**
 * Tenant scope for `chat_messages`.
 *
 * The table has no `chapter_id`. Most methods are channel-scoped and rely on
 * `ChannelAccessService.assertChannelAccess`, which loads the channel with
 * `findById(channelId, chapterId)` — so the chapter check happens one table
 * over.
 *
 * `findPollsByChapter` is the exception: it takes a `chapterId` and applies it
 * through a PostgREST inner join (`.eq('chat_channels.chapter_id', …)`), and no
 * other test in the suite exercises that path.
 *
 * What that assertion does *not* cover, because the harness records the
 * `select()` string without parsing it: dropping `!inner` from
 * `'*, chat_channels!inner(chapter_id)'`. Against real PostgREST that turns the
 * embed filter into a non-filter — the row comes back with a nulled embed
 * instead of being excluded — and every chapter's polls leak. That is query
 * shape, and it belongs to the live-PostgREST integration suite
 * (`test/integration/`), not here.
 */

const CHANNEL_A = '0a000000-0000-4000-8000-000000000160';
const CHANNEL_B = '0b000000-0000-4000-8000-000000000160';
const POLL_A = '0a000000-0000-4000-8000-000000000161';
const POLL_B = '0b000000-0000-4000-8000-000000000161';

const message = (id: string, channelId: string, chapterId: string) => ({
  id,
  channel_id: channelId,
  sender_id: USER_SHARED,
  content: 'Are you coming to formal?',
  type: 'POLL',
  reply_to_id: null,
  metadata: { expires_at: null },
  is_pinned: false,
  pinned_at: null,
  edited_at: null,
  is_deleted: false,
  created_at: '2026-01-01T00:00:00.000Z',
  // How PostgREST projects `chat_channels!inner(chapter_id)` back onto the row.
  chat_channels: { chapter_id: chapterId },
});

const seed = () => ({
  chat_channels: [
    inA({ id: CHANNEL_A, name: 'general', type: 'PUBLIC' }),
    inB({ id: CHANNEL_B, name: 'general', type: 'PUBLIC' }),
  ],
  chat_messages: [
    message(POLL_A, CHANNEL_A, CHAPTER_A),
    message(POLL_B, CHANNEL_B, CHAPTER_B),
  ],
});

describe('SupabaseChatMessageRepository — tenant scope', () => {
  let harness: TenantHarness;
  let repo: SupabaseChatMessageRepository;

  beforeEach(() => {
    harness = createTenantHarness({
      tables: seed(),
      // `chat_messages` has no `chapter_id`, so the predicate check cannot run.
      // Resolving the chapter through the channel — the way production does —
      // keeps the foreign-write check alive for it.
      untenantedTables: ['chat_messages'],
      parentTenant: {
        chat_messages: { column: 'channel_id', table: 'chat_channels' },
      },
    });
    repo = new SupabaseChatMessageRepository(harness.client);
  });

  it('findPollsByChapter filters through the channel join', async () => {
    const polls = await repo.findPollsByChapter(CHAPTER_B);

    expect(polls.map((p) => p.id)).toEqual([POLL_B]);
    expect(
      harness.ops[0].filters.map((f) => [f.column, f.value]),
    ).toContainEqual(['chat_channels.chapter_id', CHAPTER_B]);
  });

  it('findPollsByChapter keeps the chapter filter when narrowed to a channel', async () => {
    const polls = await repo.findPollsByChapter(CHAPTER_B, {
      channelId: CHANNEL_B,
    });

    expect(polls.map((p) => p.id)).toEqual([POLL_B]);
    expect(
      harness.ops[0].filters.map((f) => [f.column, f.value]),
    ).toContainEqual(['chat_channels.chapter_id', CHAPTER_B]);
  });

  it('findByChannel narrows to the channel, which is what carries the chapter', async () => {
    // Both messages are identical apart from `channel_id`; that predicate is
    // the only thing separating them, and `assertChannelAccess` is what makes
    // the channel id itself trustworthy.
    const messages = await repo.findByChannel(CHANNEL_B);

    expect(messages.map((m) => m.id)).toEqual([POLL_B]);
  });

  it('findById filters on the message id alone', async () => {
    // Characterisation. `ChatService.assertMessageAccess` loads the message,
    // then runs `assertChannelAccess(message.channel_id, chapterId, …)` and
    // rewrites a cross-chapter miss as 404.
    const foreign = await repo.findById(POLL_A);

    expect(foreign?.id).toBe(POLL_A);
    expect(harness.ops[0].filters.map((f) => f.column)).toEqual(['id']);
  });
});
