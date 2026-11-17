// An event's pre-start reminder re-arms when its start time moves (#1550),
// against the live trigger the unit specs can't see. The claim is the one the
// sweep really takes (`claimDispatch`), and the event moves through the same
// repository calls `EventService.update` and the series edits make.
//
// Claims are written the same way by the API before and after #1550, so these
// cases also stand for the deploy gap (migration applied, old API still
// claiming) and an API-only rollback: the trigger is the whole fix, and it
// needs nothing from the API.
//
// Run: `npm run test:integration -w apps/api` (needs a local Supabase stack;
// skips cleanly without one). Not run by CI, like its siblings (#1568).

import { randomUUID } from 'node:crypto';
import { SupabaseEventRepository } from '../../src/infrastructure/supabase/repositories/supabase-event.repository';
import { SupabaseScheduledJobsRepository } from '../../src/infrastructure/supabase/repositories/supabase-scheduled-jobs.repository';
import type { FrappSupabaseClient } from '../../src/infrastructure/supabase/database.types';
import { createServiceRoleClient, describeIntegration } from './stack';

describeIntegration('Event reminder re-arm on reschedule (#1550)', () => {
  let supabase: FrappSupabaseClient;
  let events: SupabaseEventRepository;
  let claims: SupabaseScheduledJobsRepository;

  const chapterId = randomUUID();
  const eventId = randomUUID();
  const siblingId = randomUUID();
  const DAY = '2030-09-03';
  const at = (hhmm: string, day = DAY) => `${day}T${hhmm}:00.000Z`;

  const assertOk = (label: string, error: { message: string } | null) => {
    if (error) throw new Error(`seed ${label}: ${error.message}`);
  };

  /** The sweep's claim: keyed on the UTC date of start_time. */
  const claimReminder = (id: string, day = DAY) =>
    claims.claimDispatch(chapterId, 'EVENT', id, 'EVENT_REMINDER', day);

  const claimRows = async (id: string) => {
    const { data, error } = await supabase
      .from('scheduled_notification_dispatches')
      .select('threshold, due_date')
      .eq('entity_id', id);
    assertOk('read claims', error);
    return data ?? [];
  };

  beforeAll(async () => {
    supabase = createServiceRoleClient();
    events = new SupabaseEventRepository(supabase);
    claims = new SupabaseScheduledJobsRepository(supabase);
    assertOk(
      'chapters',
      (
        await supabase.from('chapters').insert({
          id: chapterId,
          name: `rearm-${chapterId.slice(0, 8)}`,
          university: 'Integration Test University',
        } as never)
      ).error,
    );
    assertOk(
      'events',
      (
        await supabase.from('events').insert(
          [eventId, siblingId].map((id) => ({
            id,
            chapter_id: chapterId,
            name: 'Chapter meeting',
            start_time: at('14:00'),
            end_time: at('15:00'),
            point_value: 10,
            is_mandatory: true,
          })) as never,
        )
      ).error,
    );
  });

  beforeEach(async () => {
    await supabase
      .from('scheduled_notification_dispatches')
      .delete()
      .eq('chapter_id', chapterId);
    await events.updateMany([eventId, siblingId], chapterId, {
      start_time: at('14:00'),
      end_time: at('15:00'),
    });
  });

  afterAll(async () => {
    if (!supabase) return;
    await supabase
      .from('scheduled_notification_dispatches')
      .delete()
      .eq('chapter_id', chapterId);
    await supabase.from('events').delete().eq('chapter_id', chapterId);
    await supabase.from('chapters').delete().eq('id', chapterId);
  });

  it('dedups the reminder while the time stands still', async () => {
    expect(await claimReminder(eventId)).toBe(true);
    expect(await claimReminder(eventId)).toBe(false);
  });

  it('re-arms a reschedule later the same day (the reported bug)', async () => {
    expect(await claimReminder(eventId)).toBe(true);

    await events.update(eventId, chapterId, {
      start_time: at('20:00'),
      end_time: at('21:00'),
    });

    expect(await claimReminder(eventId)).toBe(true);
  });

  it('re-arms a reschedule earlier the same day', async () => {
    expect(await claimReminder(eventId)).toBe(true);

    await events.update(eventId, chapterId, { start_time: at('13:50') });

    expect(await claimReminder(eventId)).toBe(true);
  });

  it('drops the old day’s claim when the event moves to another day', async () => {
    expect(await claimReminder(eventId)).toBe(true);

    await events.update(eventId, chapterId, {
      start_time: at('14:00', '2030-09-04'),
      end_time: at('15:00', '2030-09-04'),
    });

    expect(await claimRows(eventId)).toEqual([]);
    expect(await claimReminder(eventId, '2030-09-04')).toBe(true);
  });

  it('keeps the claim when an edit leaves start_time as it was', async () => {
    expect(await claimReminder(eventId)).toBe(true);

    // A name edit, and a save that writes the same instant back: neither may
    // re-send "starts in N minutes".
    await events.update(eventId, chapterId, { name: 'Chapter meeting (B)' });
    await events.update(eventId, chapterId, { start_time: at('14:00') });

    expect(await claimReminder(eventId)).toBe(false);
  });

  it('releases only the reminder claim of the moved event', async () => {
    expect(await claimReminder(eventId)).toBe(true);
    expect(await claimReminder(siblingId)).toBe(true);
    expect(
      await claims.claimDispatch(
        chapterId,
        'EVENT',
        eventId,
        'AUTO_ABSENT',
        DAY,
      ),
    ).toBe(true);

    await events.update(eventId, chapterId, { start_time: at('20:00') });

    expect(await claimRows(eventId)).toEqual([
      { threshold: 'AUTO_ABSENT', due_date: DAY },
    ]);
    expect(await claimReminder(siblingId)).toBe(false);
  });

  it('re-arms every occurrence a series edit moves in one write', async () => {
    expect(await claimReminder(eventId)).toBe(true);
    expect(await claimReminder(siblingId)).toBe(true);

    await events.updateMany([eventId, siblingId], chapterId, {
      start_time: at('19:00'),
    });

    expect(await claimReminder(eventId)).toBe(true);
    expect(await claimReminder(siblingId)).toBe(true);
  });
});
