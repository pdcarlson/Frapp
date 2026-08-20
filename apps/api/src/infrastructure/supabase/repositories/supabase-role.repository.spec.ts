import { SupabaseRoleRepository } from './supabase-role.repository';
import {
  CHAPTER_A,
  CHAPTER_B,
  createTenantHarness,
  inA,
  inB,
  type TenantHarness,
} from '../../../../test/helpers/tenant-scope.harness';

/**
 * Tenant scope for `roles` — roles carry permissions, so resolving one from the
 * wrong chapter grants the wrong authority. This is the table where a leak
 * escalates rather than merely discloses.
 *
 * Both chapters seed a role with the same `name`, the same `system_key` and the
 * same `permissions`. That collision is the point: `findByChapterAndName` and
 * `findByChapterAndSystemKey` both look correct if you only read them, and both
 * would silently resolve the other chapter's role without their `chapter_id`
 * predicate.
 */

const ROLE_A = '0a000000-0000-4000-8000-000000000020';
const ROLE_B = '0b000000-0000-4000-8000-000000000020';

const seed = () => ({
  roles: [
    inA({
      id: ROLE_A,
      name: 'Treasurer',
      system_key: 'TREASURER',
      permissions: ['billing:view'],
      is_system: true,
      display_order: 1,
      color: null,
    }),
    inB({
      id: ROLE_B,
      name: 'Treasurer',
      system_key: 'TREASURER',
      permissions: ['billing:view'],
      is_system: true,
      display_order: 1,
      color: null,
    }),
  ],
});

describe('SupabaseRoleRepository — tenant scope', () => {
  let harness: TenantHarness;
  let repo: SupabaseRoleRepository;

  beforeEach(() => {
    harness = createTenantHarness({ tables: seed() });
    repo = new SupabaseRoleRepository(harness.client);
  });

  it('findByChapter returns only the caller chapter roles', async () => {
    const roles = await harness.expectTenantScoped(CHAPTER_B, () =>
      repo.findByChapter(CHAPTER_B),
    );

    expect(roles.map((r) => r.id)).toEqual([ROLE_B]);
  });

  it('findByChapterAndName does not resolve the same role name in another chapter', async () => {
    const role = await harness.expectTenantScoped(CHAPTER_B, () =>
      repo.findByChapterAndName(CHAPTER_B, 'Treasurer'),
    );

    expect(role?.id).toBe(ROLE_B);
  });

  it('findByChapterAndSystemKey does not resolve the same system role in another chapter', async () => {
    const role = await harness.expectTenantScoped(CHAPTER_B, () =>
      repo.findByChapterAndSystemKey(CHAPTER_B, 'TREASURER'),
    );

    expect(role?.id).toBe(ROLE_B);
  });

  it('findByIds drops ids belonging to another chapter when given the chapter', async () => {
    // This is the permission-resolution path. A stale `role_ids` entry pointing
    // at another chapter must contribute nothing, or a member inherits
    // permissions granted somewhere they do not belong.
    const roles = await harness.expectTenantScoped(CHAPTER_B, () =>
      repo.findByIds([ROLE_A, ROLE_B], CHAPTER_B),
    );

    expect(roles.map((r) => r.id)).toEqual([ROLE_B]);
  });

  it('create writes the role under the caller chapter', async () => {
    const created = await harness.expectTenantScoped(CHAPTER_B, () =>
      repo.create({
        id: '0b000000-0000-4000-8000-000000000021',
        chapter_id: CHAPTER_B,
        name: 'Scribe',
        permissions: [],
        is_system: false,
        display_order: 2,
      }),
    );

    expect(created.chapter_id).toBe(CHAPTER_B);
  });

  describe('deliberately unscoped surfaces', () => {
    it('findByIds without a chapter spans chapters', async () => {
      // The parameter is optional in the signature, and omitting it returns
      // every chapter's matching role. Every production caller
      // (`RbacService.resolvePermissionSet`) passes the chapter — this asserts
      // what the omitted-argument path actually does, so the optionality stays a
      // visible decision rather than a discovered one.
      const roles = await repo.findByIds([ROLE_A, ROLE_B]);

      expect(roles.map((r) => r.chapter_id).sort()).toEqual(
        [CHAPTER_A, CHAPTER_B].sort(),
      );
    });

    it('findById / update / delete take a row id and are scoped by their caller', async () => {
      // `RbacService.update` and `.delete` both load the role and compare
      // `role.chapter_id !== chapterId` before writing.
      const foreign = await repo.findById(ROLE_A);

      expect(foreign?.chapter_id).toBe(CHAPTER_A);
    });
  });
});
