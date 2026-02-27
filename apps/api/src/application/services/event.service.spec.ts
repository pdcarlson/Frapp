import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { EventService } from './event.service';
import {
  EVENT_REPOSITORY,
  IEventRepository,
} from '../../domain/repositories/event.repository.interface';
import { Event } from '../../domain/entities/event.entity';
import { NotificationService } from './notification.service';

describe('EventService', () => {
  let service: EventService;
  let mockEventRepo: jest.Mocked<IEventRepository>;
  let mockNotificationService: jest.Mocked<
    Pick<NotificationService, 'notifyUser' | 'notifyChapter'>
  >;

  beforeEach(async () => {
    mockEventRepo = {
      findById: jest.fn(),
      findByChapter: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
      delete: jest.fn(),
    };

    mockNotificationService = {
      notifyUser: jest.fn().mockResolvedValue(undefined),
      notifyChapter: jest.fn().mockResolvedValue(undefined),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        EventService,
        { provide: EVENT_REPOSITORY, useValue: mockEventRepo },
        { provide: NotificationService, useValue: mockNotificationService },
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
    });
    expect(result).toEqual(baseEvent);
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
});
