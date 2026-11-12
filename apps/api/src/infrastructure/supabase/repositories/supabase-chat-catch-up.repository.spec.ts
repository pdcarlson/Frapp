import { SupabaseChatCatchUpRepository } from './supabase-chat-catch-up.repository';
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
 * Tenant scope and channel scope for Catch me up's reads (#3946).
 *
 * `chat_messages` has no `chapter_id`: every read here is scoped through the
 * inner join on the message's channel, and the same join refuses a direct
 * message, a group DM and the audit-log channel. The harness does not resolve
 * joins (the embed is whatever the seed row carries), so what this pins is
 * that each read carries all three channel filters and returns nothing when
 * the seed's embed fails them. The join itself is `!inner` by the shared
 * projection, which `chat-message-channel-embed.spec.ts` reads.
 */

const CHANNEL_A = '0a000000-0000-4000-8000-000000003946';
const CHANNEL_B = '0b000000-0000-4000-8000-000000003946';
const DM_A = '0a000000-0000-4000-8000-000000003947';
const AUDIT_A = '0a000000-0000-4000-8000-000000003948';
const ROOT_A = '0a000000-0000-4000-8000-0000000039a1';

const message = (
  id: string,
  channelId: string,
  chapterId: string,
  overrides: Record<string, unknown> = {},
) => ({
  id,
  channel_id: channelId,
  sender_id: USER_SHARED,
  content: 'Formal is at the boathouse.',
  kind: 'text',
  is_deleted: false,
  thread_root_id: null,
  mentions: [],
  created_at: '2026-11-10T18:00:00.000Z',
  chat_channels: { chapter_id: chapterId, type: 'PUBLIC', is_audit_log: false },
  ...overrides,
});

const seed = () => ({
  chat_channels: [
    inA({ id: CHANNEL_A, name: 'general', type: 'PUBLIC' }),
    inB({ id: CHANNEL_B, name: 'general', type: 'PUBLIC' }),
  ],
  chat_messages: [
    message('a-1', CHANNEL_A, CHAPTER_A),
    message('b-1', CHANNEL_B, CHAPTER_B),
    message('a-2', CHANNEL_A, CHAPTER_A, {
      created_at: '2026-11-10T19:00:00.000Z',
      sender_id: USER_A,
      mentions: [USER_SHARED],
    }),
    message('a-old', CHANNEL_A, CHAPTER_A, {
      created_at: '2026-11-01T19:00:00.000Z',
    }),
    message('a-deleted', CHANNEL_A, CHAPTER_A, {
      created_at: '2026-11-10T19:30:00.000Z',
      is_deleted: true,
    }),
    message('a-card', CHANNEL_A, CHAPTER_A, {
      created_at: '2026-11-10T19:40:00.000Z',
      kind: 'event',
    }),
    message('a-empty', CHANNEL_A, CHAPTER_A, {
      created_at: '2026-11-10T19:45:00.000Z',
      content: '',
    }),
    message(ROOT_A, CHANNEL_A, CHAPTER_A, {
      created_at: '2026-11-10T20:00:00.000Z',
    }),
    message('a-reply', CHANNEL_A, CHAPTER_A, {
      created_at: '2026-11-10T21:00:00.000Z',
      thread_root_id: ROOT_A,
    }),
    message('a-card-reply', CHANNEL_A, CHAPTER_A, {
      created_at: '2026-11-10T22:00:00.000Z',
      thread_root_id: 'a-card',
    }),
    message('dm-1', DM_A, CHAPTER_A, {
      created_at: '2026-11-10T19:00:00.000Z',
      chat_channels: { chapter_id: CHAPTER_A, type: 'DM', is_audit_log: false },
    }),
    message('audit-1', AUDIT_A, CHAPTER_A, {
      created_at: '2026-11-10T19:00:00.000Z',
      chat_channels: {
        chapter_id: CHAPTER_A,
        type: 'PUBLIC',
        is_audit_log: true,
      },
    }),
  ],
});

const SINCE = '2026-11-10T00:00:00.000Z';

describe('SupabaseChatCatchUpRepository — tenant scope', () => {
  let harness: TenantHarness;
  let repo: SupabaseChatCatchUpRepository;

  beforeEach(() => {
    harness = createTenantHarness({
      tables: seed(),
      untenantedTables: ['chat_messages'],
      parentTenant: {
        chat_messages: { column: 'channel_id', table: 'chat_channels' },
      },
    });
    repo = new SupabaseChatCatchUpRepository(harness.client);
  });

  const filtersOf = (index: number) =>
    harness.ops[index].filters.map((f) => [f.column, f.value]);

  it('readChannelSince returns the written, live messages since then, oldest first, replies included', async () => {
    const stretch = await repo.readChannelSince({
      chapterId: CHAPTER_A,
      channelId: CHANNEL_A,
      since: SINCE,
      limit: 50,
    });

    expect(stretch.messages.map((m) => m.id)).toEqual([
      'a-1',
      'a-2',
      ROOT_A,
      'a-reply',
      'a-card-reply',
    ]);
    expect(stretch.total).toBe(5);
    expect(stretch.messages[1]).toEqual({
      id: 'a-2',
      sender_id: USER_A,
      content: 'Formal is at the boathouse.',
      created_at: '2026-11-10T19:00:00.000Z',
      thread_root_id: null,
      mentions: [USER_SHARED],
    });
    expect(filtersOf(0)).toContainEqual([
      'chat_channels.chapter_id',
      CHAPTER_A,
    ]);
    expect(filtersOf(0)).toContainEqual(['chat_channels.is_audit_log', false]);
    expect(filtersOf(0)).toContainEqual([
      'chat_channels.type',
      ['PUBLIC', 'PRIVATE', 'ROLE_GATED'],
    ]);
  });

  it('readChannelSince keeps the newest under the limit and still counts the stretch', async () => {
    const stretch = await repo.readChannelSince({
      chapterId: CHAPTER_A,
      channelId: CHANNEL_A,
      since: SINCE,
      limit: 2,
    });
    expect(stretch.messages.map((m) => m.id)).toEqual([
      'a-reply',
      'a-card-reply',
    ]);
    expect(stretch.total).toBe(5);
  });

  it("readChannelSince returns nothing for another chapter's channel", async () => {
    const stretch = await repo.readChannelSince({
      chapterId: CHAPTER_A,
      channelId: CHANNEL_B,
      since: SINCE,
      limit: 50,
    });
    expect(stretch).toEqual({ messages: [], total: 0 });
  });

  it('never reads a direct message or the audit log, whatever channel is passed', async () => {
    for (const channelId of [DM_A, AUDIT_A]) {
      await expect(
        repo.readChannelSince({
          chapterId: CHAPTER_A,
          channelId,
          since: SINCE,
          limit: 50,
        }),
      ).resolves.toEqual({ messages: [], total: 0 });
      await expect(
        repo.unreadStart({
          chapterId: CHAPTER_A,
          channelId,
          userId: USER_A,
          count: 1,
          asOf: '2026-11-11T00:00:00.000Z',
          blockedUserIds: [],
        }),
      ).resolves.toBeNull();
    }
  });

  it('readThread returns the first message and its replies, in this chapter only', async () => {
    const thread = await repo.readThread({
      chapterId: CHAPTER_A,
      channelId: CHANNEL_A,
      rootId: ROOT_A,
      limit: 50,
    });
    expect(thread?.messages.map((m) => m.id)).toEqual([ROOT_A, 'a-reply']);
    expect(thread?.total).toBe(2);
    for (const index of [0, 1]) {
      expect(filtersOf(index)).toContainEqual([
        'chat_channels.chapter_id',
        CHAPTER_A,
      ]);
    }

    await expect(
      repo.readThread({
        chapterId: CHAPTER_B,
        channelId: CHANNEL_A,
        rootId: ROOT_A,
        limit: 50,
      }),
    ).resolves.toBeNull();
    // A thread hanging off a card: its replies are read, the card is not.
    const underCard = await repo.readThread({
      chapterId: CHAPTER_A,
      channelId: CHANNEL_A,
      rootId: 'a-card',
      limit: 50,
    });
    expect(underCard?.messages.map((m) => m.id)).toEqual(['a-card-reply']);
    expect(underCard?.total).toBe(1);
    // A reply is not a thread.
    await expect(
      repo.readThread({
        chapterId: CHAPTER_A,
        channelId: CHANNEL_A,
        rootId: 'a-reply',
        limit: 50,
      }),
    ).resolves.toBeNull();
  });

  it("unreadStart finds where the member's unread stretch began", async () => {
    // What counted as unread to USER_A at midnight, newest first: ROOT_A,
    // the empty row, the card, a-1, a-old. Not a-2 (their own), the reply
    // (it lives in its thread) or the deleted one. Cards count because the
    // badge counts them.
    const input = {
      chapterId: CHAPTER_A,
      channelId: CHANNEL_A,
      userId: USER_A,
      asOf: '2026-11-11T00:00:00.000Z',
      blockedUserIds: [],
    };
    await expect(repo.unreadStart({ ...input, count: 1 })).resolves.toBe(
      '2026-11-10T20:00:00.000Z',
    );
    await expect(repo.unreadStart({ ...input, count: 4 })).resolves.toBe(
      '2026-11-10T18:00:00.000Z',
    );
    await expect(repo.unreadStart({ ...input, count: 9 })).resolves.toBeNull();
    // The badge leaves out a member the reader blocked, so the count walks
    // back over the same messages the badge counted.
    await expect(
      repo.unreadStart({ ...input, count: 1, blockedUserIds: [USER_SHARED] }),
    ).resolves.not.toBe('2026-11-10T20:00:00.000Z');
    expect(filtersOf(0)).toContainEqual([
      'chat_channels.chapter_id',
      CHAPTER_A,
    ]);
    await expect(
      repo.unreadStart({ ...input, chapterId: CHAPTER_B, count: 1 }),
    ).resolves.toBeNull();
  });
});
