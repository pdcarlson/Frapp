import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { EventService } from './event.service';
import {
  EVENT_REPOSITORY,
  IEventRepository,
} from '../../domain/repositories/event.repository.interface';
import { Event } from '../../domain/entities/event.entity';
import { NotificationService } from './notification.service';
import { ChatService } from './chat.service';
import { USER_REPOSITORY } from '../../domain/repositories/user.repository.interface';

describe('EventService', () => {
  let service: EventService;
  let mockEventRepo: jest.Mocked<IEventRepository>;
  let mockNotificationService: jest.Mocked<
    Pick<NotificationService, 'notifyUser' | 'notifyChapter'>
  >;
  let mockUserRepo: { findByIds: jest.Mock };
  let mockChatService: { sendMessage: jest.Mock };

  beforeEach(async () => {
    mockEventRepo = {
      findById: jest.fn(),
      findByChapter: jest.fn(),
      findChildren: jest.fn().mockResolvedValue([]),
      create: jest.fn(),
      update: jest.fn(),
      updateMany: jest.fn().mockResolvedValue([]),
      delete: jest.fn(),
      deleteMany: jest.fn().mockResolvedValue(undefined),
    };

    mockNotificationService = {
      notifyUser: jest.fn().mockResolvedValue(undefined),
      notifyChapter: jest.fn().mockResolvedValue(undefined),
    };

    mockUserRepo = { findByIds: jest.fn().mockResolvedValue([]) };
    mockChatService = { sendMessage: jest.fn().mockResolvedValue(undefined) };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        EventService,
        { provide: EVENT_REPOSITORY, useValue: mockEventRepo },
        { provide: NotificationService, useValue: mockNotificationService },
        { provide: USER_REPOSITORY, useValue: mockUserRepo },
        { provide: ChatService, useValue: mockChatService },
      ],
    }).compile();

    service = module.get(EventService);
  });

  const baseEvent: Event = {
    id: 'evt-1',
    chapter_id: 'ch-1',
    name: 'Chapter Meeting',
    description: null,
    location: null,
    start_time: '2026-02-26T18:00:00.000Z',
    end_time: '2026-02-26T19:00:00.000Z',
    point_value: 10,
    is_mandatory: false,
    recurrence_rule: null,
    parent_event_id: null,
    required_role_ids: null,
    notes: null,
    created_at: '2026-02-26T00:00:00.000Z',
  };

  it('should find event by id', async () => {
    mockEventRepo.findById.mockResolvedValue(baseEvent);

    const result = await service.findById('evt-1', 'ch-1');

    expect(mockEventRepo.findById).toHaveBeenCalledWith('evt-1', 'ch-1');
    expect(result).toEqual(baseEvent);
  });

  it('should throw NotFoundException when event not found', async () => {
    mockEventRepo.findById.mockResolvedValue(null);

    await expect(service.findById('evt-1', 'ch-1')).rejects.toThrow(
      NotFoundException,
    );
    await expect(service.findById('evt-1', 'ch-1')).rejects.toThrow(
      'Event not found',
    );
  });

  it('should list events by chapter', async () => {
    mockEventRepo.findByChapter.mockResolvedValue([baseEvent]);

    const result = await service.findByChapter('ch-1');

    expect(mockEventRepo.findByChapter).toHaveBeenCalledWith('ch-1');
    expect(result).toEqual([baseEvent]);
  });

  it('should create an event with valid times', async () => {
    mockEventRepo.create.mockResolvedValue(baseEvent);

    const result = await service.create({
      chapter_id: 'ch-1',
      name: 'Chapter Meeting',
      start_time: baseEvent.start_time,
      end_time: baseEvent.end_time,
    });

    expect(mockEventRepo.create).toHaveBeenCalledWith({
      chapter_id: 'ch-1',
      name: 'Chapter Meeting',
      description: null,
      location: null,
      start_time: baseEvent.start_time,
      end_time: baseEvent.end_time,
      point_value: 10,
      is_mandatory: false,
      recurrence_rule: null,
      parent_event_id: null,
      required_role_ids: null,
      notes: null,
      check_in_zone: null,
      check_in_zone_name: null,
    });
    expect(result).toEqual(baseEvent);
  });

  // The check-in geofence is opt-in per event (#994), and these cases pin the
  // wire semantics documented in `spec/behavior/events.md`.
  describe('check-in zone', () => {
    const triangle = [
      { lat: 0, lng: 0 },
      { lat: 1, lng: 0 },
      { lat: 0, lng: 1 },
    ];

    it('stores a polygon supplied on create', async () => {
      mockEventRepo.create.mockResolvedValue(baseEvent);

      await service.create({
        chapter_id: 'ch-1',
        name: 'Chapter Meeting',
        start_time: baseEvent.start_time,
        end_time: baseEvent.end_time,
        check_in_zone: triangle,
        check_in_zone_name: 'Great Hall',
      });

      expect(mockEventRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({
          check_in_zone: triangle,
          check_in_zone_name: 'Great Hall',
        }),
      );
    });

    it('rejects a polygon that cannot enclose anything', async () => {
      // 400 from the service rather than a 500 surfacing from the table's
      // shape CHECK constraint.
      await expect(
        service.create({
          chapter_id: 'ch-1',
          name: 'Chapter Meeting',
          start_time: baseEvent.start_time,
          end_time: baseEvent.end_time,
          check_in_zone: [{ lat: 0, lng: 0 }],
        }),
      ).rejects.toThrow(BadRequestException);
      expect(mockEventRepo.create).not.toHaveBeenCalled();
    });

    it('clears the zone when update sends an empty array', async () => {
      // Same "empty array clears" rule `required_role_ids` already documents.
      mockEventRepo.update.mockResolvedValue(baseEvent);

      await service.update('evt-1', 'ch-1', { check_in_zone: [] });

      expect(mockEventRepo.update).toHaveBeenCalledWith(
        'evt-1',
        'ch-1',
        expect.objectContaining({ check_in_zone: null }),
      );
    });

    it('leaves an existing zone untouched when update omits it', async () => {
      mockEventRepo.update.mockResolvedValue(baseEvent);

      await service.update('evt-1', 'ch-1', { name: 'Renamed' });

      const patch = mockEventRepo.update.mock.calls[0][2] as Record<
        string,
        unknown
      >;
      expect('check_in_zone' in patch).toBe(false);
    });
  });

  it('should reject invalid date range on create', async () => {
    await expect(
      service.create({
        chapter_id: 'ch-1',
        name: 'Invalid Event',
        start_time: '2026-02-26T19:00:00.000Z',
        end_time: '2026-02-26T18:00:00.000Z',
      }),
    ).rejects.toThrow(BadRequestException);
  });

  it('should validate updated times on update', async () => {
    mockEventRepo.findById.mockResolvedValue(baseEvent);
    mockEventRepo.update.mockResolvedValue({
      ...baseEvent,
      end_time: '2026-02-26T20:00:00.000Z',
    });

    const result = await service.update('evt-1', 'ch-1', {
      end_time: '2026-02-26T20:00:00.000Z',
    });

    expect(mockEventRepo.update).toHaveBeenCalledWith('evt-1', 'ch-1', {
      end_time: '2026-02-26T20:00:00.000Z',
    });
    expect(result.end_time).toBe('2026-02-26T20:00:00.000Z');
  });

  it('should reject invalid updated times on update', async () => {
    mockEventRepo.findById.mockResolvedValue(baseEvent);

    await expect(
      service.update('evt-1', 'ch-1', {
        end_time: '2026-02-26T17:00:00.000Z',
      }),
    ).rejects.toThrow(BadRequestException);
  });

  it('should delete event', async () => {
    mockEventRepo.delete.mockResolvedValue();

    await service.delete('evt-1', 'ch-1');

    expect(mockEventRepo.delete).toHaveBeenCalledWith('evt-1', 'ch-1');
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
        chapter_id: 'ch-1',
        name: 'Chapter Meeting',
        start_time: baseEvent.start_time,
        end_time: baseEvent.end_time,
        recurrence_rule: 'WEEKLY',
      });

      // 1 parent + 12 instances = 13 total create calls
      expect(mockEventRepo.create).toHaveBeenCalledTimes(13);

      // Verify first instance has correct parent_event_id and null recurrence_rule
      const secondCall = mockEventRepo.create.mock.calls[1][0];
      expect(secondCall.parent_event_id).toBe('evt-1');
      expect(secondCall.recurrence_rule).toBeNull();

      // Verify start_time is 7 days after parent for the first instance
      const parentStart = new Date(baseEvent.start_time);
      const expectedStart = new Date(parentStart);
      expectedStart.setDate(expectedStart.getDate() + 7);
      expect(secondCall.start_time).toBe(expectedStart.toISOString());
    });

    it('should generate 6 instances for BIWEEKLY recurrence', async () => {
      const biweeklyEvent: Event = {
        ...baseEvent,
        recurrence_rule: 'BIWEEKLY',
      };
      mockEventRepo.create.mockResolvedValue(biweeklyEvent);

      await service.create({
        chapter_id: 'ch-1',
        name: 'Chapter Meeting',
        start_time: baseEvent.start_time,
        end_time: baseEvent.end_time,
        recurrence_rule: 'BIWEEKLY',
      });

      // 1 parent + 6 instances = 7 total create calls
      expect(mockEventRepo.create).toHaveBeenCalledTimes(7);

      const secondCall = mockEventRepo.create.mock.calls[1][0];
      expect(secondCall.parent_event_id).toBe('evt-1');
      expect(secondCall.recurrence_rule).toBeNull();

      // Verify start_time is 14 days after parent for the first instance
      const parentStart = new Date(baseEvent.start_time);
      const expectedStart = new Date(parentStart);
      expectedStart.setDate(expectedStart.getDate() + 14);
      expect(secondCall.start_time).toBe(expectedStart.toISOString());
    });

    it('should generate 6 instances for MONTHLY recurrence', async () => {
      const monthlyEvent: Event = {
        ...baseEvent,
        recurrence_rule: 'MONTHLY',
      };
      mockEventRepo.create.mockResolvedValue(monthlyEvent);

      await service.create({
        chapter_id: 'ch-1',
        name: 'Chapter Meeting',
        start_time: baseEvent.start_time,
        end_time: baseEvent.end_time,
        recurrence_rule: 'MONTHLY',
      });

      // 1 parent + 6 instances = 7 total create calls
      expect(mockEventRepo.create).toHaveBeenCalledTimes(7);

      const secondCall = mockEventRepo.create.mock.calls[1][0];
      expect(secondCall.parent_event_id).toBe('evt-1');
      expect(secondCall.recurrence_rule).toBeNull();

      // Verify start_time is 1 month after parent for the first instance
      const parentStart = new Date(baseEvent.start_time);
      const expectedStart = new Date(parentStart);
      expectedStart.setMonth(expectedStart.getMonth() + 1);
      expect(secondCall.start_time).toBe(expectedStart.toISOString());
    });

    it('each instance should have correct parent_event_id and null recurrence_rule', async () => {
      const weeklyEvent: Event = {
        ...baseEvent,
        recurrence_rule: 'WEEKLY',
      };
      mockEventRepo.create.mockResolvedValue(weeklyEvent);

      await service.create({
        chapter_id: 'ch-1',
        name: 'Chapter Meeting',
        start_time: baseEvent.start_time,
        end_time: baseEvent.end_time,
        recurrence_rule: 'WEEKLY',
      });

      for (let i = 1; i <= 12; i++) {
        const call = mockEventRepo.create.mock.calls[i][0];
        expect(call.parent_event_id).toBe('evt-1');
        expect(call.recurrence_rule).toBeNull();
      }
    });

    it('should not generate instances when no recurrence_rule is set', async () => {
      mockEventRepo.create.mockResolvedValue(baseEvent);

      await service.create({
        chapter_id: 'ch-1',
        name: 'Chapter Meeting',
        start_time: baseEvent.start_time,
        end_time: baseEvent.end_time,
      });

      expect(mockEventRepo.create).toHaveBeenCalledTimes(1);
    });
  });

  describe('generateIcs', () => {
    it('should generate ICS with correct dates, title, and wrapping', async () => {
      const event: Event = {
        ...baseEvent,
        name: 'Chapter Meeting',
        location: 'Chapter House',
        description: 'Weekly meeting',
      };
      mockEventRepo.findById.mockResolvedValue(event);

      const ics = await service.generateIcs('evt-1', 'ch-1');

      expect(ics).toContain('BEGIN:VCALENDAR');
      expect(ics).toContain('END:VCALENDAR');
      expect(ics).toContain('BEGIN:VEVENT');
      expect(ics).toContain('END:VEVENT');
      expect(ics).toContain('SUMMARY:Chapter Meeting');
      expect(ics).toContain('LOCATION:Chapter House');
      expect(ics).toContain('DESCRIPTION:Weekly meeting');
      expect(ics).toContain('UID:evt-1@frapp.live');
      expect(ics).toContain('DTSTART:');
      expect(ics).toContain('DTEND:');
      expect(ics).toContain('VERSION:2.0');
      expect(ics).toContain('PRODID:-//Frapp//Events//EN');
    });

    it('should omit DESCRIPTION and LOCATION when null', async () => {
      mockEventRepo.findById.mockResolvedValue(baseEvent);

      const ics = await service.generateIcs('evt-1', 'ch-1');

      expect(ics).not.toContain('DESCRIPTION:');
      expect(ics).not.toContain('LOCATION:');
    });
  });

  describe('notifications', () => {
    it('should notify chapter when event is created', async () => {
      mockEventRepo.create.mockResolvedValue(baseEvent);

      await service.create({
        chapter_id: 'ch-1',
        name: 'Chapter Meeting',
        start_time: baseEvent.start_time,
        end_time: baseEvent.end_time,
      });

      expect(mockNotificationService.notifyChapter).toHaveBeenCalledWith(
        'ch-1',
        expect.objectContaining({
          title: 'New Event',
          priority: 'SILENT',
          category: 'events',
        }),
      );
    });

    it('should notify chapter when event time is updated', async () => {
      mockEventRepo.findById.mockResolvedValue(baseEvent);
      mockEventRepo.update.mockResolvedValue({
        ...baseEvent,
        end_time: '2026-02-26T20:00:00.000Z',
      });

      await service.update('evt-1', 'ch-1', {
        end_time: '2026-02-26T20:00:00.000Z',
      });

      expect(mockNotificationService.notifyChapter).toHaveBeenCalledWith(
        'ch-1',
        expect.objectContaining({
          title: 'Event Updated',
          priority: 'NORMAL',
          category: 'events',
        }),
      );
    });

    it('should notify chapter when event location is updated', async () => {
      mockEventRepo.update.mockResolvedValue({
        ...baseEvent,
        location: 'New Location',
      });

      await service.update('evt-1', 'ch-1', {
        location: 'New Location',
      });

      expect(mockNotificationService.notifyChapter).toHaveBeenCalledWith(
        'ch-1',
        expect.objectContaining({
          title: 'Event Updated',
          priority: 'NORMAL',
          category: 'events',
        }),
      );
    });

    it('should not fail if notification throws on create', async () => {
      mockEventRepo.create.mockResolvedValue(baseEvent);
      mockNotificationService.notifyChapter.mockRejectedValue(
        new Error('push failed'),
      );

      const result = await service.create({
        chapter_id: 'ch-1',
        name: 'Chapter Meeting',
        start_time: baseEvent.start_time,
        end_time: baseEvent.end_time,
      });

      expect(result).toEqual(baseEvent);
    });
  });

  describe('event card (slash command)', () => {
    const chatInput = {
      chapter_id: 'ch-1',
      name: 'Spring Formal',
      start_time: baseEvent.start_time,
      end_time: baseEvent.end_time,
      created_by: 'user-1',
      channel_id: 'chan-1',
      client_message_id: 'cmid-1',
    };

    it('posts a server-originated event card when chat fields are present', async () => {
      mockEventRepo.create.mockResolvedValue(baseEvent);
      mockUserRepo.findByIds.mockResolvedValue([
        { id: 'user-1', display_name: 'Alice' },
      ]);

      await service.create(chatInput);

      expect(mockChatService.sendMessage).toHaveBeenCalledTimes(1);
      const arg = mockChatService.sendMessage.mock.calls[0][0];
      expect(arg).toMatchObject({
        chapter_id: 'ch-1',
        channel_id: 'chan-1',
        sender_id: 'user-1',
        kind: 'event',
        client_message_id: 'cmid-1',
        system_originated: true,
      });
      expect(arg.payload).toMatchObject({
        event_id: 'evt-1',
        name: 'Chapter Meeting',
        point_value: 10,
        location: null,
        is_mandatory: false,
      });
      expect(arg.content).toContain('Chapter Meeting');
    });

    it('does not post a card for a dashboard create (no chat fields)', async () => {
      mockEventRepo.create.mockResolvedValue(baseEvent);

      await service.create({
        chapter_id: 'ch-1',
        name: 'Chapter Meeting',
        start_time: baseEvent.start_time,
        end_time: baseEvent.end_time,
      });

      expect(mockChatService.sendMessage).not.toHaveBeenCalled();
    });

    it('is best-effort: a failed card post still returns the event', async () => {
      mockEventRepo.create.mockResolvedValue(baseEvent);
      mockUserRepo.findByIds.mockResolvedValue([
        { id: 'user-1', display_name: 'Alice' },
      ]);
      mockChatService.sendMessage.mockRejectedValue(new Error('chat down'));

      const result = await service.create(chatInput);

      expect(result).toEqual(baseEvent);
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

    describe('series update', () => {
      it('applies the edit to future instances only', async () => {
        mockEventRepo.findById.mockResolvedValue(parent);
        mockEventRepo.findChildren.mockResolvedValue(wholeSeries);
        mockEventRepo.update.mockResolvedValue({ ...parent, name: 'Renamed' });

        await service.update('parent-1', 'ch-1', { name: 'Renamed' }, 'series');

        expect(mockEventRepo.updateMany).toHaveBeenCalledWith(
          ['child-future-1', 'child-future-2'],
          'ch-1',
          { name: 'Renamed' },
        );
        expect(mockEventRepo.deleteMany).not.toHaveBeenCalled();
      });

      it('never includes a past instance in the write set', async () => {
        mockEventRepo.findById.mockResolvedValue(parent);
        mockEventRepo.findChildren.mockResolvedValue(wholeSeries);
        mockEventRepo.update.mockResolvedValue(parent);

        await service.update('parent-1', 'ch-1', { name: 'Renamed' }, 'series');

        const [ids] = mockEventRepo.updateMany.mock.calls[0];
        expect(ids).not.toContain('child-past');
      });

      it('regenerates future instances when the recurrence rule changes', async () => {
        mockEventRepo.findById.mockResolvedValue(parent);
        mockEventRepo.findChildren.mockResolvedValue(wholeSeries);
        mockEventRepo.update.mockResolvedValue({
          ...parent,
          recurrence_rule: 'MONTHLY',
        });
        mockEventRepo.create.mockResolvedValue(baseEvent);

        await service.update(
          'parent-1',
          'ch-1',
          { recurrence_rule: 'MONTHLY' },
          'series',
        );

        expect(mockEventRepo.deleteMany).toHaveBeenCalledWith(
          ['child-future-1', 'child-future-2'],
          'ch-1',
        );
        expect(mockEventRepo.create).toHaveBeenCalledTimes(6);
      });

      // The web editor PATCHes the whole event back on every save, so an
      // unchanged rule arrives on the wire constantly. Regenerating on presence
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

        expect(mockEventRepo.deleteMany).not.toHaveBeenCalled();
        expect(mockEventRepo.create).not.toHaveBeenCalled();
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

        expect(mockEventRepo.deleteMany).not.toHaveBeenCalled();
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
        mockEventRepo.update.mockResolvedValue(parent);

        await service.update('child-future-1', 'ch-1', { name: 'X' }, 'series');

        expect(mockEventRepo.update).toHaveBeenCalledWith(
          'parent-1',
          'ch-1',
          expect.objectContaining({ name: 'X' }),
        );
        expect(mockEventRepo.findChildren).toHaveBeenCalledWith(
          'parent-1',
          'ch-1',
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

        expect(mockEventRepo.update).toHaveBeenCalledWith(
          'child-past',
          'ch-1',
          {
            recurrence_rule: 'WEEKLY',
            parent_event_id: null,
          },
        );
        expect(mockEventRepo.updateMany).toHaveBeenCalledWith(
          ['child-future-1', 'child-future-2'],
          'ch-1',
          { parent_event_id: 'child-past' },
        );
        expect(mockEventRepo.delete).toHaveBeenCalledWith('parent-1', 'ch-1');
      });

      it('leaves a non-recurring event as a plain single-row delete', async () => {
        mockEventRepo.findById.mockResolvedValue(baseEvent);

        await service.delete('evt-1', 'ch-1');

        expect(mockEventRepo.findChildren).not.toHaveBeenCalled();
        expect(mockEventRepo.delete).toHaveBeenCalledWith('evt-1', 'ch-1');
      });
    });

    describe('instance scope is the default', () => {
      it('keeps an update single-row when no scope is given', async () => {
        mockEventRepo.findById.mockResolvedValue(parent);
        mockEventRepo.update.mockResolvedValue(parent);

        await service.update('parent-1', 'ch-1', { name: 'Solo' });

        expect(mockEventRepo.findChildren).not.toHaveBeenCalled();
        expect(mockEventRepo.updateMany).not.toHaveBeenCalled();
        expect(mockEventRepo.deleteMany).not.toHaveBeenCalled();
      });
    });
  });
});
