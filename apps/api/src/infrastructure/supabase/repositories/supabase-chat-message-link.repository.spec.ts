import { SupabaseChatMessageLinkRepository } from './supabase-chat-message-link.repository';
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
 * Tenant scope for `chat_message_links` and `chat_link_member_states`
 * (#3897). Both carry their own `chapter_id`.
 *
 * The A/B twins agree on everything but their ids, chapter and channel: same
 * URL, same poster, same time, same member state. So a read or write that
 * drops the chapter predicate reaches the other chapter's twin, and only that
 * predicate tells them apart. The states table has a second scope the harness
 * doesn't know, `user_id`; a chapter-A state of another member is seeded so
 * it has something real to exclude.
 */

const LINK_A = '0a000000-0000-4000-8000-000000000390';
const LINK_B = '0b000000-0000-4000-8000-000000000390';
const OLD_LINK_A = '0a000000-0000-4000-8000-000000000391';
const OLD_LINK_B = '0b000000-0000-4000-8000-000000000391';
const REMOVED_LINK_A = '0a000000-0000-4000-8000-000000000392';
const REMOVED_LINK_B = '0b000000-0000-4000-8000-000000000392';
const CHANNEL_A = '0a000000-0000-4000-8000-000000000393';
const CHANNEL_B = '0b000000-0000-4000-8000-000000000393';
const MESSAGE_A = '0a000000-0000-4000-8000-000000000394';
const MESSAGE_B = '0b000000-0000-4000-8000-000000000394';

const SINCE = '2026-10-12T00:00:00.000Z';

const link = (
  id: string,
  channel: string,
  message: string,
  overrides: Record<string, unknown> = {},
) => ({
  id,
  channel_id: channel,
  message_id: message,
  url: 'https://forms.gle/abc',
  host: 'forms.gle',
  posted_by: USER_A,
  posted_at: '2026-11-10T12:00:00.000Z',
  removed_at: null,
  removed_by: null,
  title: null,
  title_checked_at: null,
  ...overrides,
});

const seed = () => ({
  chat_message_links: [
    inA(link(LINK_A, CHANNEL_A, MESSAGE_A)),
    inB(link(LINK_B, CHANNEL_B, MESSAGE_B)),
    inA(
      link(OLD_LINK_A, CHANNEL_A, MESSAGE_A, {
        posted_at: '2026-09-01T00:00:00.000Z',
      }),
    ),
    inB(
      link(OLD_LINK_B, CHANNEL_B, MESSAGE_B, {
        posted_at: '2026-09-01T00:00:00.000Z',
      }),
    ),
    inA(
      link(REMOVED_LINK_A, CHANNEL_A, MESSAGE_A, {
        removed_at: '2026-11-10T13:00:00.000Z',
        removed_by: USER_SHARED,
      }),
    ),
    inB(
      link(REMOVED_LINK_B, CHANNEL_B, MESSAGE_B, {
        removed_at: '2026-11-10T13:00:00.000Z',
        removed_by: USER_SHARED,
      }),
    ),
  ],
  chat_link_member_states: [
    inA({
      id: 'state-a',
      link_id: LINK_A,
      user_id: USER_SHARED,
      state: 'done',
      updated_at: '2026-11-10T14:00:00.000Z',
    }),
    inB({
      id: 'state-b',
      link_id: LINK_B,
      user_id: USER_SHARED,
      state: 'done',
      updated_at: '2026-11-10T14:00:00.000Z',
    }),
    inA({
      id: 'state-a-other',
      link_id: LINK_A,
      user_id: USER_A,
      state: 'hidden',
      updated_at: '2026-11-10T14:00:00.000Z',
    }),
    inB({
      id: 'state-b-other',
      link_id: LINK_B,
      user_id: USER_A,
      state: 'hidden',
      updated_at: '2026-11-10T14:00:00.000Z',
    }),
  ],
});

describe('SupabaseChatMessageLinkRepository — tenant scope', () => {
  let harness: TenantHarness;
  let repo: SupabaseChatMessageLinkRepository;

  beforeEach(() => {
    harness = createTenantHarness({
      tables: seed(),
      collisionExempt: {
        // The twins differ on these by construction; everything else agrees.
        chat_message_links: ['channel_id', 'message_id'],
        chat_link_member_states: ['link_id'],
      },
    });
    repo = new SupabaseChatMessageLinkRepository(harness.client);
  });

  describe('findShowing', () => {
    it('stays in the chapter even when given the other chapter’s channel', async () => {
      const rows = await harness.expectTenantScoped(CHAPTER_A, () =>
        repo.findShowing(CHAPTER_A, {
          since: SINCE,
          channelIds: [CHANNEL_A, CHANNEL_B],
          limit: 10,
        }),
      );

      expect(rows.map((row) => row.id)).toEqual([LINK_A]);
    });

    it('leaves out removed links, links older than the window and other channels', async () => {
      const rows = await repo.findShowing(CHAPTER_A, {
        since: SINCE,
        channelIds: [CHANNEL_A],
        limit: 10,
      });
      expect(rows.map((row) => row.id)).toEqual([LINK_A]);

      const none = await repo.findShowing(CHAPTER_A, {
        since: SINCE,
        channelIds: ['0a000000-0000-4000-8000-0000000003ff'],
        limit: 10,
      });
      expect(none).toEqual([]);
    });

    it('batches a long channel list and merges newest first, at most limit', async () => {
      // 250 channel ids would be a 414 in one `in` list (#3265).
      const many = Array.from(
        { length: 250 },
        (_, i) => `0a000000-0000-4000-8000-${String(i).padStart(12, '0')}`,
      );
      const rows = await harness.expectTenantScoped(CHAPTER_A, () =>
        repo.findShowing(CHAPTER_A, {
          since: SINCE,
          channelIds: [...many, CHANNEL_A],
          limit: 10,
        }),
      );

      expect(rows.map((row) => row.id)).toEqual([LINK_A]);
      const inLists = harness.ops
        .filter((op) => op.table === 'chat_message_links')
        .map((op) => op.filters.find((f) => f.op === 'in'));
      expect(inLists).toHaveLength(3);
    });

    it('reads nothing for no channels', async () => {
      const rows = await repo.findShowing(CHAPTER_A, {
        since: SINCE,
        channelIds: [],
        limit: 10,
      });

      expect(rows).toEqual([]);
      expect(harness.ops).toHaveLength(0);
    });
  });

  describe('findById', () => {
    it('does not resolve the other chapter’s link', async () => {
      const row = await harness.expectTenantScoped(CHAPTER_A, () =>
        repo.findById(CHAPTER_A, LINK_B),
      );

      expect(row).toBeNull();
    });

    it('resolves its own chapter’s link, removed or not', async () => {
      await expect(repo.findById(CHAPTER_A, REMOVED_LINK_A)).resolves.toEqual(
        expect.objectContaining({ id: REMOVED_LINK_A }),
      );
    });
  });

  describe('findStates', () => {
    it('reads only the member’s own states in the chapter', async () => {
      const rows = await harness.expectTenantScoped(CHAPTER_A, () =>
        repo.findStates(CHAPTER_A, USER_SHARED, [LINK_A, LINK_B]),
      );

      expect(rows.map((row) => row.link_id)).toEqual([LINK_A]);
      expect(rows[0]).toMatchObject({ user_id: USER_SHARED, state: 'done' });
    });
  });

  describe('setState', () => {
    it('writes inside the chapter', async () => {
      await harness.expectTenantScoped(CHAPTER_B, () =>
        repo.setState(CHAPTER_B, LINK_B, USER_SHARED, 'hidden'),
      );

      const states = harness
        .rows('chat_link_member_states')
        .filter((row) => row.user_id === USER_SHARED);
      expect(states.find((row) => row.link_id === LINK_B)).toMatchObject({
        chapter_id: CHAPTER_B,
        state: 'hidden',
      });
      expect(states.find((row) => row.link_id === LINK_A)).toMatchObject({
        state: 'done',
      });
    });
  });

  describe('clearState', () => {
    it('deletes only the member’s own state in the chapter', async () => {
      await harness.expectTenantScoped(CHAPTER_A, () =>
        repo.clearState(CHAPTER_A, LINK_A, USER_SHARED),
      );

      const left = harness
        .rows('chat_link_member_states')
        .map((row) => `${String(row.link_id)}:${String(row.user_id)}`);
      expect(left).not.toContain(`${LINK_A}:${USER_SHARED}`);
      expect(left).toContain(`${LINK_A}:${USER_A}`);
      expect(left).toContain(`${LINK_B}:${USER_SHARED}`);
    });
  });

  describe('setRemoved', () => {
    it('does not reach the other chapter’s link', async () => {
      const row = await harness.expectTenantScoped(CHAPTER_A, () =>
        repo.setRemoved(CHAPTER_A, LINK_B, USER_SHARED),
      );

      expect(row).toBeNull();
      expect(
        harness.rows('chat_message_links').find((r) => r.id === LINK_B),
      ).toMatchObject({ removed_at: null });
    });

    it('removes and restores its own chapter’s link', async () => {
      const removed = await harness.expectTenantScoped(CHAPTER_A, () =>
        repo.setRemoved(CHAPTER_A, LINK_A, USER_SHARED),
      );
      expect(removed).toMatchObject({ id: LINK_A, removed_by: USER_SHARED });
      expect(removed?.removed_at).toEqual(expect.any(String));

      const restored = await repo.setRemoved(CHAPTER_A, LINK_A, null);
      expect(restored).toMatchObject({ removed_at: null, removed_by: null });
    });
  });

  describe('setTitle', () => {
    it('titles only the chapter’s own links, even given the other’s id', async () => {
      await harness.expectTenantScoped(CHAPTER_A, () =>
        repo.setTitle(CHAPTER_A, [LINK_A, LINK_B], 'Formal RSVP'),
      );

      const rows = harness.rows('chat_message_links');
      expect(rows.find((r) => r.id === LINK_A)).toMatchObject({
        title: 'Formal RSVP',
      });
      expect(rows.find((r) => r.id === LINK_B)).toMatchObject({ title: null });
    });

    it('writes nothing for no links', async () => {
      await repo.setTitle(CHAPTER_A, [], 'Formal RSVP');
      expect(harness.ops).toHaveLength(0);
    });
  });

  // The title sweep's reads walk every chapter by design (#4187): what they
  // return is ids, chapters and URLs, and the write above is scoped.
  describe('findTitleUnchecked', () => {
    it('returns unclaimed, unremoved links inside the window, from every chapter', async () => {
      const rows = await repo.findTitleUnchecked({ since: SINCE, limit: 10 });

      expect(rows.map((row) => row.id).sort()).toEqual([LINK_A, LINK_B].sort());
    });
  });

  describe('claimForTitle', () => {
    it('claims each link once: a second claim gets nothing', async () => {
      const first = await repo.claimForTitle([LINK_A, LINK_B]);
      expect(first.map((row) => row.id).sort()).toEqual(
        [LINK_A, LINK_B].sort(),
      );
      expect(
        harness.rows('chat_message_links').find((r) => r.id === LINK_A)
          ?.title_checked_at,
      ).toEqual(expect.any(String));

      const second = await repo.claimForTitle([LINK_A, LINK_B]);
      expect(second).toEqual([]);
      await expect(
        repo.findTitleUnchecked({ since: SINCE, limit: 10 }),
      ).resolves.toEqual([]);
    });

    it('claims nothing for no links', async () => {
      await expect(repo.claimForTitle([])).resolves.toEqual([]);
      expect(harness.ops).toHaveLength(0);
    });
  });
});
