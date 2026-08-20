import { SupabaseAttendanceRepository } from './supabase-attendance.repository';
import {
  CHAPTER_B,
  USER_SHARED,
  createTenantHarness,
  inA,
  inB,
  type TenantHarness,
} from '../../../../test/helpers/tenant-scope.harness';

/**
 * Tenant scope for `event_attendance`.
 *
 * This table has no `chapter_id`; an attendance row's chapter is its parent
 * event's. `AttendanceService` establishes that parent with
 * `eventRepo.findById(eventId, chapterId)` on every entry point, and the routes
 * only ever accept an `:eventId`, never an attendance row id.
 *
 * So the two things worth pinning here are: the RPC that *does* take a chapter
 * carries it, and the event-scoped reads really are narrowed by `event_id` —
 * because if they were not, the upstream event check would be scoping nothing.
 */

const EVENT_A = '0a000000-0000-4000-8000-000000000140';
const EVENT_B = '0b000000-0000-4000-8000-000000000140';
const ATTEND_A = '0a000000-0000-4000-8000-000000000141';
const ATTEND_B = '0b000000-0000-4000-8000-000000000141';

const seed = () => ({
  events: [
    inA({
      id: EVENT_A,
      name: 'Chapter meeting',
      start_time: '2026-09-01T18:00:00.000Z',
      end_time: '2026-09-01T19:00:00.000Z',
      point_value: 10,
      is_mandatory: true,
    }),
    inB({
      id: EVENT_B,
      name: 'Chapter meeting',
      start_time: '2026-09-01T18:00:00.000Z',
      end_time: '2026-09-01T19:00:00.000Z',
      point_value: 10,
      is_mandatory: true,
    }),
  ],
  event_attendance: [
    {
      id: ATTEND_A,
      event_id: EVENT_A,
      user_id: USER_SHARED,
      status: 'PRESENT',
      check_in_time: '2026-09-01T18:05:00.000Z',
      excuse_reason: null,
      marked_by: null,
    },
    {
      id: ATTEND_B,
      event_id: EVENT_B,
      user_id: USER_SHARED,
      status: 'PRESENT',
      check_in_time: '2026-09-01T18:05:00.000Z',
      excuse_reason: null,
      marked_by: null,
    },
  ],
});

describe('SupabaseAttendanceRepository — tenant scope', () => {
  let harness: TenantHarness;
  let repo: SupabaseAttendanceRepository;

  beforeEach(() => {
    harness = createTenantHarness({
      tables: seed(),
      untenantedTables: ['event_attendance'],
      rpc: { check_in_event: { data: [{ id: ATTEND_B }] } },
    });
    repo = new SupabaseAttendanceRepository(harness.client);
  });

  it('checkInAtomic passes the chapter to the RPC', async () => {
    // The check-in awards points inside SQL. `p_chapter_id` is what puts the
    // ledger row in the right chapter, and it is the only chapter reference on
    // this path.
    await harness.expectTenantScoped(CHAPTER_B, () =>
      repo.checkInAtomic(
        EVENT_B,
        USER_SHARED,
        CHAPTER_B,
        '2026-09-01T18:05:00.000Z',
        10,
        'Chapter meeting',
      ),
    );

    expect(harness.rpcCalls[0].args).toMatchObject({
      p_event_id: EVENT_B,
      p_chapter_id: CHAPTER_B,
    });
  });

  it('findByEvent narrows to the parent event, which is what carries the chapter', async () => {
    const rows = await repo.findByEvent(EVENT_B);

    expect(rows.map((r) => r.id)).toEqual([ATTEND_B]);
  });

  it('findByEventAndUser does not match the same member at the other chapter event', async () => {
    // Same user, same status, same check-in time in both chapters — only
    // `event_id` separates them.
    const row = await repo.findByEventAndUser(EVENT_B, USER_SHARED);

    expect(row?.id).toBe(ATTEND_B);
  });

  it('update filters on the attendance row id alone', async () => {
    // Characterisation: no chapter and no event predicate. Safe today because
    // `AttendanceService.updateStatus` derives the id from
    // `findByEventAndUser(eventId, userId)` after `eventRepo.findById(eventId,
    // chapterId)` has already rejected a foreign event — never from a route
    // parameter.
    await repo.update(ATTEND_B, { status: 'EXCUSED' });

    const [op] = harness.ops;
    expect(op.filters.map((f) => f.column)).toEqual(['id']);
  });
});
