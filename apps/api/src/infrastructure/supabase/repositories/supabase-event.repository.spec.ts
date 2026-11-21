import { SupabaseEventRepository } from './supabase-event.repository';
import {
  CHAPTER_B,
  createTenantHarness,
  inA,
  inB,
  type TenantHarness,
} from '#test/helpers/tenant-scope.harness';

/**
 * Tenant scope for `events`. `events.chapter_id` is also the only thing that
 * scopes `event_attendance`, which carries no chapter of its own — so this
 * repository's filters are load-bearing for a table beyond its own.
 */

const EVENT_A = '0a000000-0000-4000-8000-000000000070';
const EVENT_B = '0b000000-0000-4000-8000-000000000070';
const OTHERS_A = '0a000000-0000-4000-8000-000000000071';
const OTHERS_B = '0b000000-0000-4000-8000-000000000071';
// A member of both chapters, who made one event in each.
const MAKER = '0c000000-0000-4000-8000-000000000070';
const SOMEONE_ELSE = '0c000000-0000-4000-8000-000000000071';

const seed = () => ({
  events: [
    inA({
      id: EVENT_A,
      name: 'Chapter meeting',
      description: null,
      location: 'House',
      start_time: '2026-09-01T18:00:00.000Z',
      end_time: '2026-09-01T19:00:00.000Z',
      point_value: 10,
      is_mandatory: true,
      required_role_ids: [],
      created_by: MAKER,
      created_at: '2026-01-01T00:00:00.000Z',
    }),
    inB({
      id: EVENT_B,
      name: 'Chapter meeting',
      description: null,
      location: 'House',
      start_time: '2026-09-01T18:00:00.000Z',
      end_time: '2026-09-01T19:00:00.000Z',
      point_value: 10,
      is_mandatory: true,
      required_role_ids: [],
      created_by: MAKER,
      created_at: '2026-01-01T00:00:00.000Z',
    }),
  ],
});

describe('SupabaseEventRepository — tenant scope', () => {
  let harness: TenantHarness;
  let repo: SupabaseEventRepository;

  beforeEach(() => {
    harness = createTenantHarness({ tables: seed() });
    repo = new SupabaseEventRepository(harness.client);
  });

  it('findByChapter returns only the caller chapter calendar', async () => {
    const events = await harness.expectTenantScoped(CHAPTER_B, () =>
      repo.findByChapter(CHAPTER_B),
    );

    expect(events.map((e) => e.id)).toEqual([EVENT_B]);
  });

  it('findByChapter keeps the chapter predicate alongside a time window', async () => {
    // Both chapters' events sit inside the window; only the chapter separates them.
    const inside = await harness.expectTenantScoped(CHAPTER_B, () =>
      repo.findByChapter(CHAPTER_B, {
        endsAfter: '2026-09-01T00:00:00.000Z',
        startsBefore: '2026-09-02T00:00:00.000Z',
      }),
    );
    // An event that ended before the window, or starts after it, is left out.
    const after = await repo.findByChapter(CHAPTER_B, {
      endsAfter: '2026-09-02T00:00:00.000Z',
      startsBefore: '2026-09-30T00:00:00.000Z',
    });
    const before = await repo.findByChapter(CHAPTER_B, {
      endsAfter: '2026-08-01T00:00:00.000Z',
      startsBefore: '2026-08-31T00:00:00.000Z',
    });

    expect(inside.map((e) => e.id)).toEqual([EVENT_B]);
    expect(after).toEqual([]);
    expect(before).toEqual([]);
  });

  it('findByIds returns only the ids that are in the caller chapter', async () => {
    const events = await harness.expectTenantScoped(CHAPTER_B, () =>
      repo.findByIds([EVENT_A, EVENT_B], CHAPTER_B),
    );

    expect(events.map((e) => e.id)).toEqual([EVENT_B]);
    expect(await repo.findByIds([], CHAPTER_B)).toEqual([]);
  });

  it('findCreatedBy returns only the maker’s events in the caller chapter, not ended by the cutoff', async () => {
    // The maker has an event in each chapter; only the chapter separates them,
    // and only the maker separates theirs from someone else's in chapter B.
    const base = seed();
    harness = createTenantHarness({
      tables: {
        events: [
          ...base.events,
          inB({
            id: OTHERS_B,
            name: 'Formal',
            description: null,
            location: 'Hotel',
            start_time: '2026-09-02T18:00:00.000Z',
            end_time: '2026-09-02T22:00:00.000Z',
            point_value: 10,
            is_mandatory: false,
            required_role_ids: [],
            created_by: SOMEONE_ELSE,
            created_at: '2026-01-01T00:00:00.000Z',
          }),
          inA({
            id: OTHERS_A,
            name: 'Formal',
            description: null,
            location: 'Hotel',
            start_time: '2026-09-02T18:00:00.000Z',
            end_time: '2026-09-02T22:00:00.000Z',
            point_value: 10,
            is_mandatory: false,
            required_role_ids: [],
            created_by: SOMEONE_ELSE,
            created_at: '2026-01-01T00:00:00.000Z',
          }),
        ],
      },
    });
    repo = new SupabaseEventRepository(harness.client);
    const mine = await harness.expectTenantScoped(CHAPTER_B, () =>
      repo.findCreatedBy(CHAPTER_B, MAKER, '2026-09-01T00:00:00.000Z', 200),
    );
    // Ended before the cutoff: left out.
    const later = await repo.findCreatedBy(
      CHAPTER_B,
      MAKER,
      '2026-09-01T20:00:00.000Z',
      200,
    );

    expect(mine.map((e) => e.id)).toEqual([EVENT_B]);
    expect(later).toEqual([]);
  });

  it('findById refuses an id belonging to another chapter', async () => {
    // `AttendanceService` treats a null here as "event not found" and is what
    // keeps every attendance read and write inside the chapter.
    const foreign = await harness.expectTenantScoped(CHAPTER_B, () =>
      repo.findById(EVENT_A, CHAPTER_B),
    );

    expect(foreign).toBeNull();
  });

  it('delete leaves another chapter event in place', async () => {
    await harness.expectTenantScoped(CHAPTER_B, () =>
      repo.delete(EVENT_A, CHAPTER_B),
    );

    expect(
      harness
        .rows('events')
        .map((e) => e.id)
        .sort(),
    ).toEqual([EVENT_A, EVENT_B].sort());
  });

  // A series' occurrences must land together or not at all (#3235): one
  // array insert, which PostgREST runs as a single INSERT statement.
  it('createMany sends every occurrence in one insert', async () => {
    const occurrence = (n: number) =>
      inB({
        id: `0b000000-0000-4000-8000-00000000007${n}`,
        name: 'Chapter meeting',
        start_time: `2026-09-0${n + 1}T18:00:00.000Z`,
        end_time: `2026-09-0${n + 1}T19:00:00.000Z`,
        parent_event_id: EVENT_B,
      });

    const created = await repo.createMany([occurrence(1), occurrence(2)]);

    const inserts = harness.ops.filter((op) => op.mode === 'insert');
    expect(inserts).toHaveLength(1);
    expect(inserts[0].payload).toHaveLength(2);
    expect(created.map((e) => e.id)).toEqual([
      '0b000000-0000-4000-8000-000000000071',
      '0b000000-0000-4000-8000-000000000072',
    ]);
  });

  it('createMany writes nothing for an empty list', async () => {
    await expect(repo.createMany([])).resolves.toEqual([]);

    expect(harness.ops).toEqual([]);
  });

  // The carry and the delete are one RPC, so they commit together (#4620).
  it('deleteReplacedOccurrences passes the chapter and the pairs to the RPC', async () => {
    const dropped = await repo.deleteReplacedOccurrences([EVENT_B], CHAPTER_B, [
      { from: EVENT_B, to: EVENT_A },
    ]);

    expect(harness.rpcCalls).toHaveLength(1);
    expect(harness.rpcCalls[0].args).toEqual({
      p_chapter_id: CHAPTER_B,
      p_old_ids: [EVENT_B],
      p_from_ids: [EVENT_B],
      p_to_ids: [EVENT_A],
    });
    expect(dropped).toEqual([]);
  });

  it('deleteReplacedOccurrences calls nothing for an empty list', async () => {
    await expect(
      repo.deleteReplacedOccurrences([], CHAPTER_B, []),
    ).resolves.toEqual([]);

    expect(harness.rpcCalls).toEqual([]);
  });
});
