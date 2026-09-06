import { SupabaseInviteRepository } from './supabase-invite.repository';
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
const TOKEN_A = 'token-for-chapter-a';
const TOKEN_B = 'token-for-chapter-b';

const seed = () => ({
  invites: [
    inA({
      id: INVITE_A,
      token: TOKEN_A,
      role: 'MEMBER',
      created_by: USER_SHARED,
      used_at: null,
      expires_at: '2099-01-01T00:00:00.000Z',
      created_at: '2026-01-01T00:00:00.000Z',
    }),
    inB({
      id: INVITE_B,
      token: TOKEN_B,
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
    harness = createTenantHarness({
      tables: seed(),
      // A token is a secret that identifies exactly one invite; making the two
      // collide would model a state the unique index forbids, and would make
      // `findByToken` untestable.
      collisionExempt: { invites: ['token'] },
    });
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
    it('findByToken resolves across chapters — the token is the boundary', async () => {
      // `POST /invites/redeem` runs without `ChapterGuard` on purpose: the
      // caller is joining a chapter they are not yet a member of, so there is no
      // request chapter to scope by. `InviteService.redeem` then creates the
      // membership from `invite.chapter_id`, never from a client-supplied one.
      // The query carries no chapter predicate in either direction.
      const fromA = await repo.findByToken(TOKEN_A);
      const fromB = await repo.findByToken(TOKEN_B);

      expect(fromA?.chapter_id).toBe(CHAPTER_A);
      expect(fromB?.chapter_id).toBe(CHAPTER_B);
      expect(harness.ops[0].filters.map((f) => f.column)).toEqual(['token']);
    });

    it('markUsedAtomically (redeem path) claims by id alone', async () => {
      // `InviteService.redeem` reaches this only through a token it has already
      // validated. The `is('used_at', null)` guard is idempotency, not tenancy.
      const claimed = await repo.markUsedAtomically(INVITE_A);

      expect(claimed).toBe(true);
      const row = harness.rows('invites').find((r) => r.id === INVITE_A);
      expect(row).toBeDefined();
      // Asserting `not.toBeNull()` on the field alone would also pass if the
      // row had been deleted, because `find` returns undefined.
      expect(row?.used_at).toEqual(expect.any(String));
    });

    it('markUsed (revoke path) claims by id alone', async () => {
      // The other id-only writer, and the one reachable from a client-supplied
      // `:id` via `DELETE /invites/:id`. `InviteService.revoke` compares
      // `invite.chapter_id !== chapterId` and 404s before calling this; the
      // repository applies no chapter filter of its own.
      await repo.markUsed(INVITE_A);

      const [op] = harness.ops;
      expect(op.filters.map((f) => f.column)).toEqual(['id']);
      expect(
        harness.rows('invites').find((r) => r.id === INVITE_A)?.used_at,
      ).toEqual(expect.any(String));
    });
  });
});
