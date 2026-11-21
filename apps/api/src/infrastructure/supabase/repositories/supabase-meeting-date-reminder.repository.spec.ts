import { SupabaseMeetingDateReminderRepository } from './supabase-meeting-date-reminder.repository';
import {
  CHAPTER_A,
  USER_SHARED,
  USER_A,
  createTenantHarness,
  inA,
  inB,
  type TenantHarness,
} from '#test/helpers/tenant-scope.harness';

/**
 * Tenant scope for `meeting_date_reminders` (#5672 step 2), shaped like the
 * chat reminders' spec: the table has its own `chapter_id`, and `user_id`,
 * the privacy guarantee, which the harness doesn't know about. Both are
 * asserted on the member-facing reads. The sweep's `claimDue` walks every
 * chapter by design; what it deletes is pinned below.
 */

const MEETING_A = '0a000000-0000-4000-8000-000000000360';
const MEETING_B = '0b000000-0000-4000-8000-000000000360';
const REMINDER_A = '0a000000-0000-4000-8000-000000000370';
const REMINDER_B = '0b000000-0000-4000-8000-000000000370';
const REMINDER_A_OTHER_USER = '0a000000-0000-4000-8000-000000000372';
const REMINDER_B_OTHER_USER = '0b000000-0000-4000-8000-000000000372';

const row = (id: string, userId: string, meetingId: string) => ({
  id,
  user_id: userId,
  meeting_id: meetingId,
  day: '2026-12-04',
  text: 'Winter formal',
  remind_at: '2026-12-03T23:00:00.000Z',
  created_at: '2026-11-20T00:00:00.000Z',
  updated_at: '2026-11-20T00:00:00.000Z',
});

describe('SupabaseMeetingDateReminderRepository — tenant scope', () => {
  let harness: TenantHarness;
  let repo: SupabaseMeetingDateReminderRepository;

  beforeEach(() => {
    harness = createTenantHarness({
      tables: {
        meeting_date_reminders: [
          inA(row(REMINDER_A, USER_SHARED, MEETING_A)),
          inB(row(REMINDER_B, USER_SHARED, MEETING_B)),
          inA(row(REMINDER_A_OTHER_USER, USER_A, MEETING_A)),
          inB(row(REMINDER_B_OTHER_USER, USER_A, MEETING_B)),
        ],
      },
      collisionExempt: {
        meeting_date_reminders: [
          'user_id',
          'meeting_id',
          'day',
          'text',
          'remind_at',
        ],
      },
    });
    repo = new SupabaseMeetingDateReminderRepository(harness.client);
  });

  it('lists only the caller’s own reminders on these minutes, in this chapter', async () => {
    const rows = await harness.expectTenantScoped(CHAPTER_A, () =>
      repo.findByUserAndMeeting(USER_SHARED, CHAPTER_A, MEETING_A),
    );
    expect(rows.map((r) => r.id)).toEqual([REMINDER_A]);
  });

  it('cancels only the caller’s own reminder in this chapter', async () => {
    await harness.expectTenantScoped(CHAPTER_A, () =>
      repo.delete(USER_A, CHAPTER_A, MEETING_A, REMINDER_A),
    );
    expect(harness.rows('meeting_date_reminders')).toHaveLength(4);
    await repo.delete(USER_SHARED, CHAPTER_A, MEETING_A, REMINDER_A);
    expect(
      harness
        .rows('meeting_date_reminders')
        .map((r) => r.id)
        .sort(),
    ).toEqual(
      [REMINDER_B, REMINDER_A_OTHER_USER, REMINDER_B_OTHER_USER].sort(),
    );
  });

  it('claims a due reminder by deleting it, but not one moved since the read', async () => {
    await expect(
      repo.claimDue({ id: REMINDER_A, remind_at: '2026-12-03T22:00:00.000Z' }),
    ).resolves.toBe(false);
    await expect(
      repo.claimDue({ id: REMINDER_A, remind_at: '2026-12-03T23:00:00.000Z' }),
    ).resolves.toBe(true);
    expect(
      harness.rows('meeting_date_reminders').map((r) => r.id),
    ).not.toContain(REMINDER_A);
  });
});
