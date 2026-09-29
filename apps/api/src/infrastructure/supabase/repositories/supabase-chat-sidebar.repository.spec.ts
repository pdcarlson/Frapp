import { SupabaseChatSidebarRepository } from './supabase-chat-sidebar.repository';
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
 * Tenant scope for `chat_sidebar_preferences` and `chat_sidebar_pins` (#2877).
 *
 * Both tables carry their own `chapter_id`, so the ordinary predicate check
 * applies. Each also has a second scope the harness doesn't know about,
 * `user_id`: a query that filtered the chapter but not the member would pass a
 * tenant check and still hand one member another's arrangement. So the seed
 * gives each chapter a row for the same member and a row for a different
 * member, and both predicates are asserted.
 */

const CHANNEL_A = '0a000000-0000-4000-8000-000000002877';
const CHANNEL_B = '0b000000-0000-4000-8000-000000002877';
const CHANNEL_A_OTHER = '0a000000-0000-4000-8000-000000012877';

const prefs = (overrides: Record<string, unknown>) => ({
  unread_only: false,
  hide_muted: true,
  collapsed_sections: ['direct'],
  created_at: '2026-09-29T00:00:00.000Z',
  updated_at: '2026-09-29T00:00:00.000Z',
  ...overrides,
});

const seed = () => ({
  chat_sidebar_preferences: [
    inA(prefs({ id: 'prefs-a', user_id: USER_SHARED })),
    inB(prefs({ id: 'prefs-b', user_id: USER_SHARED })),
    inA(prefs({ id: 'prefs-a-other', user_id: USER_A })),
    inB(prefs({ id: 'prefs-b-other', user_id: USER_A })),
  ],
  chat_sidebar_pins: [
    inA({
      id: 'pin-a',
      user_id: USER_SHARED,
      channel_id: CHANNEL_A,
      created_at: '2026-09-29T00:00:00.000Z',
    }),
    inB({
      id: 'pin-b',
      user_id: USER_SHARED,
      channel_id: CHANNEL_B,
      created_at: '2026-09-29T00:00:00.000Z',
    }),
    inA({
      id: 'pin-a-other',
      user_id: USER_A,
      channel_id: CHANNEL_A_OTHER,
      created_at: '2026-09-29T00:00:00.000Z',
    }),
    inB({
      id: 'pin-b-other',
      user_id: USER_A,
      channel_id: '0b000000-0000-4000-8000-000000012877',
      created_at: '2026-09-29T00:00:00.000Z',
    }),
  ],
});

describe('SupabaseChatSidebarRepository — tenant scope', () => {
  let harness: TenantHarness;
  let repo: SupabaseChatSidebarRepository;

  beforeEach(() => {
    harness = createTenantHarness({
      tables: seed(),
      collisionExempt: {
        // The twins differ on these by construction; everything else matches.
        chat_sidebar_preferences: ['user_id'],
        chat_sidebar_pins: ['user_id', 'channel_id'],
      },
      rpc: {
        set_chat_sidebar_section_collapsed: {
          data: [prefs({ user_id: USER_SHARED, chapter_id: CHAPTER_A })],
        },
      },
    });
    repo = new SupabaseChatSidebarRepository(harness.client);
  });

  it('findPreferences stays in the chapter it is given', async () => {
    const row = await harness.expectTenantScoped(CHAPTER_A, () =>
      repo.findPreferences(CHAPTER_A, USER_SHARED),
    );

    expect(row?.chapter_id).toBe(CHAPTER_A);
    expect(row?.user_id).toBe(USER_SHARED);
  });

  it("findPreferences never returns another member's row", async () => {
    const row = await repo.findPreferences(CHAPTER_A, USER_A);

    expect(row?.user_id).toBe(USER_A);
    expect((row as { id?: string } | null)?.id).toBe('prefs-a-other');
  });

  it('findPreferences is null for a member with no row', async () => {
    await expect(
      repo.findPreferences(CHAPTER_A, '66666666-6666-4666-8666-666666666666'),
    ).resolves.toBeNull();
  });

  it('updateFilters writes only the filter given, in the chapter given', async () => {
    await harness.expectTenantScoped(CHAPTER_A, () =>
      repo.updateFilters(CHAPTER_A, USER_SHARED, { unread_only: true }),
    );

    const row = harness
      .rows('chat_sidebar_preferences')
      .find((r) => r.id === 'prefs-a');
    expect(row).toMatchObject({
      unread_only: true,
      // Untouched: the payload never named it.
      hide_muted: true,
      collapsed_sections: ['direct'],
    });
    const untouched = harness
      .rows('chat_sidebar_preferences')
      .filter((r) => r.id !== 'prefs-a');
    expect(untouched.every((r) => r.unread_only === false)).toBe(true);
  });

  it('updateFilters never writes collapsed_sections', async () => {
    await repo.updateFilters(CHAPTER_A, USER_SHARED, { hide_muted: false });

    const upserts = harness.ops.filter(
      (op) => op.table === 'chat_sidebar_preferences' && op.mode === 'upsert',
    );
    expect(upserts).toHaveLength(1);
    expect(upserts[0].payload).toHaveLength(1);
    expect(upserts[0].payload?.[0]).not.toHaveProperty('collapsed_sections');
    expect(upserts[0].payload?.[0]).not.toHaveProperty('unread_only');
  });

  it('setSectionCollapsed passes the chapter and member to the RPC', async () => {
    await harness.expectTenantScoped(CHAPTER_A, () =>
      repo.setSectionCollapsed(CHAPTER_A, USER_SHARED, 'pinned', true),
    );

    expect(harness.rpcCalls).toEqual([
      {
        fn: 'set_chat_sidebar_section_collapsed',
        args: {
          p_user_id: USER_SHARED,
          p_chapter_id: CHAPTER_A,
          p_section_key: 'pinned',
          p_collapsed: true,
        },
      },
    ]);
  });

  it('findPinnedChannelIds returns only this member, this chapter', async () => {
    const ids = await harness.expectTenantScoped(CHAPTER_A, () =>
      repo.findPinnedChannelIds(CHAPTER_A, USER_SHARED),
    );

    expect(ids).toEqual([CHANNEL_A]);
  });

  it('pin is idempotent', async () => {
    await harness.expectTenantScoped(CHAPTER_A, () =>
      repo.pin(CHAPTER_A, USER_SHARED, CHANNEL_A),
    );

    expect(
      harness
        .rows('chat_sidebar_pins')
        .filter((r) => r.user_id === USER_SHARED && r.channel_id === CHANNEL_A),
    ).toHaveLength(1);
  });

  it('pin never writes into another chapter', async () => {
    await harness.expectTenantScoped(CHAPTER_B, () =>
      repo.pin(CHAPTER_B, USER_A, '0b000000-0000-4000-8000-000000022877'),
    );
  });

  it("unpin leaves another member's pin and the other chapter alone", async () => {
    await harness.expectTenantScoped(CHAPTER_A, () =>
      repo.unpin(CHAPTER_A, USER_SHARED, CHANNEL_A),
    );
    // A channel id from the other chapter, under this chapter: matches nothing.
    await repo.unpin(CHAPTER_A, USER_SHARED, CHANNEL_B);
    await repo.unpin(CHAPTER_A, USER_SHARED, CHANNEL_A_OTHER);

    expect(
      harness
        .rows('chat_sidebar_pins')
        .map((r) => r.id)
        .sort(),
    ).toEqual(['pin-a-other', 'pin-b', 'pin-b-other']);
  });
});
