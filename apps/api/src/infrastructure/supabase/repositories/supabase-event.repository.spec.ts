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
});
