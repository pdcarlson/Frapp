import { SupabaseInviteRepository } from './supabase-invite.repository';
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
 * Tenant scope for `invites` — an invite is a grant of membership, so a leaked
 * one is a leaked chapter.
 *
 * `invites` is also the clearest example of why "unscoped" and "unsafe" are not
 * the same word: `findByToken` deliberately spans chapters, because redeeming an
 * invite is how a user reaches a chapter they are not yet in. The secret token
 * is the boundary there, not `chapter_id`. That is asserted below so the
 * distinction survives the next refactor.
 */

const INVITE_A = '0a000000-0000-4000-8000-000000000010';
const INVITE_B = '0b000000-0000-4000-8000-000000000010';
const SHARED_TOKEN = 'shared-token-value';

const seed = () => ({
  invites: [
    inA({
      id: INVITE_A,
      token: SHARED_TOKEN,
      role: 'MEMBER',
      created_by: USER_SHARED,
      used_at: null,
      expires_at: '2099-01-01T00:00:00.000Z',
      created_at: '2026-01-01T00:00:00.000Z',
    }),
    inB({
      id: INVITE_B,
      token: SHARED_TOKEN,
      role: 'MEMBER',
      created_by: USER_SHARED,
      used_at: null,
      expires_at: '2099-01-01T00:00:00.000Z',
      created_at: '2026-01-01T00:00:00.000Z',
    }),
  ],
});

describe('SupabaseInviteRepository — tenant scope', () => {
  let harness: TenantHarness;
  let repo: SupabaseInviteRepository;

  beforeEach(() => {
    harness = createTenantHarness({ tables: seed() });
    repo = new SupabaseInviteRepository(harness.client);
  });

  it('findByChapter lists only the caller chapter invites', async () => {
    const invites = await harness.expectTenantScoped(CHAPTER_B, () =>
      repo.findByChapter(CHAPTER_B),
    );

    expect(invites.map((i) => i.id)).toEqual([INVITE_B]);
  });

  it('create issues the invite under the caller chapter', async () => {
    const created = await harness.expectTenantScoped(CHAPTER_B, () =>
      repo.create({
        id: '0b000000-0000-4000-8000-000000000011',
        token: 'fresh-token',
        chapter_id: CHAPTER_B,
        role: 'MEMBER',
        created_by: USER_SHARED,
        expires_at: '2099-01-01T00:00:00.000Z',
      }),
    );

    expect(created.chapter_id).toBe(CHAPTER_B);
  });

  it('createMany issues every invite under the caller chapter', async () => {
    const created = await harness.expectTenantScoped(CHAPTER_B, () =>
      repo.createMany([
        {
          id: '0b000000-0000-4000-8000-000000000012',
          token: 't1',
          chapter_id: CHAPTER_B,
          role: 'MEMBER',
          created_by: USER_SHARED,
          expires_at: '2099-01-01T00:00:00.000Z',
        },
        {
          id: '0b000000-0000-4000-8000-000000000013',
          token: 't2',
          chapter_id: CHAPTER_B,
          role: 'MEMBER',
          created_by: USER_SHARED,
          expires_at: '2099-01-01T00:00:00.000Z',
        },
      ]),
    );

    expect(created.every((i) => i.chapter_id === CHAPTER_B)).toBe(true);
  });

  describe('deliberately unscoped surfaces', () => {
    it('findByToken spans chapters — the token is the boundary, not the chapter', async () => {
      // `POST /invites/redeem` runs without `ChapterGuard` on purpose: the
      // caller is joining a chapter they are not yet a member of, so there is no
      // request chapter to scope by. `InviteService.redeem` then creates the
      // membership from `invite.chapter_id`, never from a client-supplied one.
      const invite = await repo.findByToken(SHARED_TOKEN);

      expect(invite).not.toBeNull();
      expect([CHAPTER_A, CHAPTER_B]).toContain(invite?.chapter_id);
    });

    it('markUsedAtomically claims by id and is scoped by its caller', async () => {
      // No `chapter_id` filter: `InviteService.revoke` checks
      // `invite.chapter_id !== chapterId` first, and `redeem` reaches it only
      // through a validated token. The `is('used_at', null)` guard here is
      // idempotency, not tenancy.
      const claimed = await repo.markUsedAtomically(INVITE_A);

      expect(claimed).toBe(true);
      expect(
        harness.rows('invites').find((r) => r.id === INVITE_A)?.used_at,
      ).not.toBeNull();
    });
  });
});
