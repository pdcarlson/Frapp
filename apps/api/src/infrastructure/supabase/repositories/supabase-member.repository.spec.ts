import { SupabaseMemberRepository } from './supabase-member.repository';
import { runWithRequestReads } from '../request-reads';
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
    // and `postgrest-js` raises `PGRST116` rather than picking one.
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

  it('claimPresidencyAtomic passes the chapter to the RPC', async () => {
    harness = createTenantHarness({
      tables: {
        members: [
          inA({ id: MEMBER_A, user_id: USER_SHARED, role_ids: [] }),
          inB({ id: MEMBER_B, user_id: USER_SHARED, role_ids: [] }),
        ],
      },
      rpc: { claim_presidency: { data: true } },
    });
    repo = new SupabaseMemberRepository(harness.client);

    // Same tenancy contract as transferPresidencyAtomic: `p_chapter_id` is the
    // only scoping visible outside the RPC's own SQL.
    const ok = await harness.expectTenantScoped(CHAPTER_B, () =>
      repo.claimPresidencyAtomic(CHAPTER_B, MEMBER_B, 'eligible-role', 'role'),
    );

    expect(ok).toBe(true);
    expect(harness.rpcCalls[0].args).toMatchObject({
      p_chapter_id: CHAPTER_B,
      p_eligible_role_id: 'eligible-role',
      p_president_role_id: 'role',
    });
  });

  it('setRoleIds passes the chapter and the read value to the RPC, and answers null when it wrote nothing', async () => {
    harness = createTenantHarness({
      tables: {
        members: [
          inA({ id: MEMBER_A, user_id: USER_SHARED, role_ids: [] }),
          inB({ id: MEMBER_B, user_id: USER_SHARED, role_ids: [] }),
        ],
      },
      rpc: { set_member_role_ids: { data: [] } },
    });
    repo = new SupabaseMemberRepository(harness.client);

    // #4830: the compare-and-set runs inside SQL, so `p_chapter_id` and
    // `p_expected` are all a reviewer sees of its scope and its condition.
    const written = await harness.expectTenantScoped(CHAPTER_B, () =>
      repo.setRoleIds(CHAPTER_B, MEMBER_B, ['held'], ['held', 'given']),
    );

    expect(written).toBeNull();
    expect(harness.rpcCalls[0].args).toEqual({
      p_chapter_id: CHAPTER_B,
      p_member_id: MEMBER_B,
      p_expected: ['held'],
      p_role_ids: ['held', 'given'],
    });
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

  // An app open's GET requests join one membership read (#3752); a request
  // that may write reads its own.
  it.each([
    ['GET', 1],
    ['POST', 2],
  ])(
    'findByUserAndChapter in two %s requests at once makes %i read(s)',
    async (method, reads) => {
      const from = jest.spyOn(harness.client, 'from');
      const member = (chapter: string) =>
        runWithRequestReads(String(method), () =>
          repo.findByUserAndChapter(USER_SHARED, chapter),
        );

      const [a, b] = await Promise.all([member(CHAPTER_B), member(CHAPTER_B)]);

      expect(from).toHaveBeenCalledTimes(Number(reads));
      expect(a?.id).toBe(MEMBER_B);
      expect(b?.id).toBe(MEMBER_B);
      expect(a).not.toBe(b);
    },
  );
});

/**
 * Role mentions expand through `role_ids` on this read (2026-11-06). Every
 * service test mocks the repository with `role_ids` already filled, so this is
 * the one place a select that drops the column, which would silently send
 * every role mention to nobody, turns red.
 */
describe('SupabaseMemberRepository.findChapterMemberIdentities', () => {
  function clientReturning(rows: unknown[]) {
    const select = jest.fn().mockReturnValue({
      eq: jest.fn().mockResolvedValue({ data: rows, error: null }),
    });
    const client = { from: jest.fn().mockReturnValue({ select }) };
    return { client, select };
  }

  it('selects role_ids and carries them on each identity', async () => {
    const { client, select } = clientReturning([
      {
        user_id: 'user-1',
        role_ids: ['role-officers', 7],
        users: { id: 'user-1', display_name: 'Jane Doe' },
      },
      {
        user_id: 'user-2',
        role_ids: null,
        users: [{ id: 'user-2', display_name: 'Bob' }],
      },
    ]);
    const repo = new SupabaseMemberRepository(client as never);

    const identities = await repo.findChapterMemberIdentities('chapter-1');

    expect(select.mock.calls[0][0]).toContain('role_ids');
    expect(identities).toEqual([
      {
        user_id: 'user-1',
        display_name: 'Jane Doe',
        role_ids: ['role-officers'],
      },
      { user_id: 'user-2', display_name: 'Bob', role_ids: [] },
    ]);
  });
});
