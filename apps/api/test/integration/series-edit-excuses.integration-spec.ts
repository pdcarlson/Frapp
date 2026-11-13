// A series edit carries its excuses over (#4620), against the real database.
//
// The unit suite pins which old occurrence pairs with which rebuilt one; only
// the database can show what `delete_replaced_occurrences` does with the
// pairs: each excuse, and an approved one's EXCUSED attendance row, moves to
// the new meeting; the excuses no pair took are returned and deleted with
// their rows; and a bad pair changes nothing at all.
//
// Run: `npm run test:integration -w apps/api` (needs a local Supabase stack;
// skips cleanly without one). Not run by CI today (#1568).

import { randomUUID } from 'node:crypto';
import { SupabaseEventRepository } from '../../src/infrastructure/supabase/repositories/supabase-event.repository';
import { SupabaseEventExcuseRepository } from '../../src/infrastructure/supabase/repositories/supabase-event-excuse.repository';
import type { FrappSupabaseClient } from '../../src/infrastructure/supabase/database.types';
import { createServiceRoleClient, describeIntegration } from './stack';

describeIntegration(
  'A series edit carries excuses to the rebuilt meetings',
  () => {
    let supabase: FrappSupabaseClient;
    let events: SupabaseEventRepository;
    let excuses: SupabaseEventExcuseRepository;

    const chapterId = randomUUID();
    const otherChapterId = randomUUID();
    const officerId = randomUUID();
    const [pendingId, approvedId, declinedId, strandedId, strandedApprovedId] =
      [randomUUID(), randomUUID(), randomUUID(), randomUUID(), randomUUID()];
    const userIds = [
      officerId,
      pendingId,
      approvedId,
      declinedId,
      strandedId,
      strandedApprovedId,
    ];
    const [oldKept, oldGone, rebuilt, otherChapterEvent] = [
      randomUUID(),
      randomUUID(),
      randomUUID(),
      randomUUID(),
    ];
    const eventIds = [oldKept, oldGone, rebuilt, otherChapterEvent];

    const assertOk = (label: string, error: { message: string } | null) => {
      if (error) throw new Error(`seed ${label}: ${error.message}`);
    };

    const meeting = (id: string, chapter: string, daysAhead: number) => {
      const start = new Date(Date.now() + daysAhead * 24 * 60 * 60 * 1000);
      return {
        id,
        chapter_id: chapter,
        name: 'Chapter meeting',
        start_time: start.toISOString(),
        end_time: new Date(start.getTime() + 60 * 60 * 1000).toISOString(),
        point_value: 10,
        is_mandatory: true,
      };
    };

    beforeAll(async () => {
      supabase = createServiceRoleClient();
      events = new SupabaseEventRepository(supabase);
      excuses = new SupabaseEventExcuseRepository(supabase);

      assertOk(
        'chapters',
        (
          await supabase.from('chapters').insert(
            [chapterId, otherChapterId].map((id) => ({
              id,
              name: `series-excuses-${id.slice(0, 8)}`,
              university: 'Integration Test University',
            })) as never,
          )
        ).error,
      );
      assertOk(
        'users',
        (
          await supabase.from('users').insert(
            userIds.map((id) => ({
              id,
              supabase_auth_id: randomUUID(),
              email: `series-excuse-${id}@example.test`,
              display_name: 'Series Excuse Test',
            })) as never,
          )
        ).error,
      );
      assertOk(
        'events',
        (
          await supabase
            .from('events')
            .insert([
              meeting(oldKept, chapterId, 7),
              meeting(oldGone, chapterId, 14),
              meeting(rebuilt, chapterId, 7),
              meeting(otherChapterEvent, otherChapterId, 7),
            ] as never)
        ).error,
      );

      for (const [eventId, userId] of [
        [oldKept, pendingId],
        [oldKept, approvedId],
        [oldKept, declinedId],
        [oldGone, strandedId],
        [oldGone, strandedApprovedId],
      ]) {
        const created = await excuses.create({
          chapter_id: chapterId,
          event_id: eventId,
          user_id: userId,
          reason: 'Away game',
        });
        if (!created) throw new Error('seed excuse: create returned null');
        if (userId === approvedId || userId === strandedApprovedId) {
          await excuses.decideAtomic(
            created.id,
            chapterId,
            'APPROVED',
            officerId,
            false,
          );
        }
        if (userId === declinedId) {
          await excuses.decideAtomic(
            created.id,
            chapterId,
            'DECLINED',
            officerId,
            false,
          );
        }
      }
    });

    afterAll(async () => {
      if (!supabase) return;
      await supabase.from('event_excuses').delete().in('event_id', eventIds);
      await supabase.from('event_attendance').delete().in('event_id', eventIds);
      await supabase.from('events').delete().in('id', eventIds);
      await supabase.from('users').delete().in('id', userIds);
      await supabase
        .from('chapters')
        .delete()
        .in('id', [chapterId, otherChapterId]);
    });

    const excusesOn = async (eventId: string) =>
      (await excuses.findByEvent(chapterId, eventId))
        .map((row) => `${row.user_id}:${row.status}`)
        .sort();

    it('refuses a pair into another chapter and changes nothing', async () => {
      await expect(
        events.deleteReplacedOccurrences([oldKept, oldGone], chapterId, [
          { from: oldKept, to: otherChapterEvent },
        ]),
      ).rejects.toThrow();

      expect(await excusesOn(oldKept)).toHaveLength(3);
      expect(await excusesOn(oldGone)).toHaveLength(2);
      const { data } = await supabase
        .from('events')
        .select('id')
        .in('id', [oldKept, oldGone]);
      expect(data).toHaveLength(2);
    });

    it('moves the paired excuses and EXCUSED row, returns the rest, deletes the old rows', async () => {
      const dropped = await events.deleteReplacedOccurrences(
        [oldKept, oldGone],
        chapterId,
        [{ from: oldKept, to: rebuilt }],
      );

      expect(
        dropped.map((row) => `${row.user_id}:${row.status}`).sort(),
      ).toEqual(
        [`${strandedId}:PENDING`, `${strandedApprovedId}:APPROVED`].sort(),
      );
      expect(await excusesOn(rebuilt)).toEqual(
        [
          `${pendingId}:PENDING`,
          `${approvedId}:APPROVED`,
          `${declinedId}:DECLINED`,
        ].sort(),
      );

      const { data: attendance } = await supabase
        .from('event_attendance')
        .select('event_id, user_id, status, marked_by')
        .in('event_id', [oldKept, oldGone, rebuilt]);
      expect(attendance).toEqual([
        {
          event_id: rebuilt,
          user_id: approvedId,
          status: 'EXCUSED',
          marked_by: officerId,
        },
      ]);

      const { data: left } = await supabase
        .from('events')
        .select('id')
        .in('id', [oldKept, oldGone]);
      expect(left).toEqual([]);
      expect(await excusesOn(oldGone)).toEqual([]);
    });
  },
);
