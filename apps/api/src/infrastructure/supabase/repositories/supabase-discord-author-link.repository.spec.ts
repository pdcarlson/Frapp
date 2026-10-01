import { SupabaseDiscordAuthorLinkRepository } from './supabase-discord-author-link.repository';
import {
  DiscordAuthorLinkConflictError,
  DiscordAuthorLinkNotMemberError,
} from '#domain/repositories/discord-author-link.repository.interface';
import {
  CHAPTER_A,
  CHAPTER_B,
  createTenantHarness,
  inA,
  inB,
} from '#test/helpers/tenant-scope.harness';

/**
 * Tenant scope for members' linked Discord accounts (#2878).
 *
 * A link is per chapter by design: the same Discord account can be linked by
 * the same person in two chapters, and a link in one must never be readable
 * from, or attach history in, the other. The reads carry the chapter in the
 * query; the writes are RPCs, and the harness checks each one passes the
 * caller's chapter as `p_chapter_id`. What those functions then do with it
 * (every UPDATE scoped to that chapter's channels) is SQL, proved against a
 * real database by the migration's own checks, not here.
 */

const MEMBER = '0a000000-0000-4000-8000-0000000005aa';
const DISCORD_A = '3000000000000000001';
const DISCORD_B = '3000000000000000002';

function build(rpc: Record<string, { data?: unknown; error?: unknown }> = {}) {
  const harness = createTenantHarness({
    collisionExempt: {
      // The one per-chapter value: which Discord account the member linked
      // there. Everything else is seeded identically, so only the chapter
      // predicate can tell the rows apart.
      discord_author_links: ['discord_user_id'],
    },
    tables: {
      discord_author_links: [
        inA({
          id: '0a000000-0000-4000-8000-0000000005a1',
          user_id: MEMBER,
          discord_user_id: DISCORD_A,
          discord_username: 'jkslayer',
          linked_at: '2026-09-29T12:00:00Z',
        }),
        inB({
          id: '0b000000-0000-4000-8000-0000000005a1',
          user_id: MEMBER,
          discord_user_id: DISCORD_B,
          discord_username: 'jkslayer',
          linked_at: '2026-09-29T12:00:00Z',
        }),
      ],
    },
    rpc,
  });
  return {
    harness,
    repo: new SupabaseDiscordAuthorLinkRepository(harness.client),
  };
}

describe('SupabaseDiscordAuthorLinkRepository — tenant scope', () => {
  it('findByChapterAndUser answers with this chapter’s link only', async () => {
    const { harness, repo } = build();
    const found = await harness.expectTenantScoped(CHAPTER_B, () =>
      repo.findByChapterAndUser(CHAPTER_B, MEMBER),
    );
    expect(found?.discord_user_id).toBe(DISCORD_B);
    expect(
      (await repo.findByChapterAndUser(CHAPTER_A, MEMBER))?.discord_user_id,
    ).toBe(DISCORD_A);
  });

  it('link passes the caller chapter to the function', async () => {
    const { harness, repo } = build({
      link_discord_author: {
        data: [
          {
            discord_user_id: DISCORD_A,
            discord_username: 'jkslayer',
            linked_at: '2026-09-29T12:00:00Z',
            messages_linked: 3,
          },
        ],
      },
    });
    const linked = await harness.expectTenantScoped(CHAPTER_A, () =>
      repo.link(CHAPTER_A, MEMBER, DISCORD_A, 'jkslayer'),
    );
    expect(linked.messages_linked).toBe(3);
    expect(harness.rpcCalls).toEqual([
      {
        fn: 'link_discord_author',
        args: {
          p_chapter_id: CHAPTER_A,
          p_user_id: MEMBER,
          p_discord_user_id: DISCORD_A,
          p_discord_username: 'jkslayer',
        },
      },
    ]);
  });

  it('unlink passes the caller chapter to the function', async () => {
    const { harness, repo } = build({ unlink_discord_author: { data: 3 } });
    await expect(
      harness.expectTenantScoped(CHAPTER_B, () =>
        repo.unlink(CHAPTER_B, MEMBER),
      ),
    ).resolves.toBe(3);
  });
});

describe('SupabaseDiscordAuthorLinkRepository — errors', () => {
  it('maps a claimed account to DiscordAuthorLinkConflictError', async () => {
    const { repo } = build({
      link_discord_author: {
        error: {
          code: '23505',
          message:
            'link_discord_author: this Discord account is linked to another member',
        },
      },
    });
    await expect(
      repo.link(CHAPTER_A, MEMBER, DISCORD_A, null),
    ).rejects.toBeInstanceOf(DiscordAuthorLinkConflictError);
  });

  it('maps a non-member to DiscordAuthorLinkNotMemberError', async () => {
    const { repo } = build({
      link_discord_author: {
        error: {
          code: '42501',
          message: 'link_discord_author: user is not a member of this chapter',
        },
      },
    });
    await expect(
      repo.link(CHAPTER_A, MEMBER, DISCORD_A, null),
    ).rejects.toBeInstanceOf(DiscordAuthorLinkNotMemberError);
  });

  it('surfaces a missing EXECUTE grant as itself, not as a membership refusal', async () => {
    const denied = {
      code: '42501',
      message: 'permission denied for function link_discord_author',
    };
    const { repo } = build({ link_discord_author: { error: denied } });
    await expect(
      repo.link(CHAPTER_A, MEMBER, DISCORD_A, null),
    ).rejects.toMatchObject({
      name: 'SupabaseQueryError',
      code: '42501',
      message: '42501: permission denied for function link_discord_author',
    });
  });

  it('treats an empty function result as a failure, not a link', async () => {
    const { repo } = build({ link_discord_author: { data: [] } });
    await expect(repo.link(CHAPTER_A, MEMBER, DISCORD_A, null)).rejects.toThrow(
      'link_discord_author returned no row.',
    );
  });

  it('unlink answers null when there was no link', async () => {
    const { repo } = build({ unlink_discord_author: { data: null } });
    await expect(repo.unlink(CHAPTER_A, MEMBER)).resolves.toBeNull();
  });
});
