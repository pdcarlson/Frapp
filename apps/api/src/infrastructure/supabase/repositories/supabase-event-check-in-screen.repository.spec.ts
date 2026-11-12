import { SupabaseEventCheckInScreenRepository } from './supabase-event-check-in-screen.repository';
import {
  CHAPTER_A,
  CHAPTER_B,
  createTenantHarness,
  inA,
  inB,
  type TenantHarness,
} from '#test/helpers/tenant-scope.harness';

/**
 * Tenant scope for `event_check_in_screens` (#4532): where an event's check-in
 * QR screen is.
 *
 * The row is keyed by `event_id`, and `AttendanceService` has already checked
 * the event belongs to the caller's chapter (`eventRepo.findById(eventId,
 * chapterId)`) before any call here. The read still filters on the chapter, so
 * a location never answers for another chapter's check-in even if that check
 * were lost. The twins below share their `event_id`, which a real table can't
 * (it is the primary key), so the chapter filter is the only thing that can
 * tell them apart.
 *
 * The retention sweep deletes across every chapter on purpose: it runs from a
 * cron with no caller, and the rows it removes are expired everywhere.
 */

const EVENT_SHARED = '0c000000-0000-4000-8000-000000000150';
const EVENT_NEW = '0b000000-0000-4000-8000-000000000151';

const screenRow = (expires_at: string) => ({
  event_id: EVENT_SHARED,
  lat: 42.7298,
  lng: -73.678,
  accuracy_m: 10,
  located_at: '2026-09-01T18:05:00.000Z',
  shown_at: '2026-09-01T18:05:00.000Z',
  expires_at,
});

describe('SupabaseEventCheckInScreenRepository — tenant scope', () => {
  let harness: TenantHarness;
  let repo: SupabaseEventCheckInScreenRepository;

  beforeEach(() => {
    harness = createTenantHarness({
      tables: {
        // `id` is the harness's own row handle for its before/after
        // snapshots; the real table has none (its key is `event_id`).
        event_check_in_screens: [
          inA({ id: 'screen-a', ...screenRow('2026-09-01T19:15:00.000Z') }),
          inB({ id: 'screen-b', ...screenRow('2026-09-01T19:15:00.000Z') }),
        ],
      },
    });
    repo = new SupabaseEventCheckInScreenRepository(harness.client);
  });

  it('findLive reads only the caller chapter row, and only while it is live', async () => {
    const live = await harness.expectTenantScoped(CHAPTER_B, () =>
      repo.findLive(EVENT_SHARED, CHAPTER_B, '2026-09-01T18:30:00.000Z'),
    );
    expect(live?.chapter_id).toBe(CHAPTER_B);

    await expect(
      repo.findLive(EVENT_SHARED, CHAPTER_B, '2026-09-01T19:15:00.000Z'),
    ).resolves.toBeNull();
  });

  it('recordShown writes the caller chapter on the row', async () => {
    const row = await harness.expectTenantScoped(CHAPTER_B, () =>
      repo.recordShown({
        eventId: EVENT_NEW,
        chapterId: CHAPTER_B,
        nowIso: '2026-09-01T18:30:00.000Z',
        expiresAt: '2026-09-01T19:15:00.000Z',
        location: { lat: 42.73, lng: -73.68, accuracy_m: 12 },
      }),
    );
    expect(row).toMatchObject({
      event_id: EVENT_NEW,
      chapter_id: CHAPTER_B,
      lat: 42.73,
      located_at: '2026-09-01T18:30:00.000Z',
    });
  });

  it('recordShown with no location writes no location columns, so another screen keeps its own', async () => {
    await repo.recordShown({
      eventId: EVENT_NEW,
      chapterId: CHAPTER_A,
      nowIso: '2026-09-01T18:30:00.000Z',
      expiresAt: '2026-09-01T19:15:00.000Z',
      location: null,
    });

    const [op] = harness.ops;
    expect(op.mode).toBe('upsert');
    expect(Object.keys(op.payload[0]).sort()).toEqual([
      'chapter_id',
      'event_id',
      'expires_at',
      'shown_at',
    ]);
  });

  it('deleteExpired removes closed rows in every chapter, and nothing live', async () => {
    await expect(repo.deleteExpired('2026-09-01T18:30:00.000Z')).resolves.toBe(
      0,
    );
    await expect(repo.deleteExpired('2026-09-01T19:15:00.000Z')).resolves.toBe(
      2,
    );
  });
});
