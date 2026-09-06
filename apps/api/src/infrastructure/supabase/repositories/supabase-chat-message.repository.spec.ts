import { SupabaseChatMessageRepository } from './supabase-chat-message.repository';
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
// A second channel per chapter, kept apart from CHANNEL_A/CHANNEL_B so the
// extra fixture rows below don't perturb `findByChannel`/`findPollsByChapter`'s
// existing single-message assertions. Seeded as an A/B pair (CHANNEL_A2 empty)
// because the tenant harness requires every table seeded evenly across both
// chapters to keep its cross-tenant collision guard meaningful.
const CHANNEL_A2 = '0a000000-0000-4000-8000-000000000170';
const CHANNEL_B2 = '0b000000-0000-4000-8000-000000000170';
const POLL_A = '0a000000-0000-4000-8000-000000000161';
const POLL_B = '0b000000-0000-4000-8000-000000000161';

const message = (
  id: string,
  channelId: string,
  chapterId: string,
  authorAvatarPath: string | null = null,
  type: string = 'POLL',
  metadata: Record<string, unknown> = { expires_at: null },
) => ({
  id,
  channel_id: channelId,
  sender_id: USER_SHARED,
  content: 'Are you coming to formal?',
  type,
  reply_to_id: null,
  metadata,
  is_pinned: false,
  pinned_at: null,
  edited_at: null,
  is_deleted: false,
  created_at: '2026-01-01T00:00:00.000Z',
  author_avatar_path: authorAvatarPath,
  // How PostgREST projects `chat_channels!inner(chapter_id)` back onto the row.
  chat_channels: { chapter_id: chapterId },
});

const AVATAR_A =
  'chapters/ch-a/chat-archive/imports/import-a/media/aaa-avatar.png';
const AVATAR_B =
  'chapters/ch-b/chat-archive/imports/import-b/media/bbb-avatar.png';
const SHARED_AVATAR_B =
  'chapters/ch-b/chat-archive/imports/import-b/media/shared.png';
const WITH_SHARED_AVATAR_1 = '0b000000-0000-4000-8000-000000000162';
const WITH_SHARED_AVATAR_2 = '0b000000-0000-4000-8000-000000000163';
const WITHOUT_AVATAR = '0b000000-0000-4000-8000-000000000164';

// `active` filter fixtures (#379), in CHANNEL_A2 — a channel no other test
// queries `findPollsByChapter` against, so these can't perturb the CHAPTER_B
// assertions elsewhere in this file.
const POLL_A_OPEN = '0a000000-0000-4000-8000-000000000171';
const POLL_A_CLOSED_EARLY = '0a000000-0000-4000-8000-000000000172';
const POLL_A_EXPIRED = '0a000000-0000-4000-8000-000000000173';

const seed = () => ({
  chat_channels: [
    inA({ id: CHANNEL_A, name: 'general', type: 'PUBLIC' }),
    inB({ id: CHANNEL_B, name: 'general', type: 'PUBLIC' }),
    inA({ id: CHANNEL_A2, name: 'random', type: 'PUBLIC' }),
    inB({ id: CHANNEL_B2, name: 'random', type: 'PUBLIC' }),
  ],
  chat_messages: [
    message(POLL_A, CHANNEL_A, CHAPTER_A, AVATAR_A),
    message(POLL_B, CHANNEL_B, CHAPTER_B, AVATAR_B),
    message(
      WITH_SHARED_AVATAR_1,
      CHANNEL_B2,
      CHAPTER_B,
      SHARED_AVATAR_B,
      'TEXT',
    ),
    message(
      WITH_SHARED_AVATAR_2,
      CHANNEL_B2,
      CHAPTER_B,
      SHARED_AVATAR_B,
      'TEXT',
    ),
    message(WITHOUT_AVATAR, CHANNEL_B2, CHAPTER_B, null, 'TEXT'),
    message(POLL_A_OPEN, CHANNEL_A2, CHAPTER_A, null, 'POLL', {
      expires_at: null,
    }),
    // Manually closed well before its (still-future) deadline — the case the
    // old expires_at-only SQL filter couldn't see.
    message(POLL_A_CLOSED_EARLY, CHANNEL_A2, CHAPTER_A, null, 'POLL', {
      expires_at: '2099-01-01T00:00:00.000Z',
      closed_at: '2026-01-01T00:00:00.000Z',
      closed_by: USER_SHARED,
    }),
    message(POLL_A_EXPIRED, CHANNEL_A2, CHAPTER_A, null, 'POLL', {
      expires_at: '2020-01-01T00:00:00.000Z',
    }),
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

  it('findPollsByChapter active=true excludes a manually closed poll even with a future expires_at (#379)', async () => {
    const polls = await repo.findPollsByChapter(CHAPTER_A, {
      channelId: CHANNEL_A2,
      active: true,
    });

    expect(polls.map((p) => p.id)).toEqual([POLL_A_OPEN]);
  });

  it('findPollsByChapter active=false includes a manually closed poll even with a future expires_at, alongside an expired one (#379)', async () => {
    const polls = await repo.findPollsByChapter(CHAPTER_A, {
      channelId: CHANNEL_A2,
      active: false,
    });

    expect(polls.map((p) => p.id).sort()).toEqual(
      [POLL_A_CLOSED_EARLY, POLL_A_EXPIRED].sort(),
    );
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

  it('update stays inside the caller chapter subtree', async () => {
    // `chat_messages` has no chapter, so the guard leans entirely on
    // `parentTenant` resolving through the channel. An edit matched on
    // something both twins share would reach chapter A and be caught here.
    await harness.expectTenantScoped(CHAPTER_B, () =>
      repo.update(POLL_B, { content: 'Edited' }),
    );

    const rows = harness.rows('chat_messages');
    expect(rows.find((m) => m.id === POLL_B)?.content).toBe('Edited');
    expect(rows.find((m) => m.id === POLL_A)?.content).toBe(
      'Are you coming to formal?',
    );
  });

  it('findById filters on the message id alone', async () => {
    // Characterisation. `ChatService.assertMessageAccess` loads the message,
    // then runs `assertChannelAccess(message.channel_id, chapterId, …)` and
    // rewrites a cross-chapter miss as 404.
    const foreign = await repo.findById(POLL_A);

    expect(foreign?.id).toBe(POLL_A);
    expect(harness.ops[0].filters.map((f) => f.column)).toEqual(['id']);
  });

  it('findAuthorAvatarPaths ignores a message id belonging to another channel (#1231)', async () => {
    // `ChatService.resolveAuthorAvatars` never trusts a caller-supplied
    // storage path — it derives the path set from message ids the caller
    // already proved access to via `channelId`. A POLL_A id handed to
    // channel B's lookup must contribute nothing, or that boundary is a lie.
    const paths = await repo.findAuthorAvatarPaths(CHANNEL_B, [POLL_A, POLL_B]);

    expect(paths).toEqual([AVATAR_B]);
  });

  it('findAuthorAvatarPaths dedupes repeated paths and drops nulls', async () => {
    const paths = await repo.findAuthorAvatarPaths(CHANNEL_B2, [
      WITH_SHARED_AVATAR_1,
      WITH_SHARED_AVATAR_2,
      WITHOUT_AVATAR,
    ]);

    expect(paths).toEqual([SHARED_AVATAR_B]);
  });
});
