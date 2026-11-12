import { SupabaseChapterGroupRepository } from './supabase-chapter-group.repository';
import {
  CHAPTER_A,
  CHAPTER_B,
  createTenantHarness,
  inA,
  inB,
  type TenantHarness,
} from '#test/helpers/tenant-scope.harness';

/**
 * Tenant scope for `chapter_groups` and `chapter_group_memberships` (#4076).
 * Both chapters have a "Third floor" group with the same member, so only a
 * chapter filter tells them apart.
 */

const GROUP_A = '0a000000-0000-4000-8000-000000000090';
const GROUP_B = '0b000000-0000-4000-8000-000000000090';
const USER = '0c000000-0000-4000-8000-000000000091';

const group = (id: string) => ({
  id,
  kind: 'manual',
  name: 'Third floor',
  color: null,
  mentionable: true,
  pledge_class_id: null,
  class_year: null,
  created_at: '2026-01-01T00:00:00.000Z',
  updated_at: '2026-01-01T00:00:00.000Z',
});

const seed = () => ({
  chapter_groups: [inA(group(GROUP_A)), inB(group(GROUP_B))],
  // The view's twins share every column but the chapter, so only the
  // chapter filter keeps the other chapter's row out.
  chapter_group_memberships: [
    // `id` is the harness's row key; the view has none.
    inA({ id: 'membership-a', group_id: GROUP_B, user_id: USER }),
    inB({ id: 'membership-b', group_id: GROUP_B, user_id: USER }),
  ],
});

describe('SupabaseChapterGroupRepository — tenant scope', () => {
  let harness: TenantHarness;
  let repo: SupabaseChapterGroupRepository;

  beforeEach(() => {
    harness = createTenantHarness({ tables: seed() });
    repo = new SupabaseChapterGroupRepository(harness.client);
  });

  it("findByChapter returns only the caller chapter's groups", async () => {
    const groups = await harness.expectTenantScoped(CHAPTER_B, () =>
      repo.findByChapter(CHAPTER_B),
    );

    expect(groups.map((g) => g.id)).toEqual([GROUP_B]);
  });

  it("findById misses another chapter's group", async () => {
    const found = await harness.expectTenantScoped(CHAPTER_B, () =>
      repo.findById(GROUP_A, CHAPTER_B),
    );

    expect(found).toBeNull();
  });

  it("update leaves another chapter's group alone and reports it missing", async () => {
    const updated = await harness.expectTenantScoped(CHAPTER_B, () =>
      repo.update(GROUP_A, CHAPTER_B, { name: 'Live-ins' }),
    );

    expect(updated).toBeUndefined();
    expect(
      harness.rows('chapter_groups').find((r) => r.id === GROUP_A)?.name,
    ).toBe('Third floor');
  });

  it("delete leaves another chapter's group alone", async () => {
    await harness.expectTenantScoped(CHAPTER_B, () =>
      repo.delete(GROUP_A, CHAPTER_B),
    );

    expect(harness.rows('chapter_groups').map((r) => r.id)).toContain(GROUP_A);
  });

  it("findMemberships returns only the caller chapter's rows", async () => {
    const rows = await harness.expectTenantScoped(CHAPTER_B, () =>
      repo.findMemberships(CHAPTER_B),
    );

    expect(rows.map((r) => r.chapter_id)).toEqual([CHAPTER_B]);
  });

  it("findGroupIdsForUser returns only the caller chapter's groups", async () => {
    const ids = await harness.expectTenantScoped(CHAPTER_B, () =>
      repo.findGroupIdsForUser(CHAPTER_B, USER),
    );

    expect(ids).toEqual([GROUP_B]);
  });

  it('setMembers passes the chapter to the RPC', async () => {
    harness = createTenantHarness({
      tables: seed(),
      rpc: { set_chapter_group_members: { data: [USER] } },
    });
    repo = new SupabaseChapterGroupRepository(harness.client);

    const members = await harness.expectTenantScoped(CHAPTER_B, () =>
      repo.setMembers(GROUP_B, CHAPTER_B, [USER]),
    );

    expect(members).toEqual([USER]);
    expect(harness.rpcCalls[0].args).toEqual({
      p_chapter_id: CHAPTER_B,
      p_group_id: GROUP_B,
      p_user_ids: [USER],
    });
  });
});
