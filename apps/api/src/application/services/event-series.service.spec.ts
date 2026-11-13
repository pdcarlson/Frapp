import { BadRequestException, Logger } from '@nestjs/common';
import * as Sentry from '@sentry/nestjs';
import { Event } from '#domain/entities/event.entity';
import {
  baseEvent,
  createEventServiceFixture,
  occurrenceRows,
  type EventServiceFixture,
} from '#test/helpers/event-service.fixture';

// Moved out of `event.service.spec.ts` with the methods (#3270). Cases drive
// `EventService.create` / `update` / `delete`, which delegate here.

jest.mock('@sentry/nestjs', () => ({
  captureException: jest.fn(() => 'event-exception'),
  captureMessage: jest.fn(() => 'event-message'),
}));

const captureException = jest.mocked(Sentry.captureException);

/** The Sentry report a swallowed failure sends, by its `caught_at` site. */
const reportedAt = (site: string, level: 'error' | 'warning') =>
  expect(captureException).toHaveBeenCalledWith(
    expect.anything(),
    expect.objectContaining({ level, tags: { caught_at: site } }),
  );

/** The maker of these series, an `events:update` holder (#3709). */
const OFFICER = 'user-officer';

describe('EventSeriesService', () => {
  let service: EventServiceFixture['service'];
  let mockEventRepo: EventServiceFixture['mockEventRepo'];
  let mockNotificationService: EventServiceFixture['mockNotificationService'];
  let mockMemberRepo: EventServiceFixture['mockMemberRepo'];

  beforeEach(async () => {
    captureException.mockClear();
    let mockRbacService: EventServiceFixture['mockRbacService'];
    ({
      service,
      mockEventRepo,
      mockNotificationService,
      mockMemberRepo,
      mockRbacService,
    } = await createEventServiceFixture());
    // An officer makes these series: making anyone required takes
    // `events:update` (#3709).
    mockRbacService.memberHasAnyPermission.mockResolvedValue(true);
  });

  // ── Recurring Instance Generation ───────────────────────────────────

  describe('recurring instances', () => {
    it('should generate 12 instances for WEEKLY recurrence', async () => {
      const weeklyEvent: Event = {
        ...baseEvent,
        recurrence_rule: 'WEEKLY',
      };
      mockEventRepo.create.mockResolvedValue(weeklyEvent);

      await service.create({
        created_by: OFFICER,
        chapter_id: 'ch-1',
        name: 'Chapter Meeting',
        start_time: baseEvent.start_time,
        end_time: baseEvent.end_time,
        recurrence_rule: 'WEEKLY',
      });

      // The parent, then all 12 occurrences in one insert.
      expect(mockEventRepo.create).toHaveBeenCalledTimes(1);
      expect(mockEventRepo.createMany).toHaveBeenCalledTimes(1);
      expect(occurrenceRows(mockEventRepo)).toHaveLength(12);

      // Verify first instance has correct parent_event_id and null recurrence_rule
      const firstOccurrence = occurrenceRows(mockEventRepo)[0];
      expect(firstOccurrence.parent_event_id).toBe('evt-1');
      expect(firstOccurrence.recurrence_rule).toBeNull();

      // Verify start_time is 7 days after parent for the first instance
      const parentStart = new Date(baseEvent.start_time);
      const expectedStart = new Date(parentStart);
      expectedStart.setDate(expectedStart.getDate() + 7);
      expect(firstOccurrence.start_time).toBe(expectedStart.toISOString());
    });

    it('should generate 6 instances for BIWEEKLY recurrence', async () => {
      const biweeklyEvent: Event = {
        ...baseEvent,
        recurrence_rule: 'BIWEEKLY',
      };
      mockEventRepo.create.mockResolvedValue(biweeklyEvent);

      await service.create({
        created_by: OFFICER,
        chapter_id: 'ch-1',
        name: 'Chapter Meeting',
        start_time: baseEvent.start_time,
        end_time: baseEvent.end_time,
        recurrence_rule: 'BIWEEKLY',
      });

      // The parent, then all 6 occurrences in one insert.
      expect(mockEventRepo.create).toHaveBeenCalledTimes(1);
      expect(mockEventRepo.createMany).toHaveBeenCalledTimes(1);
      expect(occurrenceRows(mockEventRepo)).toHaveLength(6);

      const firstOccurrence = occurrenceRows(mockEventRepo)[0];
      expect(firstOccurrence.parent_event_id).toBe('evt-1');
      expect(firstOccurrence.recurrence_rule).toBeNull();

      // Verify start_time is 14 days after parent for the first instance
      const parentStart = new Date(baseEvent.start_time);
      const expectedStart = new Date(parentStart);
      expectedStart.setDate(expectedStart.getDate() + 14);
      expect(firstOccurrence.start_time).toBe(expectedStart.toISOString());
    });

    it('should generate 6 instances for MONTHLY recurrence', async () => {
      const monthlyEvent: Event = {
        ...baseEvent,
        recurrence_rule: 'MONTHLY',
      };
      mockEventRepo.create.mockResolvedValue(monthlyEvent);

      await service.create({
        created_by: OFFICER,
        chapter_id: 'ch-1',
        name: 'Chapter Meeting',
        start_time: baseEvent.start_time,
        end_time: baseEvent.end_time,
        recurrence_rule: 'MONTHLY',
      });

      // The parent, then all 6 occurrences in one insert.
      expect(mockEventRepo.create).toHaveBeenCalledTimes(1);
      expect(mockEventRepo.createMany).toHaveBeenCalledTimes(1);
      expect(occurrenceRows(mockEventRepo)).toHaveLength(6);

      const firstOccurrence = occurrenceRows(mockEventRepo)[0];
      expect(firstOccurrence.parent_event_id).toBe('evt-1');
      expect(firstOccurrence.recurrence_rule).toBeNull();

      // Verify start_time is 1 month after parent for the first instance
      const parentStart = new Date(baseEvent.start_time);
      const expectedStart = new Date(parentStart);
      expectedStart.setMonth(expectedStart.getMonth() + 1);
      expect(firstOccurrence.start_time).toBe(expectedStart.toISOString());
    });

    it('each instance should have correct parent_event_id and null recurrence_rule', async () => {
      const weeklyEvent: Event = {
        ...baseEvent,
        recurrence_rule: 'WEEKLY',
      };
      mockEventRepo.create.mockResolvedValue(weeklyEvent);

      await service.create({
        created_by: OFFICER,
        chapter_id: 'ch-1',
        name: 'Chapter Meeting',
        start_time: baseEvent.start_time,
        end_time: baseEvent.end_time,
        recurrence_rule: 'WEEKLY',
      });

      expect(occurrenceRows(mockEventRepo)).toHaveLength(12);
      for (const call of occurrenceRows(mockEventRepo)) {
        expect(call.parent_event_id).toBe('evt-1');
        expect(call.recurrence_rule).toBeNull();
      }
    });

    it('generated occurrences inherit the parent check-in zone', async () => {
      // Without this the geofence applied only to the series' first date, so a
      // member could check in at the opening meeting and nowhere else. It is
      // also what stops a later regenerate from silently dropping a zone that a
      // series patch had set.
      const zone = [
        { lat: 0, lng: 0 },
        { lat: 1, lng: 0 },
        { lat: 0, lng: 1 },
      ];
      const zonedWeekly: Event = {
        ...baseEvent,
        recurrence_rule: 'WEEKLY',
        check_in_zone: zone,
        check_in_zone_name: 'Great Hall',
      };
      mockEventRepo.create.mockResolvedValue(zonedWeekly);

      await service.create({
        created_by: OFFICER,
        chapter_id: 'ch-1',
        name: 'Chapter Meeting',
        start_time: baseEvent.start_time,
        end_time: baseEvent.end_time,
        recurrence_rule: 'WEEKLY',
        check_in_zone: zone,
        check_in_zone_name: 'Great Hall',
      });

      // Assert the generation actually ran before asserting anything about its
      // payloads, so this cannot pass vacuously on zero generated occurrences.
      expect(occurrenceRows(mockEventRepo)).toHaveLength(12);
      for (const call of occurrenceRows(mockEventRepo)) {
        expect(call.check_in_zone).toEqual(zone);
        expect(call.check_in_zone_name).toBe('Great Hall');
      }
    });

    // #3703: a weekly meeting that opens check-in 30 minutes early does so
    // every week, not only on the first.
    it("gives every occurrence the series' check-in lead", async () => {
      const earlyWeekly: Event = {
        ...baseEvent,
        recurrence_rule: 'WEEKLY',
        check_in_opens_minutes: 30,
      };
      mockEventRepo.create.mockResolvedValue(earlyWeekly);

      await service.create({
        created_by: OFFICER,
        chapter_id: 'ch-1',
        name: 'Chapter Meeting',
        start_time: baseEvent.start_time,
        end_time: baseEvent.end_time,
        recurrence_rule: 'WEEKLY',
        check_in_opens_minutes: 30,
      });

      expect(occurrenceRows(mockEventRepo)).toHaveLength(12);
      for (const call of occurrenceRows(mockEventRepo)) {
        expect(call.check_in_opens_minutes).toBe(30);
      }
    });

    it("gives every occurrence the series' maker (#3897)", async () => {
      const weekly: Event = {
        ...baseEvent,
        recurrence_rule: 'WEEKLY',
        created_by: 'user-maker',
      };
      mockEventRepo.create.mockResolvedValue(weekly);

      await service.create({
        chapter_id: 'ch-1',
        name: 'Chapter Meeting',
        start_time: baseEvent.start_time,
        end_time: baseEvent.end_time,
        recurrence_rule: 'WEEKLY',
        created_by: 'user-maker',
      });

      expect(occurrenceRows(mockEventRepo)).toHaveLength(12);
      for (const call of occurrenceRows(mockEventRepo)) {
        expect(call.created_by).toBe('user-maker');
      }
    });

    it('generated occurrences inherit the parent attendance by role', async () => {
      // Without this every date after the first would read the column
      // defaults: an officers-only series open to the whole chapter.
      const attendance = {
        required_role_ids: ['officer'],
        optional_role_ids: ['alumni'],
        excluded_role_ids: ['pledge'],
        others_invited: false,
      };
      mockEventRepo.create.mockResolvedValue({
        ...baseEvent,
        recurrence_rule: 'WEEKLY',
        ...attendance,
      });

      await service.create({
        created_by: OFFICER,
        chapter_id: 'ch-1',
        name: 'Exec Meeting',
        start_time: baseEvent.start_time,
        end_time: baseEvent.end_time,
        recurrence_rule: 'WEEKLY',
        ...attendance,
      });

      const occurrences = mockEventRepo.createMany.mock.calls[0][0];
      expect(occurrences).toHaveLength(12);
      for (const occurrence of occurrences) {
        expect(occurrence).toMatchObject(attendance);
      }
    });

    it('takes the parent back out when the occurrence insert fails (#3235)', async () => {
      // A parent left behind would be a series head with no occurrences, and
      // a client retrying the 5xx would create a second one.
      const weeklyEvent: Event = {
        ...baseEvent,
        recurrence_rule: 'WEEKLY',
      };
      mockEventRepo.create.mockResolvedValue(weeklyEvent);
      mockEventRepo.createMany.mockRejectedValueOnce(
        new Error('insert failed'),
      );
      mockEventRepo.delete.mockResolvedValue(undefined);

      await expect(
        service.create({
          created_by: OFFICER,
          chapter_id: 'ch-1',
          name: 'Chapter Meeting',
          start_time: baseEvent.start_time,
          end_time: baseEvent.end_time,
          recurrence_rule: 'WEEKLY',
        }),
      ).rejects.toThrow('insert failed');

      expect(mockEventRepo.createMany).toHaveBeenCalledTimes(1);
      expect(mockEventRepo.findChildren).toHaveBeenCalledWith('evt-1', 'ch-1');
      // Nothing landed, so there is nothing but the parent to delete.
      expect(mockEventRepo.deleteMany).not.toHaveBeenCalled();
      expect(mockEventRepo.delete).toHaveBeenCalledWith('evt-1', 'ch-1');
      // Nothing announced an event that no longer exists.
      expect(mockNotificationService.notifyChapter).not.toHaveBeenCalled();
    });

    it('deletes occurrences that landed although the insert reported a failure', async () => {
      // An insert can commit and still fail on the response. Deleting only
      // the parent would null their parent pointers and leave a dozen
      // standalone events behind the failed request.
      const weeklyEvent: Event = {
        ...baseEvent,
        recurrence_rule: 'WEEKLY',
      };
      mockEventRepo.create.mockResolvedValue(weeklyEvent);
      mockEventRepo.createMany.mockRejectedValueOnce(
        new Error('response lost'),
      );
      mockEventRepo.findChildren.mockResolvedValueOnce([
        { ...baseEvent, id: 'occ-1', parent_event_id: 'evt-1' },
        { ...baseEvent, id: 'occ-2', parent_event_id: 'evt-1' },
      ]);
      mockEventRepo.delete.mockResolvedValue(undefined);

      await expect(
        service.create({
          created_by: OFFICER,
          chapter_id: 'ch-1',
          name: 'Chapter Meeting',
          start_time: baseEvent.start_time,
          end_time: baseEvent.end_time,
          recurrence_rule: 'WEEKLY',
        }),
      ).rejects.toThrow('response lost');

      expect(mockEventRepo.deleteMany).toHaveBeenCalledWith(
        ['occ-1', 'occ-2'],
        'ch-1',
      );
      // Occurrences first, so a failure partway leaves the series whole.
      expect(mockEventRepo.deleteMany.mock.invocationCallOrder[0]).toBeLessThan(
        mockEventRepo.delete.mock.invocationCallOrder[0],
      );
      expect(mockEventRepo.delete).toHaveBeenCalledWith('evt-1', 'ch-1');
    });

    it('still reports the insert failure when deleting the parent also fails', async () => {
      const weeklyEvent: Event = {
        ...baseEvent,
        recurrence_rule: 'WEEKLY',
      };
      mockEventRepo.create.mockResolvedValue(weeklyEvent);
      mockEventRepo.createMany.mockRejectedValueOnce(
        new Error('insert failed'),
      );
      mockEventRepo.delete.mockRejectedValueOnce(new Error('rollback failed'));
      const logged = jest
        .spyOn(Logger.prototype, 'error')
        .mockImplementation(() => undefined);

      await expect(
        service.create({
          created_by: OFFICER,
          chapter_id: 'ch-1',
          name: 'Chapter Meeting',
          start_time: baseEvent.start_time,
          end_time: baseEvent.end_time,
          recurrence_rule: 'WEEKLY',
        }),
      ).rejects.toThrow('insert failed');

      // The stranded head is named, so it can be found and removed.
      expect(logged).toHaveBeenCalledWith(
        expect.stringContaining('evt-1'),
        expect.anything(),
      );
      logged.mockRestore();
      reportedAt('event-create-series-rollback', 'error');
    });

    // #4505: a legacy token, stepped in its creator's zone.
    describe('a legacy token across DST', () => {
      /** "HH:MM" on New York's wall clock. */
      const nyTime = (iso: string) =>
        new Intl.DateTimeFormat('en-GB', {
          timeZone: 'America/New_York',
          hour: '2-digit',
          minute: '2-digit',
          hourCycle: 'h23',
        }).format(new Date(iso));
      // Thu 2027-02-25, 7 PM EST; DST starts Sun 2027-03-14.
      const head: Event = {
        ...baseEvent,
        recurrence_rule: 'WEEKLY',
        start_time: '2027-02-26T00:00:00.000Z',
        end_time: '2027-02-26T01:00:00.000Z',
        created_by: OFFICER,
      };
      const create = () =>
        service.create({
          created_by: OFFICER,
          chapter_id: 'ch-1',
          name: 'Chapter Meeting',
          start_time: head.start_time,
          end_time: head.end_time,
          recurrence_rule: 'WEEKLY',
        });

      it("keeps 7 PM in the creator's zone after the clocks change", async () => {
        mockEventRepo.create.mockResolvedValue(head);
        mockNotificationService.timeZoneFor.mockResolvedValue(
          'America/New_York',
        );

        await create();

        expect(mockNotificationService.timeZoneFor).toHaveBeenCalledWith(
          OFFICER,
        );
        const rows = occurrenceRows(mockEventRepo);
        expect(rows).toHaveLength(12);
        expect(rows.map((row) => nyTime(row.start_time as string))).toEqual(
          Array(12).fill('19:00'),
        );
        expect(rows.map((row) => nyTime(row.end_time as string))).toEqual(
          Array(12).fill('20:00'),
        );
        expect(rows[2].start_time).toBe('2027-03-18T23:00:00.000Z');
      });

      it('steps in UTC when the creator has no zone on file', async () => {
        mockEventRepo.create.mockResolvedValue(head);
        mockNotificationService.timeZoneFor.mockResolvedValue(null);

        await create();

        const rows = occurrenceRows(mockEventRepo);
        expect(rows).toHaveLength(12);
        expect(rows[2].start_time).toBe('2027-03-19T00:00:00.000Z');
      });

      it('steps in UTC for a series with no recorded creator', async () => {
        // The announcement reads the actor's zone; the series has no creator
        // of its own to read one for.
        mockEventRepo.create.mockResolvedValue({ ...head, created_by: null });
        mockNotificationService.timeZoneFor.mockResolvedValue(
          'America/New_York',
        );

        await create();

        expect(occurrenceRows(mockEventRepo)[2].start_time).toBe(
          '2027-03-19T00:00:00.000Z',
        );
      });

      it('keeps the 6-meeting runs of BIWEEKLY and MONTHLY', async () => {
        mockNotificationService.timeZoneFor.mockResolvedValue(
          'America/New_York',
        );
        for (const rule of ['BIWEEKLY', 'MONTHLY']) {
          mockEventRepo.createMany.mockClear();
          mockEventRepo.create.mockResolvedValue({
            ...head,
            recurrence_rule: rule,
          });
          await service.create({
            created_by: OFFICER,
            chapter_id: 'ch-1',
            name: 'Chapter Meeting',
            start_time: head.start_time,
            end_time: head.end_time,
            recurrence_rule: rule,
          });
          const rows = occurrenceRows(mockEventRepo);
          expect(rows).toHaveLength(6);
          expect(
            rows.every((row) => nyTime(row.start_time as string) === '19:00'),
          ).toBe(true);
        }
      });
    });

    // #4488 / #3662: a structured rule, stepped in its own zone.
    it('meets on each chosen weekday at the same New York wall clock across DST', async () => {
      const rule =
        'FREQ=WEEKLY;INTERVAL=1;BYDAY=MO,TH;COUNT=5;TZID=America/New_York';
      // Thu 2027-03-11, 7 PM EST; DST starts Sun 2027-03-14.
      const head: Event = {
        ...baseEvent,
        recurrence_rule: rule,
        start_time: '2027-03-12T00:00:00.000Z',
        end_time: '2027-03-12T01:00:00.000Z',
      };
      mockEventRepo.create.mockResolvedValue(head);

      await service.create({
        chapter_id: 'ch-1',
        name: 'Chapter Meeting',
        start_time: head.start_time,
        end_time: head.end_time,
        recurrence_rule: rule,
      });

      // 7 PM EDT is 23:00Z: each meeting kept 7 PM, and kept its hour.
      expect(
        occurrenceRows(mockEventRepo).map((row) => [
          row.start_time,
          row.end_time,
        ]),
      ).toEqual([
        ['2027-03-15T23:00:00.000Z', '2027-03-16T00:00:00.000Z'],
        ['2027-03-18T23:00:00.000Z', '2027-03-19T00:00:00.000Z'],
        ['2027-03-22T23:00:00.000Z', '2027-03-23T00:00:00.000Z'],
        ['2027-03-25T23:00:00.000Z', '2027-03-26T00:00:00.000Z'],
      ]);
    });

    it('stops a series on its end date', async () => {
      const rule =
        'FREQ=MONTHLY;INTERVAL=1;BYDAY=2TU;UNTIL=20270413;TZID=America/New_York';
      const head: Event = {
        ...baseEvent,
        recurrence_rule: rule,
        start_time: '2027-01-12T23:00:00.000Z',
        end_time: '2027-01-13T00:00:00.000Z',
      };
      mockEventRepo.create.mockResolvedValue(head);

      await service.create({
        chapter_id: 'ch-1',
        name: 'Chapter Meeting',
        start_time: head.start_time,
        end_time: head.end_time,
        recurrence_rule: rule,
      });

      expect(
        occurrenceRows(mockEventRepo).map((row) => row.start_time),
      ).toEqual([
        '2027-02-09T23:00:00.000Z',
        '2027-03-09T23:00:00.000Z',
        '2027-04-13T22:00:00.000Z',
      ]);
    });

    it('refuses an end date that leaves no second meeting, before writing', async () => {
      await expect(
        service.create({
          chapter_id: 'ch-1',
          name: 'Chapter Meeting',
          start_time: '2027-01-12T23:00:00.000Z',
          end_time: '2027-01-13T00:00:00.000Z',
          recurrence_rule:
            'FREQ=WEEKLY;INTERVAL=1;BYDAY=TU;UNTIL=20270115;TZID=America/New_York',
        }),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(mockEventRepo.create).not.toHaveBeenCalled();
    });

    it('should not generate instances when no recurrence_rule is set', async () => {
      mockEventRepo.create.mockResolvedValue(baseEvent);

      await service.create({
        created_by: OFFICER,
        chapter_id: 'ch-1',
        name: 'Chapter Meeting',
        start_time: baseEvent.start_time,
        end_time: baseEvent.end_time,
      });

      expect(mockEventRepo.create).toHaveBeenCalledTimes(1);
    });
  });

  describe('recurring series lifecycle', () => {
    // A fixed clock so "past" and "future" are properties of the fixtures, not
    // of when the suite happens to run. Only `Date.now()` is stubbed — the
    // service compares stored `start_time` values against it.
    const NOW = new Date('2026-03-15T00:00:00.000Z').getTime();
    let nowSpy: jest.SpyInstance<number, []>;

    beforeEach(() => {
      nowSpy = jest.spyOn(Date, 'now').mockReturnValue(NOW);
    });
    afterEach(() => nowSpy.mockRestore());

    const parent: Event = {
      ...baseEvent,
      id: 'parent-1',
      recurrence_rule: 'WEEKLY',
      start_time: '2026-03-01T18:00:00.000Z',
      end_time: '2026-03-01T19:00:00.000Z',
    };
    const pastChild: Event = {
      ...baseEvent,
      id: 'child-past',
      parent_event_id: 'parent-1',
      start_time: '2026-03-08T18:00:00.000Z',
      end_time: '2026-03-08T19:00:00.000Z',
    };
    const futureChild1: Event = {
      ...baseEvent,
      id: 'child-future-1',
      parent_event_id: 'parent-1',
      start_time: '2026-03-22T18:00:00.000Z',
      end_time: '2026-03-22T19:00:00.000Z',
    };
    const futureChild2: Event = {
      ...baseEvent,
      id: 'child-future-2',
      parent_event_id: 'parent-1',
      start_time: '2026-03-29T18:00:00.000Z',
      end_time: '2026-03-29T19:00:00.000Z',
    };
    const wholeSeries = [pastChild, futureChild1, futureChild2];

    // `parent` starts 03-01 and the stubbed clock is 03-15, so the head has
    // ALREADY STARTED in every fixture below. That is deliberate — it is the
    // #1392 case — and it means a `series` update takes the split path.
    //
    // `update` has to return the merged row rather than a canned one: the
    // service promotes the successor and then re-points the survivors at
    // `newHead.id`, so a mock that always answers with the parent would let a
    // wrong-id re-point pass.
    const mergeUpdate = (rows: Event[]) =>
      mockEventRepo.update.mockImplementation(
        async (id: string, _chapterId: string, data: Partial<Event>) => ({
          ...(rows.find((row) => row.id === id) ?? baseEvent),
          ...data,
        }),
      );

    describe('series update', () => {
      // Before #1392 this asserted `updateMany(['child-future-1',
      // 'child-future-2'], { name: 'Renamed' })` while the head was renamed in
      // place. The head has started, so it is now retired instead and the
      // earliest upcoming occurrence carries the rename as the new series head.
      it('applies the edit to future instances only', async () => {
        mockEventRepo.findById.mockResolvedValue(parent);
        mockEventRepo.findChildren.mockResolvedValue(wholeSeries);
        mergeUpdate([parent, ...wholeSeries]);

        await service.update('parent-1', 'ch-1', { name: 'Renamed' }, 'series');

        // The started head is retired, not renamed.
        expect(mockEventRepo.update).toHaveBeenCalledWith('parent-1', 'ch-1', {
          recurrence_rule: null,
        });
        // The earliest upcoming occurrence becomes the series and carries it.
        expect(mockEventRepo.update).toHaveBeenCalledWith(
          'child-future-1',
          'ch-1',
          expect.objectContaining({
            name: 'Renamed',
            recurrence_rule: 'WEEKLY',
            parent_event_id: null,
          }),
        );
        // The remaining future occurrence is renamed and re-pointed at it.
        expect(mockEventRepo.updateMany).toHaveBeenCalledWith(
          ['child-future-2'],
          'ch-1',
          { name: 'Renamed', parent_event_id: 'child-future-1' },
        );
        expect(mockEventRepo.deleteReplacedOccurrences).not.toHaveBeenCalled();
      });

      // Before #1392 this read `updateMany.mock.calls[0]` and asserted the ids
      // excluded `child-past`. A past occurrence is now written once — to
      // detach it from the series that just ended — so the assertion is on the
      // payload instead: no past row may receive any of the caller's fields.
      it('never includes a past instance in the write set', async () => {
        mockEventRepo.findById.mockResolvedValue(parent);
        mockEventRepo.findChildren.mockResolvedValue(wholeSeries);
        mergeUpdate([parent, ...wholeSeries]);

        await service.update('parent-1', 'ch-1', { name: 'Renamed' }, 'series');

        for (const [ids, , data] of mockEventRepo.updateMany.mock.calls) {
          if (ids.includes('child-past')) {
            expect(data).toEqual({ parent_event_id: null });
          }
        }
        expect(mockEventRepo.update).not.toHaveBeenCalledWith(
          'child-past',
          expect.anything(),
          expect.anything(),
        );
        expect(mockEventRepo.deleteReplacedOccurrences).not.toHaveBeenCalled();
      });

      it('regenerates future instances when the recurrence rule changes', async () => {
        mockEventRepo.findById.mockResolvedValue(parent);
        mockEventRepo.findChildren.mockResolvedValue(wholeSeries);
        mergeUpdate([parent, ...wholeSeries]);
        mockEventRepo.create.mockResolvedValue(baseEvent);

        await service.update(
          'parent-1',
          'ch-1',
          { recurrence_rule: 'MONTHLY' },
          'series',
        );

        // Before #1392 both future occurrences were deleted and rebuilt from
        // the head. `child-future-1` is now the new head, so only the rest is.
        expect(mockEventRepo.deleteReplacedOccurrences).toHaveBeenCalledWith(
          ['child-future-2'],
          'ch-1',
          expect.any(Array),
        );
        expect(occurrenceRows(mockEventRepo)).toHaveLength(6);
      });

      // A client that PATCHes the whole event back (web did until #3667) sends
      // an unchanged rule on every save. Regenerating on presence
      // rather than on change would delete and rebuild future rows each time —
      // and `event_attendance` is `on delete cascade`.
      it('does not regenerate when an unchanged rule is resent', async () => {
        mockEventRepo.findById.mockResolvedValue(parent);
        mockEventRepo.findChildren.mockResolvedValue([futureChild1]);
        mockEventRepo.update.mockResolvedValue(parent);

        await service.update(
          'parent-1',
          'ch-1',
          { name: 'Same', recurrence_rule: 'WEEKLY' },
          'series',
        );

        expect(mockEventRepo.deleteReplacedOccurrences).not.toHaveBeenCalled();
        expect(mockEventRepo.createMany).not.toHaveBeenCalled();
      });

      it('treats an equivalent timestamp spelling as unchanged', async () => {
        mockEventRepo.findById.mockResolvedValue(parent);
        mockEventRepo.findChildren.mockResolvedValue([futureChild1]);
        mockEventRepo.update.mockResolvedValue(parent);

        // Same instant as the stored `...18:00:00.000Z`, different spelling.
        await service.update(
          'parent-1',
          'ch-1',
          { start_time: '2026-03-01T18:00:00+00:00' },
          'series',
        );

        expect(mockEventRepo.deleteReplacedOccurrences).not.toHaveBeenCalled();
      });

      // Found in review: `update()` validates the interval against the row the
      // caller named, but a series edit is written to the *parent*. An
      // individually-moved child can hold times that make the patch valid
      // against itself yet inverted against the parent.
      it('rejects a patch that would invert the parent interval', async () => {
        // Child was moved to the afternoon of 03-22; the parent still runs
        // 18:00-19:00 on 03-01.
        const movedChild: Event = {
          ...futureChild1,
          start_time: '2026-03-22T14:00:00.000Z',
          end_time: '2026-03-22T18:00:00.000Z',
        };
        mockEventRepo.findById.mockImplementation(async (id: string) =>
          id === 'parent-1' ? parent : movedChild,
        );

        // 17:00 on 03-22 is before the child's own 18:00 end, so the caller-facing
        // check passes — but it is three weeks after the parent's end_time.
        await expect(
          service.update(
            'child-future-1',
            'ch-1',
            { start_time: '2026-03-22T17:00:00.000Z' },
            'series',
          ),
        ).rejects.toThrow(BadRequestException);
        expect(mockEventRepo.update).not.toHaveBeenCalled();
      });

      // Found in review: regenerating from a parent that already started would
      // create occurrences in the past — rows for meetings that never happened.
      it('does not create past occurrences when regenerating', async () => {
        const monthlyParent: Event = { ...parent, recurrence_rule: 'MONTHLY' };
        mockEventRepo.findById.mockResolvedValue(monthlyParent);
        mockEventRepo.findChildren.mockResolvedValue(wholeSeries);
        mockEventRepo.update.mockResolvedValue({
          ...monthlyParent,
          recurrence_rule: 'WEEKLY',
        });
        mockEventRepo.create.mockResolvedValue(baseEvent);

        // Parent started 03-01 and "now" is 03-15, so a WEEKLY rebuild would
        // otherwise emit an occurrence on 03-08, a week in the past.
        await service.update(
          'parent-1',
          'ch-1',
          { recurrence_rule: 'WEEKLY' },
          'series',
        );

        const createdStarts = occurrenceRows(mockEventRepo).map((payload) =>
          new Date(payload.start_time as string).getTime(),
        );
        expect(createdStarts.length).toBeGreaterThan(0);
        for (const started of createdStarts) {
          expect(started).toBeGreaterThan(NOW);
        }
      });

      // #4505: a rule change regenerates a legacy token in its creator's zone.
      it("regenerates a legacy token on its creator's wall clock", async () => {
        // Thu 2027-02-25, 7 PM EST, still to come at the stubbed clock.
        const upcoming: Event = {
          ...parent,
          recurrence_rule: 'MONTHLY',
          start_time: '2027-02-26T00:00:00.000Z',
          end_time: '2027-02-26T01:00:00.000Z',
          created_by: OFFICER,
        };
        mockEventRepo.findById.mockResolvedValue(upcoming);
        mockEventRepo.findChildren.mockResolvedValue([]);
        mergeUpdate([upcoming]);
        mockNotificationService.timeZoneFor.mockResolvedValue(
          'America/New_York',
        );

        await service.update(
          'parent-1',
          'ch-1',
          { recurrence_rule: 'WEEKLY' },
          'series',
        );

        expect(mockNotificationService.timeZoneFor).toHaveBeenCalledWith(
          OFFICER,
        );
        const starts = occurrenceRows(mockEventRepo).map(
          (row) => row.start_time,
        );
        expect(starts).toHaveLength(12);
        expect(starts.slice(1, 4)).toEqual([
          '2027-03-12T00:00:00.000Z',
          '2027-03-18T23:00:00.000Z',
          '2027-03-25T23:00:00.000Z',
        ]);
      });

      it('resolves a series edit issued against a child to its parent', async () => {
        mockEventRepo.findById.mockImplementation(async (id: string) =>
          id === 'parent-1'
            ? parent
            : id === 'child-future-1'
              ? futureChild1
              : null,
        );
        mockEventRepo.findChildren.mockResolvedValue([futureChild2]);
        mergeUpdate([parent, futureChild1, futureChild2]);

        await service.update('child-future-1', 'ch-1', { name: 'X' }, 'series');

        // Resolution to the parent is what this test is about, and it still
        // happens — `findChildren` is called for the parent's id. Before #1392
        // the rename then landed on the parent; the parent has started, so it
        // now lands on the promoted successor instead.
        expect(mockEventRepo.findChildren).toHaveBeenCalledWith(
          'parent-1',
          'ch-1',
        );
        expect(mockEventRepo.update).toHaveBeenCalledWith('parent-1', 'ch-1', {
          recurrence_rule: null,
        });
        expect(mockEventRepo.update).toHaveBeenCalledWith(
          'child-future-2',
          'ch-1',
          expect.objectContaining({ name: 'X' }),
        );
      });
    });

    // #1392. The head is both the series template and the series' own first
    // occurrence. Once it has started, a `series` edit that writes it rewrites a
    // meeting that already happened, and the `event_attendance` rows hanging off
    // it then describe an event as it never was.
    //
    // Every test here fails against the pre-#1392 service: it wrote the patch to
    // the head unconditionally.
    describe('series update on a started head', () => {
      const ZONE = [
        { lat: 1, lng: 2 },
        { lat: 3, lng: 4 },
        { lat: 5, lng: 6 },
      ];

      // AC 1 and AC 4.
      it("never writes the started head's own occurrence fields", async () => {
        mockEventRepo.findById.mockResolvedValue(parent);
        mockEventRepo.findChildren.mockResolvedValue(wholeSeries);
        mergeUpdate([parent, ...wholeSeries]);
        mockEventRepo.create.mockResolvedValue(baseEvent);

        await service.update(
          'parent-1',
          'ch-1',
          {
            name: 'Renamed',
            location: 'Elsewhere',
            point_value: 25,
            notes: 'new minutes',
            check_in_zone: ZONE,
          },
          'series',
        );

        // Exactly one write to the head, carrying exactly one field. Anything
        // else would edit the meeting its attendance rows describe.
        const headWrites = mockEventRepo.update.mock.calls.filter(
          ([id]) => id === 'parent-1',
        );
        expect(headWrites).toHaveLength(1);
        expect(headWrites[0][2]).toEqual({ recurrence_rule: null });
      });

      // AC 2 — the edit must not be silently dropped, which is how #1391 failed.
      it('applies the edit to the series going forward', async () => {
        mockEventRepo.findById.mockResolvedValue(parent);
        mockEventRepo.findChildren.mockResolvedValue(wholeSeries);
        mergeUpdate([parent, ...wholeSeries]);

        await service.update(
          'parent-1',
          'ch-1',
          { name: 'Renamed', check_in_zone: ZONE },
          'series',
        );

        expect(mockEventRepo.update).toHaveBeenCalledWith(
          'child-future-1',
          'ch-1',
          expect.objectContaining({
            name: 'Renamed',
            check_in_zone: ZONE,
            recurrence_rule: 'WEEKLY',
            parent_event_id: null,
          }),
        );
      });

      it('carries a kept COUNT onto the new head less the meetings that left', async () => {
        const counted: Event = {
          ...parent,
          recurrence_rule: 'FREQ=WEEKLY;INTERVAL=1;BYDAY=SU;COUNT=8;TZID=UTC',
        };
        mockEventRepo.findById.mockResolvedValue(counted);
        mockEventRepo.findChildren.mockResolvedValue(wholeSeries);
        mergeUpdate([counted, ...wholeSeries]);

        await service.update('parent-1', 'ch-1', { name: 'Renamed' }, 'series');

        expect(mockEventRepo.update).toHaveBeenCalledWith(
          'child-future-1',
          'ch-1',
          expect.objectContaining({
            name: 'Renamed',
            recurrence_rule: 'FREQ=WEEKLY;INTERVAL=1;BYDAY=SU;COUNT=5;TZID=UTC',
          }),
        );
      });

      it('detaches past occurrences from the series that just ended', async () => {
        mockEventRepo.findById.mockResolvedValue(parent);
        mockEventRepo.findChildren.mockResolvedValue(wholeSeries);
        mergeUpdate([parent, ...wholeSeries]);

        await service.update('parent-1', 'ch-1', { name: 'Renamed' }, 'series');

        expect(mockEventRepo.updateMany).toHaveBeenCalledWith(
          ['child-past'],
          'ch-1',
          { parent_event_id: null },
        );
        // Detached, never deleted: `event_attendance.event_id` cascades.
        expect(mockEventRepo.deleteReplacedOccurrences).not.toHaveBeenCalled();
      });

      // AC 3. This is the regression #1391 hit: fields reached the children but
      // not the template, so the next rule change rebuilt from stale values and
      // silently reverted a rename and dropped the geofence.
      it('regenerates from current values after a later rule change', async () => {
        mockEventRepo.findById.mockResolvedValue(parent);
        mockEventRepo.findChildren.mockResolvedValue(wholeSeries);
        mergeUpdate([parent, ...wholeSeries]);

        const newHead = await service.update(
          'parent-1',
          'ch-1',
          { name: 'Renamed', check_in_zone: ZONE },
          'series',
        );
        expect(newHead.id).toBe('child-future-1');

        // Second edit, addressed to the new head. It is upcoming, so this takes
        // the ordinary path — and the template it reads is the row above.
        jest.clearAllMocks();
        mockEventRepo.findById.mockResolvedValue(newHead);
        mockEventRepo.findChildren.mockResolvedValue([]);
        mergeUpdate([newHead]);
        mockEventRepo.create.mockResolvedValue(baseEvent);

        await service.update(
          newHead.id,
          'ch-1',
          { recurrence_rule: 'BIWEEKLY' },
          'series',
        );

        expect(occurrenceRows(mockEventRepo)).toHaveLength(6);
        for (const payload of occurrenceRows(mockEventRepo)) {
          expect(payload.name).toBe('Renamed');
          expect(payload.check_in_zone).toEqual(ZONE);
        }
      });

      it('shifts upcoming occurrences by the amount the head moved', async () => {
        mockEventRepo.findById.mockResolvedValue(parent);
        mockEventRepo.findChildren.mockResolvedValue(wholeSeries);
        mergeUpdate([parent, ...wholeSeries]);
        mockEventRepo.create.mockResolvedValue(baseEvent);

        // The head ran 18:00-19:00 on 03-01; move it an hour later.
        await service.update(
          'parent-1',
          'ch-1',
          {
            start_time: '2026-03-01T19:00:00.000Z',
            end_time: '2026-03-01T20:00:00.000Z',
          },
          'series',
        );

        // The successor keeps its own date and moves by the same hour. Writing
        // the caller's instants literally would have anchored the series on
        // 03-01, two weeks in the past.
        expect(mockEventRepo.update).toHaveBeenCalledWith(
          'child-future-1',
          'ch-1',
          expect.objectContaining({
            start_time: '2026-03-22T19:00:00.000Z',
            end_time: '2026-03-22T20:00:00.000Z',
          }),
        );
      });

      it('refuses a shift that would move the next occurrence into the past', async () => {
        mockEventRepo.findById.mockResolvedValue(parent);
        mockEventRepo.findChildren.mockResolvedValue(wholeSeries);
        mergeUpdate([parent, ...wholeSeries]);

        // Four weeks earlier would land the 03-22 successor on 02-22.
        await expect(
          service.update(
            'parent-1',
            'ch-1',
            {
              start_time: '2026-02-01T18:00:00.000Z',
              end_time: '2026-02-01T19:00:00.000Z',
            },
            'series',
          ),
        ).rejects.toThrow(BadRequestException);

        expect(mockEventRepo.update).not.toHaveBeenCalled();
        expect(mockEventRepo.deleteReplacedOccurrences).not.toHaveBeenCalled();
      });

      it('refuses a series edit when no occurrence is still upcoming', async () => {
        mockEventRepo.findById.mockResolvedValue(parent);
        mockEventRepo.findChildren.mockResolvedValue([pastChild]);

        // Every row this could reach is history, and rewriting history is the
        // whole defect. Refuse rather than report a 200 that wrote nothing.
        await expect(
          service.update('parent-1', 'ch-1', { name: 'Renamed' }, 'series'),
        ).rejects.toThrow(BadRequestException);

        expect(mockEventRepo.update).not.toHaveBeenCalled();
        expect(mockEventRepo.updateMany).not.toHaveBeenCalled();
        expect(mockEventRepo.deleteReplacedOccurrences).not.toHaveBeenCalled();
      });

      // The split is scoped to a head that has started. A series still in the
      // future keeps the original behavior, head write included.
      it('still writes the head directly when it has not started', async () => {
        const upcomingHead: Event = {
          ...parent,
          id: 'up-1',
          start_time: '2026-03-18T18:00:00.000Z',
          end_time: '2026-03-18T19:00:00.000Z',
        };
        const upcomingChild: Event = {
          ...baseEvent,
          id: 'up-c1',
          parent_event_id: 'up-1',
          start_time: '2026-03-25T18:00:00.000Z',
          end_time: '2026-03-25T19:00:00.000Z',
        };
        mockEventRepo.findById.mockResolvedValue(upcomingHead);
        mockEventRepo.findChildren.mockResolvedValue([upcomingChild]);
        mergeUpdate([upcomingHead, upcomingChild]);

        await service.update('up-1', 'ch-1', { name: 'Renamed' }, 'series');

        expect(mockEventRepo.update).toHaveBeenCalledWith('up-1', 'ch-1', {
          name: 'Renamed',
        });
        expect(mockEventRepo.updateMany).toHaveBeenCalledWith(
          ['up-c1'],
          'ch-1',
          { name: 'Renamed' },
        );
      });
    });

    describe('series delete', () => {
      it('deletes future occurrences and preserves ones that already happened', async () => {
        mockEventRepo.findById.mockResolvedValue(parent);
        mockEventRepo.findChildren.mockResolvedValue(wholeSeries);

        await service.delete('parent-1', 'ch-1', 'series');

        expect(mockEventRepo.deleteMany).toHaveBeenCalledWith(
          ['child-future-1', 'child-future-2'],
          'ch-1',
        );
        // The head already happened, so it survives with the series ended.
        expect(mockEventRepo.delete).not.toHaveBeenCalled();
        expect(mockEventRepo.update).toHaveBeenCalledWith('parent-1', 'ch-1', {
          recurrence_rule: null,
        });
      });

      // The point of preserving past rows: `event_attendance.event_id` is
      // `on delete cascade`, so deleting a past occurrence destroys the record
      // that the meeting happened and who was there.
      it('never deletes a past occurrence, so its attendance survives', async () => {
        mockEventRepo.findById.mockResolvedValue(parent);
        mockEventRepo.findChildren.mockResolvedValue(wholeSeries);

        await service.delete('parent-1', 'ch-1', 'series');

        const deletedIds = mockEventRepo.deleteMany.mock.calls.flatMap(
          ([ids]) => ids,
        );
        expect(deletedIds).not.toContain('child-past');
        expect(deletedIds).not.toContain('parent-1');
      });

      it('detaches surviving past occurrences so none is left orphaned', async () => {
        mockEventRepo.findById.mockResolvedValue(parent);
        mockEventRepo.findChildren.mockResolvedValue(wholeSeries);

        await service.delete('parent-1', 'ch-1', 'series');

        expect(mockEventRepo.updateMany).toHaveBeenCalledWith(
          ['child-past'],
          'ch-1',
          { parent_event_id: null },
        );
      });

      it('deletes the head too when the whole series is still upcoming', async () => {
        const upcoming: Event = {
          ...parent,
          start_time: '2026-04-01T18:00:00.000Z',
          end_time: '2026-04-01T19:00:00.000Z',
        };
        mockEventRepo.findById.mockResolvedValue(upcoming);
        mockEventRepo.findChildren.mockResolvedValue([futureChild1]);

        await service.delete('parent-1', 'ch-1', 'series');

        expect(mockEventRepo.deleteMany).toHaveBeenCalledWith(
          ['child-future-1'],
          'ch-1',
        );
        expect(mockEventRepo.delete).toHaveBeenCalledWith('parent-1', 'ch-1');
      });
    });

    describe('instance delete of a series head', () => {
      it('promotes the next occurrence instead of orphaning the series', async () => {
        mockEventRepo.findById.mockResolvedValue(parent);
        mockEventRepo.findChildren.mockResolvedValue(wholeSeries);

        await service.delete('parent-1', 'ch-1');

        // The successor is the earliest *upcoming* occurrence. Promoting
        // `child-past` instead rewrote a meeting that had already happened to
        // carry a recurrence rule, and left the series anchored in the past so
        // every later regenerating edit built from a stale anchor.
        expect(mockEventRepo.update).toHaveBeenCalledWith(
          'child-future-1',
          'ch-1',
          {
            recurrence_rule: 'WEEKLY',
            parent_event_id: null,
          },
        );
        expect(mockEventRepo.updateMany).toHaveBeenCalledWith(
          ['child-future-2'],
          'ch-1',
          { parent_event_id: 'child-future-1' },
        );
        // Occurrences that already happened become standalone history.
        expect(mockEventRepo.updateMany).toHaveBeenCalledWith(
          ['child-past'],
          'ch-1',
          { parent_event_id: null },
        );
        expect(mockEventRepo.delete).toHaveBeenCalledWith('parent-1', 'ch-1');
      });

      it('drops a COUNT by the meetings that left, so the series keeps its length', async () => {
        const counted: Event = {
          ...parent,
          recurrence_rule: 'FREQ=WEEKLY;INTERVAL=1;BYDAY=SU;COUNT=8;TZID=UTC',
        };
        mockEventRepo.findById.mockResolvedValue(counted);
        mockEventRepo.findChildren.mockResolvedValue(wholeSeries);

        await service.delete('parent-1', 'ch-1');

        // The canceled head and the pattern's Mar 8 and Mar 15 come before
        // the successor (Mar 15 has no row: canceled on its own): 8 - 3.
        expect(mockEventRepo.update).toHaveBeenCalledWith(
          'child-future-1',
          'ch-1',
          {
            recurrence_rule: 'FREQ=WEEKLY;INTERVAL=1;BYDAY=SU;COUNT=5;TZID=UTC',
            parent_event_id: null,
          },
        );
      });

      it('lets a lone successor of an UNTIL series stand without the rule', async () => {
        // Mar 1, 8, 15 and 22 by the pattern; only Mar 22 is left after the
        // canceled head, and one meeting is not a series.
        const dated: Event = {
          ...parent,
          recurrence_rule:
            'FREQ=WEEKLY;INTERVAL=1;BYDAY=SU;UNTIL=20260322;TZID=UTC',
        };
        mockEventRepo.findById.mockResolvedValue(dated);
        mockEventRepo.findChildren.mockResolvedValue(wholeSeries);

        await service.delete('parent-1', 'ch-1');

        expect(mockEventRepo.update).toHaveBeenCalledWith(
          'child-future-1',
          'ch-1',
          { recurrence_rule: null, parent_event_id: null },
        );
      });

      it("hands a by-date monthly series on with the old head's day", async () => {
        // Jan 31, Feb 28, Mar 31, Apr 30, May 31; it is now Apr 1, so the
        // successor is the clamped Apr 30 and the series must keep the 31st.
        nowSpy.mockReturnValue(new Date('2026-04-01T00:00:00.000Z').getTime());
        const monthly: Event = {
          ...parent,
          recurrence_rule: 'FREQ=MONTHLY;INTERVAL=1;COUNT=6;TZID=UTC',
          start_time: '2026-01-31T18:00:00.000Z',
          end_time: '2026-01-31T19:00:00.000Z',
        };
        const at = (id: string, day: string): Event => ({
          ...baseEvent,
          id,
          parent_event_id: 'parent-1',
          start_time: `${day}T18:00:00.000Z`,
          end_time: `${day}T19:00:00.000Z`,
        });
        mockEventRepo.findById.mockResolvedValue(monthly);
        mockEventRepo.findChildren.mockResolvedValue([
          at('feb', '2026-02-28'),
          at('mar', '2026-03-31'),
          at('apr', '2026-04-30'),
          at('may', '2026-05-31'),
        ]);

        await service.delete('parent-1', 'ch-1');

        expect(mockEventRepo.update).toHaveBeenCalledWith('apr', 'ch-1', {
          recurrence_rule:
            'FREQ=MONTHLY;INTERVAL=1;BYMONTHDAY=31;COUNT=3;TZID=UTC',
          parent_event_id: null,
        });
      });

      it('leaves a non-recurring event as a plain single-row delete', async () => {
        mockEventRepo.findById.mockResolvedValue(baseEvent);

        await service.delete('evt-1', 'ch-1');

        expect(mockEventRepo.findChildren).not.toHaveBeenCalled();
        expect(mockEventRepo.delete).toHaveBeenCalledWith('evt-1', 'ch-1');
      });
    });

    // Each case below is a defect this branch's review found in #1358 and
    // fixes. Every one was reproduced against the unfixed code first.
    // #4488: a structured rule's length survives a split, and an end date
    // is checked against the meeting that becomes the series' first.
    describe('structured rules on a series edit', () => {
      const COUNT_8 = 'FREQ=WEEKLY;INTERVAL=1;BYDAY=SU;COUNT=8;TZID=UTC';
      const COUNT_5 = 'FREQ=WEEKLY;INTERVAL=1;BYDAY=SU;COUNT=5;TZID=UTC';

      it('regenerates a split COUNT series at its remaining length', async () => {
        const counted: Event = { ...parent, recurrence_rule: COUNT_8 };
        mockEventRepo.findById.mockResolvedValue(counted);
        mockEventRepo.findChildren.mockResolvedValue(wholeSeries);
        mergeUpdate([counted, ...wholeSeries]);
        mockEventRepo.createMany.mockResolvedValue([]);

        // Move the series an hour later.
        await service.update(
          'parent-1',
          'ch-1',
          {
            start_time: '2026-03-01T19:00:00.000Z',
            end_time: '2026-03-01T20:00:00.000Z',
          },
          'series',
        );

        // Mar 1, 8 and 15 come before the new head (Mar 15 was canceled on
        // its own, and still counts): 8 - 3 = 5, the new head included, so
        // it makes 4 more, an hour later, ending on the series' last Sunday.
        expect(mockEventRepo.update).toHaveBeenCalledWith(
          'child-future-1',
          'ch-1',
          expect.objectContaining({
            start_time: '2026-03-22T19:00:00.000Z',
            recurrence_rule: COUNT_5,
          }),
        );
        expect(
          occurrenceRows(mockEventRepo).map((row) => row.start_time),
        ).toEqual([
          '2026-03-29T19:00:00.000Z',
          '2026-04-05T19:00:00.000Z',
          '2026-04-12T19:00:00.000Z',
          '2026-04-19T19:00:00.000Z',
        ]);
      });

      it('moves a started monthly series whole, not only its next meeting', async () => {
        // Feb 1 (past), Mar 1 (past), Apr 1, May 1 of a 6-meeting series,
        // moved a day later.
        const monthly: Event = {
          ...parent,
          recurrence_rule: 'FREQ=MONTHLY;INTERVAL=1;COUNT=6;TZID=UTC',
          start_time: '2026-02-01T18:00:00.000Z',
          end_time: '2026-02-01T19:00:00.000Z',
        };
        const at = (id: string, day: string): Event => ({
          ...baseEvent,
          id,
          parent_event_id: 'parent-1',
          start_time: `${day}T18:00:00.000Z`,
          end_time: `${day}T19:00:00.000Z`,
        });
        const rows = [
          at('mar', '2026-03-01'),
          at('apr', '2026-04-01'),
          at('may', '2026-05-01'),
        ];
        mockEventRepo.findById.mockResolvedValue(monthly);
        mockEventRepo.findChildren.mockResolvedValue(rows);
        mergeUpdate([monthly, ...rows]);
        mockEventRepo.createMany.mockResolvedValue([]);

        await service.update(
          'parent-1',
          'ch-1',
          {
            start_time: '2026-02-02T18:00:00.000Z',
            end_time: '2026-02-02T19:00:00.000Z',
          },
          'series',
        );

        expect(mockEventRepo.update).toHaveBeenCalledWith(
          'apr',
          'ch-1',
          expect.objectContaining({ start_time: '2026-04-02T18:00:00.000Z' }),
        );
        expect(
          occurrenceRows(mockEventRepo).map((row) => row.start_time),
        ).toEqual([
          '2026-05-02T18:00:00.000Z',
          '2026-06-02T18:00:00.000Z',
          '2026-07-02T18:00:00.000Z',
        ]);
      });

      it("moves an upcoming weekly series' days with its head", async () => {
        const upcoming: Event = {
          ...parent,
          recurrence_rule: 'FREQ=WEEKLY;INTERVAL=1;BYDAY=SU;COUNT=3;TZID=UTC',
          start_time: '2026-04-05T18:00:00.000Z',
          end_time: '2026-04-05T19:00:00.000Z',
        };
        mockEventRepo.findById.mockResolvedValue(upcoming);
        mockEventRepo.findChildren.mockResolvedValue([]);
        mergeUpdate([upcoming]);
        mockEventRepo.createMany.mockResolvedValue([]);

        // Sunday to Monday.
        await service.update(
          'parent-1',
          'ch-1',
          {
            start_time: '2026-04-06T18:00:00.000Z',
            end_time: '2026-04-06T19:00:00.000Z',
          },
          'series',
        );

        expect(
          occurrenceRows(mockEventRepo).map((row) => row.start_time),
        ).toEqual(['2026-04-13T18:00:00.000Z', '2026-04-20T18:00:00.000Z']);
        expect(mockEventRepo.update).toHaveBeenCalledWith(
          'parent-1',
          'ch-1',
          expect.objectContaining({
            recurrence_rule: 'FREQ=WEEKLY;INTERVAL=1;BYDAY=MO;COUNT=3;TZID=UTC',
          }),
        );
      });

      it('refuses an end date before an upcoming head has a second meeting', async () => {
        const upcoming: Event = {
          ...parent,
          start_time: '2026-04-05T18:00:00.000Z',
          end_time: '2026-04-05T19:00:00.000Z',
        };
        mockEventRepo.findById.mockResolvedValue(upcoming);
        mockEventRepo.findChildren.mockResolvedValue([]);

        await expect(
          service.update(
            'parent-1',
            'ch-1',
            {
              recurrence_rule:
                'FREQ=WEEKLY;INTERVAL=1;BYDAY=SU;UNTIL=20260410;TZID=UTC',
            },
            'series',
          ),
        ).rejects.toBeInstanceOf(BadRequestException);
        expect(mockEventRepo.update).not.toHaveBeenCalled();
        expect(mockEventRepo.createMany).not.toHaveBeenCalled();
      });

      it("checks a started head's end date against its successor, before writing", async () => {
        // From the retired 03-01 head this leaves 03-08 to 03-22; from the
        // 03-22 successor it leaves nothing after it.
        mockEventRepo.findById.mockResolvedValue(parent);
        mockEventRepo.findChildren.mockResolvedValue(wholeSeries);
        mergeUpdate([parent, ...wholeSeries]);

        await expect(
          service.update(
            'parent-1',
            'ch-1',
            {
              recurrence_rule:
                'FREQ=WEEKLY;INTERVAL=1;BYDAY=SU;UNTIL=20260325;TZID=UTC',
            },
            'series',
          ),
        ).rejects.toBeInstanceOf(BadRequestException);
        expect(mockEventRepo.update).not.toHaveBeenCalled();
        expect(mockEventRepo.createMany).not.toHaveBeenCalled();
      });
    });

    describe('review fixes', () => {
      it('regenerates a full series forward when the head is long past', async () => {
        // The old code emitted a fixed window anchored on the parent's original
        // start_time and filtered out whatever had elapsed. Once a series
        // outlived that window every candidate was in the past, so a rule change
        // deleted the future occurrences and created nothing.
        const ancient: Event = {
          ...parent,
          start_time: '2025-01-06T18:00:00.000Z',
          end_time: '2025-01-06T19:00:00.000Z',
        };
        mockEventRepo.findById.mockResolvedValue(ancient);
        mockEventRepo.findChildren.mockResolvedValue([futureChild1]);
        mockEventRepo.update.mockResolvedValue({
          ...ancient,
          recurrence_rule: 'BIWEEKLY',
        });
        mockEventRepo.create.mockResolvedValue(baseEvent);

        await service.update(
          'parent-1',
          'ch-1',
          { recurrence_rule: 'BIWEEKLY' },
          'series',
        );

        // A BIWEEKLY series is six occurrences, and every one must be upcoming.
        expect(occurrenceRows(mockEventRepo)).toHaveLength(6);
        for (const payload of occurrenceRows(mockEventRepo)) {
          expect(
            new Date(payload.start_time as string).getTime(),
          ).toBeGreaterThan(NOW);
        }
      });

      it('refuses an ungeneratable rule before deleting anything', async () => {
        mockEventRepo.findById.mockResolvedValue(parent);
        mockEventRepo.findChildren.mockResolvedValue(wholeSeries);

        await expect(
          service.update(
            'parent-1',
            'ch-1',
            { recurrence_rule: 'DAILY' },
            'series',
          ),
        ).rejects.toThrow(BadRequestException);

        expect(mockEventRepo.deleteReplacedOccurrences).not.toHaveBeenCalled();
        expect(mockEventRepo.update).not.toHaveBeenCalled();
      });

      it('ignores the times on a series edit issued from a child', async () => {
        // A client that round-trips the whole event object sends a rename
        // saved from a later occurrence carrying that occurrence's start_time.
        // That is not a request to move the series.
        mockEventRepo.findById.mockImplementation(async (id: string) =>
          id === 'parent-1' ? parent : futureChild1,
        );
        mockEventRepo.findChildren.mockResolvedValue([futureChild2]);
        mergeUpdate([parent, futureChild1, futureChild2]);

        await service.update(
          'child-future-1',
          'ch-1',
          {
            name: 'Renamed',
            start_time: futureChild1.start_time,
            end_time: futureChild1.end_time,
            recurrence_rule: 'WEEKLY',
          },
          'series',
        );

        // A rename must not destroy and rebuild the series...
        expect(mockEventRepo.deleteReplacedOccurrences).not.toHaveBeenCalled();
        expect(mockEventRepo.createMany).not.toHaveBeenCalled();
        // ...and must not drag the anchor onto the child's date. Before #1392
        // the rename landed on `parent-1`; it now lands on the promoted
        // successor. Assert that write happened before inspecting the call
        // list, so this cannot pass by the list simply being empty.
        expect(mockEventRepo.update).toHaveBeenCalledWith(
          'child-future-2',
          'ch-1',
          expect.objectContaining({ name: 'Renamed' }),
        );
        for (const call of mockEventRepo.update.mock.calls) {
          expect(call[2]).not.toHaveProperty('start_time');
          expect(call[2]).not.toHaveProperty('end_time');
        }
      });

      it('rejects a child-issued series edit that carries only times', async () => {
        // Dropping the times can empty the patch. Reporting 200 for a request
        // that wrote nothing anywhere is worse than refusing it.
        mockEventRepo.findById.mockImplementation(async (id: string) =>
          id === 'parent-1' ? parent : futureChild1,
        );

        await expect(
          service.update(
            'child-future-1',
            'ch-1',
            {
              start_time: '2026-03-22T20:00:00.000Z',
              end_time: '2026-03-22T21:00:00.000Z',
            },
            'series',
          ),
        ).rejects.toThrow(BadRequestException);
        expect(mockEventRepo.update).not.toHaveBeenCalled();
        expect(mockEventRepo.updateMany).not.toHaveBeenCalled();
      });

      it('does not invert an overnight occurrence at a month boundary', async () => {
        // start and end were clamped against their own months independently, so
        // a MONTHLY event spanning midnight could generate an occurrence ending
        // before it began — slipping past the end<=start guard that create and
        // update both enforce.
        const overnight: Event = {
          ...baseEvent,
          recurrence_rule: 'MONTHLY',
          start_time: '2027-01-29T20:00:00.000Z',
          end_time: '2027-01-30T08:00:00.000Z',
        };
        mockEventRepo.create.mockResolvedValue(overnight);

        await service.create({
          created_by: OFFICER,
          chapter_id: 'ch-1',
          name: 'Overnight',
          start_time: overnight.start_time,
          end_time: overnight.end_time,
          recurrence_rule: 'MONTHLY',
        });

        // 6 occurrences; assert generation ran before inspecting it.
        expect(occurrenceRows(mockEventRepo)).toHaveLength(6);
        for (const payload of occurrenceRows(mockEventRepo)) {
          expect(
            new Date(payload.end_time as string).getTime(),
          ).toBeGreaterThan(new Date(payload.start_time as string).getTime());
        }
      });
    });

    // The "moved" push crosses from EventSeriesService into
    // EventAnnouncementService (#3270), so both series paths assert it lands,
    // and on the row that now heads the series.
    describe('series update announcements', () => {
      beforeEach(() => {
        mockMemberRepo.findByChapter.mockResolvedValue([
          { user_id: 'user-a', role_ids: [] },
        ]);
      });

      it('announces a started-head edit on the new head, not the retired one', async () => {
        mockEventRepo.findById.mockResolvedValue(parent);
        mockEventRepo.findChildren.mockResolvedValue(wholeSeries);
        mergeUpdate([parent, ...wholeSeries]);

        await service.update(
          'parent-1',
          'ch-1',
          { location: 'Chapter House' },
          'series',
        );

        expect(mockNotificationService.notifyMembers).toHaveBeenCalledWith(
          'ch-1',
          expect.any(Array),
          expect.objectContaining({
            data: { target: { screen: 'events', eventId: 'child-future-1' } },
          }),
        );
      });

      it('announces an upcoming-head edit on the head', async () => {
        const upcomingParent: Event = {
          ...parent,
          start_time: '2026-04-01T18:00:00.000Z',
          end_time: '2026-04-01T19:00:00.000Z',
        };
        mockEventRepo.findById.mockResolvedValue(upcomingParent);
        mockEventRepo.findChildren.mockResolvedValue([]);
        mergeUpdate([upcomingParent]);

        await service.update(
          'parent-1',
          'ch-1',
          { location: 'Chapter House' },
          'series',
        );

        expect(mockNotificationService.notifyMembers).toHaveBeenCalledWith(
          'ch-1',
          expect.any(Array),
          expect.objectContaining({
            data: { target: { screen: 'events', eventId: 'parent-1' } },
          }),
        );
      });

      it('reads the addressed row once when a series edit carries times', async () => {
        const upcomingParent: Event = {
          ...parent,
          start_time: '2026-04-01T18:00:00.000Z',
          end_time: '2026-04-01T19:00:00.000Z',
        };
        mockEventRepo.findById.mockResolvedValue(upcomingParent);
        mockEventRepo.findChildren.mockResolvedValue([]);
        mergeUpdate([upcomingParent]);

        await service.update(
          'parent-1',
          'ch-1',
          { end_time: '2026-04-01T20:00:00.000Z' },
          'series',
        );

        expect(mockEventRepo.findById).toHaveBeenCalledTimes(1);
      });
    });

    // A regenerate swaps the upcoming occurrences: it inserts the new set in
    // one statement and only then deletes the old one, and on any failure it
    // reads the occurrences back rather than trusting the error (#3235).
    describe('regenerate failures (#3235)', () => {
      const upcomingParent: Event = {
        ...parent,
        start_time: '2026-03-20T18:00:00.000Z',
        end_time: '2026-03-20T19:00:00.000Z',
      };
      const upcomingChildren = [futureChild1, futureChild2];
      // MONTHLY over the generation window, as the first case pins.
      const MONTHLY_COUNT = 6;
      const landed = (headId: string, count = MONTHLY_COUNT): Event[] =>
        Array.from({ length: count }, (_, i) => ({
          ...futureChild1,
          id: `occ-${i + 1}`,
          parent_event_id: headId,
        }));
      const landedIds = landed('parent-1').map((row) => row.id);

      const changeRule = () =>
        service.update(
          'parent-1',
          'ch-1',
          { recurrence_rule: 'MONTHLY' },
          'series',
        );

      beforeEach(() => {
        mockEventRepo.findById.mockResolvedValue(upcomingParent);
        mockEventRepo.findChildren.mockResolvedValue(upcomingChildren);
        mergeUpdate([upcomingParent, ...upcomingChildren]);
      });

      it('inserts the new occurrences, then deletes the old, then writes the parent', async () => {
        await changeRule();

        const insertAt = mockEventRepo.createMany.mock.invocationCallOrder[0];
        const deleteAt =
          mockEventRepo.deleteReplacedOccurrences.mock.invocationCallOrder[0];
        const parentAt = mockEventRepo.update.mock.invocationCallOrder[0];
        expect(insertAt).toBeLessThan(deleteAt);
        expect(deleteAt).toBeLessThan(parentAt);
        expect(mockEventRepo.deleteReplacedOccurrences).toHaveBeenCalledWith(
          ['child-future-1', 'child-future-2'],
          'ch-1',
          expect.any(Array),
        );
        expect(occurrenceRows(mockEventRepo)).toHaveLength(MONTHLY_COUNT);
        for (const row of occurrenceRows(mockEventRepo)) {
          expect(row.parent_event_id).toBe('parent-1');
        }
      });

      it('changes nothing when the insert fails and nothing landed', async () => {
        mockEventRepo.createMany.mockRejectedValueOnce(
          new Error('insert failed'),
        );

        await expect(changeRule()).rejects.toThrow('insert failed');

        // The old occurrences stay, and so does the parent's old rule, so a
        // retried edit still reads as a rule change and regenerates.
        expect(mockEventRepo.deleteReplacedOccurrences).not.toHaveBeenCalled();
        expect(mockEventRepo.update).not.toHaveBeenCalled();
        expect(mockNotificationService.notifyChapter).not.toHaveBeenCalled();
      });

      it('removes rows that landed although the insert reported a failure', async () => {
        mockEventRepo.createMany.mockRejectedValueOnce(
          new Error('response lost'),
        );
        mockEventRepo.findChildren
          .mockResolvedValueOnce(upcomingChildren)
          .mockResolvedValueOnce([...upcomingChildren, ...landed('parent-1')]);

        await expect(changeRule()).rejects.toThrow('response lost');

        expect(mockEventRepo.deleteMany).toHaveBeenCalledTimes(1);
        expect(mockEventRepo.deleteMany).toHaveBeenCalledWith(
          landedIds,
          'ch-1',
        );
        expect(mockEventRepo.update).not.toHaveBeenCalled();
      });

      it('removes the new occurrences again when deleting the old ones fails', async () => {
        mockEventRepo.deleteReplacedOccurrences.mockRejectedValueOnce(
          new Error('delete failed'),
        );
        mockEventRepo.findChildren
          .mockResolvedValueOnce(upcomingChildren)
          .mockResolvedValueOnce([...upcomingChildren, ...landed('parent-1')]);

        await expect(changeRule()).rejects.toThrow('delete failed');

        expect(mockEventRepo.deleteMany).toHaveBeenLastCalledWith(
          landedIds,
          'ch-1',
        );
        expect(mockEventRepo.update).not.toHaveBeenCalled();
      });

      it('carries on when the delete reported a failure but had landed', async () => {
        mockEventRepo.deleteReplacedOccurrences.mockRejectedValueOnce(
          new Error('response lost'),
        );
        mockEventRepo.findChildren
          .mockResolvedValueOnce(upcomingChildren)
          .mockResolvedValueOnce(landed('parent-1'));

        await changeRule();

        // Reverting here would delete the only upcoming rows left.
        expect(mockEventRepo.deleteReplacedOccurrences).toHaveBeenCalledTimes(
          1,
        );
        expect(mockEventRepo.deleteMany).not.toHaveBeenCalled();
        expect(mockEventRepo.update).toHaveBeenCalledWith(
          'parent-1',
          'ch-1',
          expect.objectContaining({ recurrence_rule: 'MONTHLY' }),
        );
        reportedAt('event-series-regenerate-committed', 'warning');
      });

      it('surfaces the original error and reports the ids when the cleanup fails too', async () => {
        mockEventRepo.deleteReplacedOccurrences.mockRejectedValueOnce(
          new Error('delete failed'),
        );
        mockEventRepo.deleteMany.mockRejectedValueOnce(
          new Error('cleanup failed'),
        );
        mockEventRepo.findChildren
          .mockResolvedValueOnce(upcomingChildren)
          .mockResolvedValueOnce([...upcomingChildren, ...landed('parent-1')]);
        const logged = jest
          .spyOn(Logger.prototype, 'error')
          .mockImplementation(() => undefined);

        await expect(changeRule()).rejects.toThrow('delete failed');

        expect(logged).toHaveBeenCalledWith(
          expect.stringContaining('occ-1'),
          expect.anything(),
        );
        reportedAt('event-series-regenerate-cleanup', 'error');
        logged.mockRestore();
      });

      describe('on a started head', () => {
        beforeEach(() => {
          mockEventRepo.findById.mockResolvedValue(parent);
          mockEventRepo.findChildren
            .mockReset()
            .mockResolvedValueOnce(wholeSeries)
            .mockResolvedValue([
              { ...futureChild2, parent_event_id: 'child-future-1' },
            ]);
          mergeUpdate([parent, ...wholeSeries]);
        });

        it('re-points the survivors, rebuilds them, and writes the new rule last', async () => {
          await changeRule();

          expect(mockEventRepo.updateMany).toHaveBeenCalledWith(
            ['child-future-2'],
            'ch-1',
            { parent_event_id: 'child-future-1' },
          );
          // Promoted under the old rule while the rebuild runs.
          expect(mockEventRepo.update).toHaveBeenCalledWith(
            'child-future-1',
            'ch-1',
            expect.objectContaining({
              recurrence_rule: 'WEEKLY',
              parent_event_id: null,
            }),
          );
          const repointAt =
            mockEventRepo.updateMany.mock.invocationCallOrder.at(-1)!;
          const insertAt = mockEventRepo.createMany.mock.invocationCallOrder[0];
          const deleteAt =
            mockEventRepo.deleteReplacedOccurrences.mock.invocationCallOrder[0];
          const ruleAt = mockEventRepo.update.mock.invocationCallOrder.at(-1)!;
          expect(repointAt).toBeLessThan(insertAt);
          expect(insertAt).toBeLessThan(deleteAt);
          expect(deleteAt).toBeLessThan(ruleAt);
          expect(mockEventRepo.update).toHaveBeenLastCalledWith(
            'child-future-1',
            'ch-1',
            { recurrence_rule: 'MONTHLY' },
          );
          for (const row of occurrenceRows(mockEventRepo)) {
            expect(row.parent_event_id).toBe('child-future-1');
            expect(row.recurrence_rule).toBeNull();
          }
        });

        it('leaves a whole series under the old rule when the insert fails, so a retry still regenerates', async () => {
          mockEventRepo.createMany.mockRejectedValueOnce(
            new Error('insert failed'),
          );

          await expect(changeRule()).rejects.toThrow('insert failed');

          // The survivor hangs off the new head, not the retired one.
          expect(mockEventRepo.updateMany).toHaveBeenCalledWith(
            ['child-future-2'],
            'ch-1',
            { parent_event_id: 'child-future-1' },
          );
          expect(
            mockEventRepo.deleteReplacedOccurrences,
          ).not.toHaveBeenCalled();
          // The new head still says WEEKLY, so repeating the MONTHLY edit
          // against it reads as a rule change.
          expect(mockEventRepo.update).not.toHaveBeenCalledWith(
            'child-future-1',
            'ch-1',
            expect.objectContaining({ recurrence_rule: 'MONTHLY' }),
          );
        });
      });
    });

    // A regenerate deletes the old upcoming rows, and `event_excuses` cascades
    // with them. The delete carries each excuse to the rebuilt meeting that
    // replaces its own, and tells the member when none does (#4620).
    describe('excuses on rebuilt occurrences (#4620)', () => {
      const head: Event = {
        ...parent,
        start_time: '2026-03-20T18:00:00.000Z',
        end_time: '2026-03-20T19:00:00.000Z',
      };
      const week = (id: string, day: string): Event => ({
        ...baseEvent,
        id,
        parent_event_id: 'parent-1',
        start_time: `2026-${day}T18:00:00.000Z`,
        end_time: `2026-${day}T19:00:00.000Z`,
      });
      const next1 = week('next-1', '03-27');
      const next2 = week('next-2', '04-03');
      const next3 = week('next-3', '04-10');
      const excuse = (
        userId: string,
        eventId: string,
        status: 'PENDING' | 'APPROVED',
      ) => ({
        id: `excuse-${userId}`,
        chapter_id: 'ch-1',
        event_id: eventId,
        user_id: userId,
        reason: 'Away game',
        status,
        decided_by: status === 'APPROVED' ? OFFICER : null,
        decided_at: status === 'APPROVED' ? '2026-03-14T00:00:00.000Z' : null,
        created_at: '2026-03-14T00:00:00.000Z',
        updated_at: '2026-03-14T00:00:00.000Z',
      });

      /** The rebuilt row's id that `createMany` handed back for a start. */
      const rebuiltAt = (start: string) => {
        const rows = occurrenceRows(mockEventRepo);
        const i = rows.findIndex((row) => row.start_time === start);
        expect(i).toBeGreaterThanOrEqual(0);
        return `occ-${i + 1}`;
      };

      beforeEach(() => {
        mockEventRepo.findById.mockResolvedValue(head);
        mockEventRepo.findChildren.mockResolvedValue([next1, next2, next3]);
        mergeUpdate([head, next1, next2, next3]);
        mockMemberRepo.findByChapter.mockResolvedValue([
          { user_id: 'user-pending' },
          { user_id: 'user-approved' },
        ]);
      });

      it('carries every excuse an hour later when the series moves an hour', async () => {
        await service.update(
          'parent-1',
          'ch-1',
          {
            start_time: '2026-03-20T19:00:00.000Z',
            end_time: '2026-03-20T20:00:00.000Z',
          },
          'series',
        );

        expect(mockEventRepo.deleteReplacedOccurrences).toHaveBeenCalledWith(
          ['next-1', 'next-2', 'next-3'],
          'ch-1',
          [
            { from: 'next-1', to: rebuiltAt('2026-03-27T19:00:00.000Z') },
            { from: 'next-2', to: rebuiltAt('2026-04-03T19:00:00.000Z') },
            { from: 'next-3', to: rebuiltAt('2026-04-10T19:00:00.000Z') },
          ],
        );
        // Nothing was left behind, so nobody is asked to send one again.
        expect(mockNotificationService.notifyMembers).not.toHaveBeenCalledWith(
          'ch-1',
          expect.anything(),
          expect.objectContaining({ title: 'Send your excuse again' }),
        );
      });

      it('still pairs every meeting when one was canceled before the move', async () => {
        // One fewer old row than rebuilt ones: the pairing follows the
        // meetings, not their positions.
        mockEventRepo.findChildren.mockResolvedValue([next1, next3]);

        await service.update(
          'parent-1',
          'ch-1',
          {
            start_time: '2026-03-20T19:00:00.000Z',
            end_time: '2026-03-20T20:00:00.000Z',
          },
          'series',
        );

        expect(mockEventRepo.deleteReplacedOccurrences).toHaveBeenCalledWith(
          ['next-1', 'next-3'],
          'ch-1',
          [
            { from: 'next-1', to: rebuiltAt('2026-03-27T19:00:00.000Z') },
            { from: 'next-3', to: rebuiltAt('2026-04-10T19:00:00.000Z') },
          ],
        );
      });

      it('carries only the meetings that stay when the rule thins the series', async () => {
        // Weekly to every two weeks from 03-20: 04-03 stays, 03-27 and 04-10
        // are gone, and a pending and an approved excuse sat on 03-27.
        mockEventRepo.deleteReplacedOccurrences.mockResolvedValueOnce([
          excuse('user-pending', 'next-1', 'PENDING'),
          excuse('user-approved', 'next-1', 'APPROVED'),
        ]);

        await service.update(
          'parent-1',
          'ch-1',
          { recurrence_rule: 'BIWEEKLY' },
          'series',
        );

        expect(mockEventRepo.deleteReplacedOccurrences).toHaveBeenCalledWith(
          ['next-1', 'next-2', 'next-3'],
          'ch-1',
          [{ from: 'next-2', to: rebuiltAt('2026-04-03T18:00:00.000Z') }],
        );
        // Whoever's excuse had nowhere to go is told, once each, as soon as
        // the swap commits: before the parent write, which can still fail.
        expect(mockNotificationService.notifyMembers).toHaveBeenCalledWith(
          'ch-1',
          ['user-pending', 'user-approved'],
          expect.objectContaining({
            title: 'Send your excuse again',
            category: 'events',
            data: { target: { screen: 'events', eventId: 'parent-1' } },
          }),
        );
        const tellAt =
          mockNotificationService.notifyMembers.mock.invocationCallOrder[0];
        expect(
          mockEventRepo.deleteReplacedOccurrences.mock.invocationCallOrder[0],
        ).toBeLessThan(tellAt);
        expect(tellAt).toBeLessThan(
          mockEventRepo.update.mock.invocationCallOrder[0],
        );
      });

      it('carries every excuse a day later when the series moves a day', async () => {
        // Past the 3-hour tolerance, so only the edit's own shift pairs them.
        await service.update(
          'parent-1',
          'ch-1',
          {
            start_time: '2026-03-21T18:00:00.000Z',
            end_time: '2026-03-21T19:00:00.000Z',
          },
          'series',
        );

        expect(mockEventRepo.deleteReplacedOccurrences).toHaveBeenCalledWith(
          ['next-1', 'next-2', 'next-3'],
          'ch-1',
          [
            { from: 'next-1', to: rebuiltAt('2026-03-28T18:00:00.000Z') },
            { from: 'next-2', to: rebuiltAt('2026-04-04T18:00:00.000Z') },
            { from: 'next-3', to: rebuiltAt('2026-04-11T18:00:00.000Z') },
          ],
        );
      });

      it('still carries every excuse when a day move is retried after the parent write failed', async () => {
        // The first try swapped the rows to the new days, then the parent
        // write failed. The parent still says 03-20, so the retry counts the
        // shift again; the rows already sit where the rebuilt ones land.
        const moved = [
          week('moved-1', '03-28'),
          week('moved-2', '04-04'),
          week('moved-3', '04-11'),
        ];
        mockEventRepo.findChildren.mockResolvedValue(moved);
        mergeUpdate([head, ...moved]);

        await service.update(
          'parent-1',
          'ch-1',
          {
            start_time: '2026-03-21T18:00:00.000Z',
            end_time: '2026-03-21T19:00:00.000Z',
          },
          'series',
        );

        expect(mockEventRepo.deleteReplacedOccurrences).toHaveBeenCalledWith(
          ['moved-1', 'moved-2', 'moved-3'],
          'ch-1',
          [
            { from: 'moved-1', to: rebuiltAt('2026-03-28T18:00:00.000Z') },
            { from: 'moved-2', to: rebuiltAt('2026-04-04T18:00:00.000Z') },
            { from: 'moved-3', to: rebuiltAt('2026-04-11T18:00:00.000Z') },
          ],
        );
      });

      it('tells only current members, and says there is nothing to do when the series ended', async () => {
        mockMemberRepo.findByChapter.mockResolvedValue([
          { user_id: 'user-pending' },
        ]);
        mockEventRepo.deleteReplacedOccurrences.mockResolvedValueOnce([
          excuse('user-pending', 'next-1', 'PENDING'),
          excuse('user-left', 'next-2', 'APPROVED'),
        ]);

        await service.update(
          'parent-1',
          'ch-1',
          { recurrence_rule: null },
          'series',
        );

        expect(mockNotificationService.notifyMembers).toHaveBeenCalledWith(
          'ch-1',
          ['user-pending'],
          expect.objectContaining({ title: 'Your excuse was removed' }),
        );
      });

      it('keeps the edit when the push fails', async () => {
        mockEventRepo.deleteReplacedOccurrences.mockResolvedValueOnce([
          excuse('user-pending', 'next-1', 'PENDING'),
        ]);
        mockNotificationService.notifyMembers.mockRejectedValueOnce(
          new Error('push down'),
        );

        await expect(
          service.update(
            'parent-1',
            'ch-1',
            { recurrence_rule: 'BIWEEKLY' },
            'series',
          ),
        ).resolves.toMatchObject({ recurrence_rule: 'BIWEEKLY' });
        reportedAt('event-series-dropped-excuses-notify', 'warning');
      });

      it('carries excuses over on a started head too', async () => {
        // The split path: the head has started, `next-1` becomes the new head
        // and keeps its own excuses, and the rest are rebuilt an hour later.
        mockEventRepo.findById.mockResolvedValue(parent);
        mockEventRepo.findChildren.mockResolvedValue([
          pastChild,
          next1,
          next2,
          next3,
        ]);
        mergeUpdate([parent, pastChild, next1, next2, next3]);
        mockEventRepo.deleteReplacedOccurrences.mockResolvedValueOnce([
          excuse('user-pending', 'next-3', 'PENDING'),
        ]);

        await service.update(
          'parent-1',
          'ch-1',
          {
            start_time: '2026-03-01T19:00:00.000Z',
            end_time: '2026-03-01T20:00:00.000Z',
          },
          'series',
        );

        expect(mockEventRepo.deleteReplacedOccurrences).toHaveBeenCalledWith(
          ['next-2', 'next-3'],
          'ch-1',
          [
            { from: 'next-2', to: rebuiltAt('2026-04-03T19:00:00.000Z') },
            { from: 'next-3', to: rebuiltAt('2026-04-10T19:00:00.000Z') },
          ],
        );
        // An excuse the split path dropped is told about too, on the new head.
        expect(mockNotificationService.notifyMembers).toHaveBeenCalledWith(
          'ch-1',
          ['user-pending'],
          expect.objectContaining({
            title: 'Send your excuse again',
            data: { target: { screen: 'events', eventId: 'next-1' } },
          }),
        );
      });

      it('keeps the excuses on the old rows when the carrying delete fails', async () => {
        // The carry and the delete are one transaction, so a failure leaves
        // the excuses where they were; the recovery removes only the new rows.
        mockEventRepo.deleteReplacedOccurrences.mockRejectedValueOnce(
          new Error('delete failed'),
        );
        const landed = [0, 1, 2].map((i) => ({
          ...next1,
          id: `occ-${i + 1}`,
        }));
        mockEventRepo.findChildren
          .mockResolvedValueOnce([next1, next2, next3])
          .mockResolvedValueOnce([next1, next2, next3, ...landed]);

        await expect(
          service.update(
            'parent-1',
            'ch-1',
            { recurrence_rule: 'BIWEEKLY' },
            'series',
          ),
        ).rejects.toThrow('delete failed');

        expect(mockEventRepo.deleteMany).toHaveBeenCalledWith(
          ['occ-1', 'occ-2', 'occ-3'],
          'ch-1',
        );
        expect(mockNotificationService.notifyMembers).not.toHaveBeenCalled();
      });
    });

    describe('instance scope is the default', () => {
      it('keeps an update single-row when no scope is given', async () => {
        mockEventRepo.findById.mockResolvedValue(parent);
        mockEventRepo.update.mockResolvedValue(parent);

        await service.update('parent-1', 'ch-1', { name: 'Solo' });

        expect(mockEventRepo.findChildren).not.toHaveBeenCalled();
        expect(mockEventRepo.updateMany).not.toHaveBeenCalled();
        expect(mockEventRepo.deleteReplacedOccurrences).not.toHaveBeenCalled();
      });

      it('lets a save that sends the stored rule back through', async () => {
        // A client that sends `recurrence_rule` back on every save must not
        // have a rename judged on a rule nobody changed.
        const dated: Event = {
          ...parent,
          recurrence_rule:
            'FREQ=WEEKLY;INTERVAL=1;BYDAY=SU;UNTIL=20260305;TZID=UTC',
        };
        mockEventRepo.findById.mockResolvedValue(dated);
        mockEventRepo.update.mockResolvedValue(dated);

        await expect(
          service.update('parent-1', 'ch-1', {
            name: 'Renamed',
            recurrence_rule: dated.recurrence_rule,
          }),
        ).resolves.toBeDefined();
      });

      describe('a start moved without the rule in the request (#4515)', () => {
        // Sundays from Mar 1 to Mar 22: four meetings.
        const dated: Event = {
          ...parent,
          recurrence_rule:
            'FREQ=WEEKLY;INTERVAL=1;BYDAY=SU;UNTIL=20260322;TZID=UTC',
        };

        it('refuses a head moved past its own end date', async () => {
          mockEventRepo.findById.mockResolvedValue(dated);

          await expect(
            service.update('parent-1', 'ch-1', {
              start_time: '2026-03-22T18:00:00.000Z',
              end_time: '2026-03-22T19:00:00.000Z',
            }),
          ).rejects.toBeInstanceOf(BadRequestException);
          expect(mockEventRepo.update).not.toHaveBeenCalled();
        });

        it('leaves a stored rule it cannot read alone', async () => {
          const legacy: Event = { ...parent, recurrence_rule: 'daily' };
          mockEventRepo.findById.mockResolvedValue(legacy);
          mockEventRepo.update.mockResolvedValue(legacy);

          await expect(
            service.update('parent-1', 'ch-1', {
              start_time: '2026-03-22T18:00:00.000Z',
              end_time: '2026-03-22T19:00:00.000Z',
            }),
          ).resolves.toBeDefined();
        });

        it('lets a move that leaves room for the series through', async () => {
          mockEventRepo.findById.mockResolvedValue(dated);
          mockEventRepo.update.mockResolvedValue(dated);

          await expect(
            service.update('parent-1', 'ch-1', {
              start_time: '2026-03-08T18:00:00.000Z',
              end_time: '2026-03-08T19:00:00.000Z',
            }),
          ).resolves.toBeDefined();
        });
      });

      it('refuses an instance edit whose end date leaves no second meeting', async () => {
        mockEventRepo.findById.mockResolvedValue(parent);

        await expect(
          service.update('parent-1', 'ch-1', {
            recurrence_rule:
              'FREQ=WEEKLY;INTERVAL=1;BYDAY=SU;UNTIL=20260305;TZID=UTC',
          }),
        ).rejects.toBeInstanceOf(BadRequestException);
        expect(mockEventRepo.update).not.toHaveBeenCalled();
      });
    });
  });
});
