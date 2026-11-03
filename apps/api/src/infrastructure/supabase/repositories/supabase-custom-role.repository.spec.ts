import { SupabaseCustomRoleRepository } from './supabase-custom-role.repository';
import { CustomRoleKeyConflictError } from '#domain/repositories/custom-role.repository.interface';
import { SupabaseQueryError } from '../supabase-query-error';
import type { FrappSupabaseClient } from '../database.types';
import {
  CHAPTER_A,
  CHAPTER_B,
  createTenantHarness,
  inA,
  inB,
  type TenantHarness,
} from '#test/helpers/tenant-scope.harness';

/**
 * Tenant scope for `chapter_custom_roles`. The permission resolver flattens
 * these rows' `capabilities` into a member's effective set, so a read that
 * reached another chapter's role would grant that chapter's capabilities.
 */

const ROLE_A = '0a000000-0000-4000-8000-000000000400';
const ROLE_B = '0b000000-0000-4000-8000-000000000400';

const roleRow = () => ({
  key: 'pledge_educator',
  label: 'Pledge Educator',
  rank: 9,
  capabilities: ['members:view'],
  core: false,
  created_at: '2026-01-01T00:00:00.000Z',
  updated_at: '2026-01-01T00:00:00.000Z',
});

const seed = () => ({
  chapter_custom_roles: [
    inA({ id: ROLE_A, ...roleRow() }),
    inB({ id: ROLE_B, ...roleRow() }),
  ],
});

describe('SupabaseCustomRoleRepository — tenant scope', () => {
  let harness: TenantHarness;
  let repo: SupabaseCustomRoleRepository;

  beforeEach(() => {
    harness = createTenantHarness({ tables: seed() });
    repo = new SupabaseCustomRoleRepository(harness.client);
  });

  it('findByChapter returns only the caller chapter roles', async () => {
    const roles = await harness.expectTenantScoped(CHAPTER_B, () =>
      repo.findByChapter(CHAPTER_B),
    );

    expect(roles.map((r) => r.id)).toEqual([ROLE_B]);
  });

  it('findByIds drops an id from another chapter', async () => {
    const roles = await harness.expectTenantScoped(CHAPTER_B, () =>
      repo.findByIds([ROLE_A, ROLE_B], CHAPTER_B),
    );

    expect(roles.map((r) => r.id)).toEqual([ROLE_B]);
  });

  it('findByIds does not query for an empty id list', async () => {
    await expect(repo.findByIds([], CHAPTER_B)).resolves.toEqual([]);
    expect(harness.ops).toHaveLength(0);
  });

  it('findById misses an id belonging to another chapter', async () => {
    await expect(
      harness.expectTenantScoped(CHAPTER_B, () =>
        repo.findById(ROLE_A, CHAPTER_B),
      ),
    ).resolves.toBeNull();
  });

  it('create writes into the caller chapter', async () => {
    const created = await harness.expectTenantScoped(CHAPTER_B, () =>
      repo.create({
        id: '0b000000-0000-4000-8000-000000000401',
        chapter_id: CHAPTER_B,
        ...roleRow(),
        key: 'historian',
      }),
    );

    expect(created.chapter_id).toBe(CHAPTER_B);
  });

  it('update refuses an id belonging to another chapter and writes nothing', async () => {
    await expect(
      harness.expectTenantScoped(CHAPTER_B, () =>
        repo.update(ROLE_A, CHAPTER_B, { capabilities: ['billing:manage'] }),
      ),
    ).resolves.toBeNull();

    expect(
      harness.rows('chapter_custom_roles').find((r) => r.id === ROLE_A)
        ?.capabilities,
    ).toEqual(['members:view']);
  });

  it('delete leaves another chapter role in place', async () => {
    await harness.expectTenantScoped(CHAPTER_B, () =>
      repo.delete(ROLE_A, CHAPTER_B),
    );

    expect(harness.rows('chapter_custom_roles').map((r) => r.id)).toContain(
      ROLE_A,
    );
  });
});

describe('SupabaseCustomRoleRepository — error mapping', () => {
  /** A client whose every chain settles with `result`. */
  const failingClient = (result: { data: unknown; error: unknown }) => {
    const chain: Record<string, unknown> = {};
    for (const method of ['select', 'insert', 'update', 'eq']) {
      chain[method] = jest.fn(() => chain);
    }
    chain.single = jest.fn(() => Promise.resolve(result));
    chain.maybeSingle = jest.fn(() => Promise.resolve(result));
    return { from: jest.fn(() => chain) } as unknown as FrappSupabaseClient;
  };

  it('translates a duplicate key into CustomRoleKeyConflictError', async () => {
    const repo = new SupabaseCustomRoleRepository(
      failingClient({ data: null, error: { code: '23505', message: 'dup' } }),
    );

    await expect(
      repo.create({ chapter_id: CHAPTER_A, key: 'dup' }),
    ).rejects.toBeInstanceOf(CustomRoleKeyConflictError);
  });

  it('wraps any other insert failure in SupabaseQueryError', async () => {
    const repo = new SupabaseCustomRoleRepository(
      failingClient({ data: null, error: { code: '42P01', message: 'gone' } }),
    );

    await expect(
      repo.create({ chapter_id: CHAPTER_A, key: 'dup' }),
    ).rejects.toBeInstanceOf(SupabaseQueryError);
  });

  // #2459, preserved: these report a failed read or write as a miss. When
  // #2459 is fixed these two cases flip to expecting a SupabaseQueryError.
  it('reports a failed findById as a miss (#2459)', async () => {
    const repo = new SupabaseCustomRoleRepository(
      failingClient({ data: null, error: { code: '57014', message: 'slow' } }),
    );

    await expect(repo.findById(ROLE_A, CHAPTER_A)).resolves.toBeNull();
  });

  it('reports a failed update as a miss (#2459)', async () => {
    const repo = new SupabaseCustomRoleRepository(
      failingClient({ data: null, error: { code: '57014', message: 'slow' } }),
    );

    await expect(
      repo.update(ROLE_A, CHAPTER_A, { label: 'New' }),
    ).resolves.toBeNull();
  });
});
