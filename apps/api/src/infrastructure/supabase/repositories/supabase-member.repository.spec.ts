import { SupabaseMemberRepository } from './supabase-member.repository';
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
 * Tenant scope for `members` — the table that decides who is in a chapter at
 * all, so a leak here is not one feature's bug.
 *
 * The fixture puts the *same user* in both chapters with otherwise identical
 * rows, which is the case a naive fixture misses: `user_id` alone cannot narrow
 * to one chapter, so `findByUserAndChapter` is only correct if it really applies
 * `chapter_id` as well.
 *
 * Scope is deliberately one assertion per tenant-scoped method, not CRUD
 * coverage — mapping, ordering and error translation are somebody else's test.
 */

const MEMBER_A = '0a000000-0000-4000-8000-000000000001';
const MEMBER_B = '0b000000-0000-4000-8000-000000000001';

describe('SupabaseMemberRepository — tenant scope', () => {
  let harness: TenantHarness;
  let repo: SupabaseMemberRepository;

  beforeEach(() => {
    harness = createTenantHarness({
      tables: {
        members: [
          inA({
            id: MEMBER_A,
            user_id: USER_SHARED,
            role_ids: [],
            custom_role_ids: [],
            has_completed_onboarding: false,
          }),
          inB({
            id: MEMBER_B,
            user_id: USER_SHARED,
            role_ids: [],
            custom_role_ids: [],
            has_completed_onboarding: false,
          }),
        ],
      },
    });
    repo = new SupabaseMemberRepository(harness.client);
  });

  it('findByChapter returns only the caller chapter roster', async () => {
    const members = await harness.expectTenantScoped(CHAPTER_B, () =>
      repo.findByChapter(CHAPTER_B),
    );

    expect(members.map((m) => m.id)).toEqual([MEMBER_B]);
  });

  it('findByUserAndChapter resolves the membership for the caller chapter', async () => {
    const member = await harness.expectTenantScoped(CHAPTER_B, () =>
      repo.findByUserAndChapter(USER_SHARED, CHAPTER_B),
    );

    // Both chapters hold a membership for this user, so without the chapter
    // predicate the query matches two rows — `.maybeSingle()` is "zero or one",
    // and PostgREST answers two with `PGRST116` rather than picking one.
    expect(member?.id).toBe(MEMBER_B);
  });

  it('create writes the member under the caller chapter', async () => {
    const created = await harness.expectTenantScoped(CHAPTER_B, () =>
      repo.create({
        id: '0b000000-0000-4000-8000-000000000002',
        user_id: USER_SHARED,
        chapter_id: CHAPTER_B,
        role_ids: [],
        custom_role_ids: [],
        has_completed_onboarding: false,
      }),
    );

    expect(created.chapter_id).toBe(CHAPTER_B);
    expect(harness.rows('members')).toHaveLength(3);
  });

  it('transferPresidencyAtomic passes the chapter to the RPC', async () => {
    harness = createTenantHarness({
      tables: {
        members: [
          inA({ id: MEMBER_A, user_id: USER_SHARED, role_ids: [] }),
          inB({ id: MEMBER_B, user_id: USER_SHARED, role_ids: [] }),
        ],
      },
      rpc: { transfer_presidency: { data: [{ id: MEMBER_B }, { id: 'x' }] } },
    });
    repo = new SupabaseMemberRepository(harness.client);

    // The whole tenancy guarantee of this path is `p_chapter_id`; the swap runs
    // inside SQL where no `.eq()` is visible to review.
    const ok = await harness.expectTenantScoped(CHAPTER_B, () =>
      repo.transferPresidencyAtomic(CHAPTER_B, MEMBER_B, 'x', 'role'),
    );

    expect(ok).toBe(true);
    expect(harness.rpcCalls[0].args).toMatchObject({ p_chapter_id: CHAPTER_B });
  });

  describe('deliberately unscoped surfaces', () => {
    it('findByUser spans chapters, because multi-chapter membership is the feature', async () => {
      const memberships = await repo.findByUser(USER_SHARED);

      expect(memberships.map((m) => m.chapter_id).sort()).toEqual(
        [CHAPTER_A, CHAPTER_B].sort(),
      );
    });

    it('findById / update / delete take a row id and are scoped by their caller', async () => {
      // Characterization, not endorsement: these apply no `chapter_id` filter,
      // so `MemberService` compares `member.chapter_id` against the request
      // chapter before it calls `update`/`delete` (see `member.service.ts`
      // `updateRoles`, `remove`, `findProfileById`). If that comparison is ever
      // dropped, this test still passes — the e2e route tests in
      // `test/cross-tenant-isolation.e2e-spec.ts` are what covers that.
      const foreign = await repo.findById(MEMBER_A);

      expect(foreign?.chapter_id).toBe(CHAPTER_A);
    });
  });
});
