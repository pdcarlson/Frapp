// One check-in per member per event occurrence, against the real database
// (#3703: "make sure a member can't check into the same event twice to farm
// points").
//
// The unit suite proves `AttendanceService` maps a second check-in to 409,
// but it does so against a mocked `checkInAtomic`. What only a real database
// can answer is whether the guard the service relies on exists at all: the
// `unique (event_id, user_id)` constraint on `event_attendance` and the
// `on conflict do nothing` inside `check_in_event` that keeps a second call
// from writing a second ledger row. If either went missing, every unit test
// would stay green and a member scanning twice would be paid twice.
//
// A recurring series' occurrences are separate `events` rows, so the pair is
// per occurrence: the last case checks a member can still check in to the
// next week's meeting.
//
// Run: `npm run test:integration -w apps/api` (needs a local Supabase stack;
// skips cleanly without one). Not run by CI today (#1568); the PGlite tier
// `scripts/pglite/tiers/check-in-once.mjs` is the CI-run proof of the same
// guard, everything here but the concurrent race.

import { randomUUID } from 'node:crypto';
import { SupabaseAttendanceRepository } from '../../src/infrastructure/supabase/repositories/supabase-attendance.repository';
import type { FrappSupabaseClient } from '../../src/infrastructure/supabase/database.types';
import { createServiceRoleClient, describeIntegration } from './stack';

describeIntegration('Event check-in happens once per member', () => {
  let supabase: FrappSupabaseClient;
  let repo: SupabaseAttendanceRepository;

  const chapterId = randomUUID();
  const userId = randomUUID();
  const eventId = randomUUID();
  const nextOccurrenceId = randomUUID();

  const assertOk = (label: string, error: { message: string } | null) => {
    if (error) throw new Error(`seed ${label}: ${error.message}`);
  };

  beforeAll(async () => {
    supabase = createServiceRoleClient();
    repo = new SupabaseAttendanceRepository(supabase);

    assertOk(
      'chapters',
      (
        await supabase.from('chapters').insert({
          id: chapterId,
          name: `checkin-once-${chapterId.slice(0, 8)}`,
          university: 'Integration Test University',
        } as never)
      ).error,
    );
    assertOk(
      'users',
      (
        await supabase.from('users').insert({
          id: userId,
          supabase_auth_id: randomUUID(),
          email: `checkin-${userId}@example.test`,
          display_name: 'Check In',
        } as never)
      ).error,
    );
    const start = new Date();
    const end = new Date(start.getTime() + 60 * 60 * 1000);
    const week = 7 * 24 * 60 * 60 * 1000;
    assertOk(
      'events',
      (
        await supabase.from('events').insert([
          {
            id: eventId,
            chapter_id: chapterId,
            name: 'Chapter',
            start_time: start.toISOString(),
            end_time: end.toISOString(),
            point_value: 10,
          },
          {
            id: nextOccurrenceId,
            chapter_id: chapterId,
            name: 'Chapter',
            start_time: new Date(start.getTime() + week).toISOString(),
            end_time: new Date(end.getTime() + week).toISOString(),
            point_value: 10,
            parent_event_id: eventId,
          },
        ] as never)
      ).error,
    );
  });

  afterAll(async () => {
    if (!supabase) return;
    await supabase.from('point_transactions').delete().eq('user_id', userId);
    await supabase
      .from('event_attendance')
      .delete()
      .in('event_id', [eventId, nextOccurrenceId]);
    await supabase
      .from('events')
      .delete()
      .in('id', [nextOccurrenceId, eventId]);
    await supabase.from('users').delete().eq('id', userId);
    await supabase.from('chapters').delete().eq('id', chapterId);
  });

  const checkIn = (id: string) =>
    repo.checkInAtomic(
      id,
      userId,
      chapterId,
      new Date().toISOString(),
      10,
      'Chapter',
    );

  async function ledgerFor(id: string): Promise<number> {
    const { data, error } = await supabase
      .from('point_transactions')
      .select('amount, metadata')
      .eq('user_id', userId)
      .eq('category', 'ATTENDANCE');
    assertOk('ledger read', error);
    return (
      (data ?? []) as { metadata: { event_id?: string } | null }[]
    ).filter((row) => row.metadata?.event_id === id).length;
  }

  it('writes one row and one award, and a second check-in writes neither', async () => {
    expect(await checkIn(eventId)).not.toBeNull();
    // What the service turns into the 409.
    expect(await checkIn(eventId)).toBeNull();

    const { data, error } = await supabase
      .from('event_attendance')
      .select('id')
      .eq('event_id', eventId)
      .eq('user_id', userId);
    assertOk('attendance read', error);
    expect(data).toHaveLength(1);
    expect(await ledgerFor(eventId)).toBe(1);
  });

  it('pays once when two check-ins race', async () => {
    const results = await Promise.all([
      checkIn(nextOccurrenceId),
      checkIn(nextOccurrenceId),
    ]);
    expect(results.filter((row) => row !== null)).toHaveLength(1);
    expect(await ledgerFor(nextOccurrenceId)).toBe(1);
  });

  it('refuses a duplicate row even written past the RPC', async () => {
    // Its own original row, so the case stands alone (`-t`) rather than
    // leaning on the first test: without one, the insert below would succeed
    // and read as a missing constraint. A no-op when the row exists.
    await checkIn(eventId);
    const { error } = await supabase.from('event_attendance').insert({
      event_id: eventId,
      user_id: userId,
      status: 'PRESENT',
    } as never);
    // 23505: unique_violation.
    expect(error?.code).toBe('23505');
  });
});
