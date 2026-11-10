import { SupabasePledgeClassRepository } from './supabase-pledge-class.repository';
import {
  CHAPTER_A,
  CHAPTER_B,
  createTenantHarness,
  inA,
  inB,
  type TenantHarness,
} from '#test/helpers/tenant-scope.harness';

/**
 * Tenant scope for `chapter_pledge_classes` (#3939). Two chapters each have
 * an "Alpha" class at position 1, so only a chapter filter tells them apart.
 */

const CLASS_A = '0a000000-0000-4000-8000-000000000070';
const CLASS_B = '0b000000-0000-4000-8000-000000000070';
const MEMBER_B = '0b000000-0000-4000-8000-000000000071';

const seed = () => ({
  chapter_pledge_classes: [
    inA({
      id: CLASS_A,
      name: 'Alpha',
      position: 1,
      created_at: '2026-01-01T00:00:00.000Z',
      updated_at: '2026-01-01T00:00:00.000Z',
    }),
    inB({
      id: CLASS_B,
      name: 'Alpha',
      position: 1,
      created_at: '2026-01-01T00:00:00.000Z',
      updated_at: '2026-01-01T00:00:00.000Z',
    }),
  ],
});

describe('SupabasePledgeClassRepository — tenant scope', () => {
  let harness: TenantHarness;
  let repo: SupabasePledgeClassRepository;

  beforeEach(() => {
    harness = createTenantHarness({ tables: seed() });
    repo = new SupabasePledgeClassRepository(harness.client);
  });

  it("findByChapter returns only the caller chapter's classes", async () => {
    const classes = await harness.expectTenantScoped(CHAPTER_B, () =>
      repo.findByChapter(CHAPTER_B),
    );

    expect(classes.map((c) => c.id)).toEqual([CLASS_B]);
  });

  it('findByChapter returns the list oldest first: by position, then by when it was added', async () => {
    const row = (id: string, position: number, created_at: string) => ({
      id,
      name: id,
      position,
      created_at,
      updated_at: created_at,
    });
    // Stored newest first, so only the ordering can put them right; each has
    // a twin in the other chapter.
    const classes = [
      row('third', 2, '2026-03-01T00:00:00.000Z'),
      row('second', 1, '2026-02-01T00:00:00.000Z'),
      row('first', 1, '2026-01-01T00:00:00.000Z'),
    ];
    harness = createTenantHarness({
      tables: {
        chapter_pledge_classes: classes.flatMap((c) => [
          inA({ ...c, id: `a-${c.id}` }),
          inB({ ...c, id: `b-${c.id}` }),
        ]),
      },
    });
    repo = new SupabasePledgeClassRepository(harness.client);

    const listed = await harness.expectTenantScoped(CHAPTER_B, () =>
      repo.findByChapter(CHAPTER_B),
    );

    expect(listed.map((c) => c.id)).toEqual(['b-first', 'b-second', 'b-third']);
  });

  it("findById misses another chapter's class", async () => {
    const found = await harness.expectTenantScoped(CHAPTER_B, () =>
      repo.findById(CLASS_A, CHAPTER_B),
    );

    expect(found).toBeNull();
  });

  it("rename leaves another chapter's class alone and reports it missing", async () => {
    const renamed = await harness.expectTenantScoped(CHAPTER_B, () =>
      repo.rename(CLASS_A, CHAPTER_B, 'Omega'),
    );

    expect(renamed).toBeUndefined();
    expect(
      harness.rows('chapter_pledge_classes').find((r) => r.id === CLASS_A)
        ?.name,
    ).toBe('Alpha');
  });

  it("delete leaves another chapter's class alone", async () => {
    await harness.expectTenantScoped(CHAPTER_B, () =>
      repo.delete(CLASS_A, CHAPTER_B),
    );

    expect(harness.rows('chapter_pledge_classes').map((r) => r.id)).toContain(
      CLASS_A,
    );
  });

  it('reorder passes the chapter to the RPC', async () => {
    harness = createTenantHarness({
      tables: seed(),
      rpc: { reorder_chapter_pledge_classes: { data: [{ id: CLASS_B }] } },
    });
    repo = new SupabasePledgeClassRepository(harness.client);

    await harness.expectTenantScoped(CHAPTER_B, () =>
      repo.reorder(CHAPTER_B, [CLASS_B]),
    );

    expect(harness.rpcCalls[0].args).toEqual({
      p_chapter_id: CHAPTER_B,
      p_ids: [CLASS_B],
    });
  });

  it('assignMembers passes the chapter and the assignments to the RPC', async () => {
    harness = createTenantHarness({
      tables: seed(),
      rpc: { assign_member_pledge_classes: { data: [{ id: MEMBER_B }] } },
    });
    repo = new SupabasePledgeClassRepository(harness.client);
    const assignments = [
      { member_id: MEMBER_B, pledge_class_id: CLASS_B, order_number: 4 },
    ];

    await harness.expectTenantScoped(CHAPTER_B, () =>
      repo.assignMembers(CHAPTER_B, assignments),
    );

    expect(harness.rpcCalls[0].args).toEqual({
      p_chapter_id: CHAPTER_B,
      p_assignments: assignments,
    });
  });
});

describe('SupabasePledgeClassRepository — a name the chapter already has', () => {
  const taken = { code: '23505', message: 'duplicate key value' };

  function repoAnswering(error: unknown) {
    const builder = {
      insert: jest.fn().mockReturnThis(),
      update: jest.fn().mockReturnThis(),
      eq: jest.fn().mockReturnThis(),
      select: jest.fn().mockReturnThis(),
      single: jest.fn().mockResolvedValue({ data: null, error }),
      maybeSingle: jest.fn().mockResolvedValue({ data: null, error }),
    };
    const client = { from: jest.fn().mockReturnValue(builder) };
    return new SupabasePledgeClassRepository(client as never);
  }

  it('create resolves null rather than throwing', async () => {
    await expect(
      repoAnswering(taken).create({ chapter_id: CHAPTER_A, name: 'Alpha' }),
    ).resolves.toBeNull();
  });

  it('rename resolves null rather than throwing', async () => {
    await expect(
      repoAnswering(taken).rename(CLASS_A, CHAPTER_A, 'Alpha'),
    ).resolves.toBeNull();
  });

  it('any other failure is thrown wrapped', async () => {
    await expect(
      repoAnswering({ code: '23514', message: 'check' }).create({
        chapter_id: CHAPTER_A,
        name: ' ',
      }),
    ).rejects.toMatchObject({ name: 'SupabaseQueryError', code: '23514' });
  });
});

describe('SupabasePledgeClassRepository — a write the database refuses whole', () => {
  function repoWhoseRpcFails(code: string) {
    const client = {
      rpc: jest
        .fn()
        .mockResolvedValue({ data: null, error: { code, message: 'refused' } }),
    };
    return new SupabasePledgeClassRepository(client as never);
  }
  const assignments = [
    { member_id: 'm1', pledge_class_id: null, order_number: 1 },
  ];

  it('reports a listed member who is not in the chapter', async () => {
    await expect(
      repoWhoseRpcFails('P0002').assignMembers(CHAPTER_A, assignments),
    ).resolves.toBe('member_not_found');
  });

  it("reports a class that is not one of the chapter's", async () => {
    await expect(
      repoWhoseRpcFails('23503').assignMembers(CHAPTER_A, assignments),
    ).resolves.toBe('class_not_found');
  });

  it('throws anything else wrapped', async () => {
    await expect(
      repoWhoseRpcFails('23514').assignMembers(CHAPTER_A, assignments),
    ).rejects.toMatchObject({ name: 'SupabaseQueryError', code: '23514' });
  });
});
