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
import { MEMBER_REPOSITORY } from '../../domain/repositories/member.repository.interface';
import { RbacService } from './rbac.service';

describe('EventService', () => {
  let service: EventService;
  let mockEventRepo: jest.Mocked<IEventRepository>;
  let mockNotificationService: jest.Mocked<
    Pick<NotificationService, 'notifyUser' | 'notifyChapter'>
  >;
  let mockUserRepo: { findByIds: jest.Mock };
  let mockMemberRepo: {
    findByUserAndChapter: jest.Mock;
    findByChapter: jest.Mock;
  };
  let mockChatService: { sendMessage: jest.Mock };
  let mockRbacService: { memberHasAnyPermission: jest.Mock };

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
    mockMemberRepo = {
      findByUserAndChapter: jest.fn().mockResolvedValue(null),
      findByChapter: jest.fn().mockResolvedValue([]),
    };
    mockChatService = { sendMessage: jest.fn().mockResolvedValue(undefined) };
    mockRbacService = {
      memberHasAnyPermission: jest.fn().mockResolvedValue(false),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        EventService,
        { provide: EVENT_REPOSITORY, useValue: mockEventRepo },
        { provide: NotificationService, useValue: mockNotificationService },
        { provide: USER_REPOSITORY, useValue: mockUserRepo },
        { provide: MEMBER_REPOSITORY, useValue: mockMemberRepo },
        { provide: ChatService, useValue: mockChatService },
        { provide: RbacService, useValue: mockRbacService },
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

  // Role-targeted read visibility (#1463): a role-targeted event is invisible
  // to a viewer without an intersecting role. No `viewerId` (internal callers
  // like `update`/`delete`) must skip filtering entirely — those routes are
  // already gated on a stronger management permission.
  describe('role-targeted read visibility', () => {
    const targetedEvent: Event = {
      ...baseEvent,
      id: 'evt-targeted',
      required_role_ids: ['role-officer'],
    };

    describe('findByChapter', () => {
      it('omits nothing when no viewerId is supplied (internal callers)', async () => {
        mockEventRepo.findByChapter.mockResolvedValue([
          baseEvent,
          targetedEvent,
        ]);

        const result = await service.findByChapter('ch-1');

        expect(mockMemberRepo.findByUserAndChapter).not.toHaveBeenCalled();
        expect(result).toEqual([baseEvent, targetedEvent]);
      });

      it('drops a role-targeted event for a viewer without a matching role', async () => {
        mockEventRepo.findByChapter.mockResolvedValue([
          baseEvent,
          targetedEvent,
        ]);
        mockMemberRepo.findByUserAndChapter.mockResolvedValue({
          role_ids: ['role-member'],
        });

        const result = await service.findByChapter('ch-1', 'user-1');

        expect(result).toEqual([baseEvent]);
      });

      it('keeps a role-targeted event for a viewer with a matching role', async () => {
        mockEventRepo.findByChapter.mockResolvedValue([targetedEvent]);
        mockMemberRepo.findByUserAndChapter.mockResolvedValue({
          role_ids: ['role-officer'],
        });

        const result = await service.findByChapter('ch-1', 'user-1');

        expect(result).toEqual([targetedEvent]);
      });

      it('drops a role-targeted event when the viewer is not a chapter member', async () => {
        mockEventRepo.findByChapter.mockResolvedValue([targetedEvent]);
        mockMemberRepo.findByUserAndChapter.mockResolvedValue(null);

        const result = await service.findByChapter('ch-1', 'user-1');

        expect(result).toEqual([]);
      });

      it('treats an empty required_role_ids array as untargeted', async () => {
        const emptyArrayEvent: Event = {
          ...baseEvent,
          id: 'evt-empty',
          required_role_ids: [],
        };
        mockEventRepo.findByChapter.mockResolvedValue([emptyArrayEvent]);
        mockMemberRepo.findByUserAndChapter.mockResolvedValue({
          role_ids: [],
        });

        const result = await service.findByChapter('ch-1', 'user-1');

        expect(result).toEqual([emptyArrayEvent]);
      });

      it('keeps a role-targeted event for a viewer holding events:update, regardless of role', async () => {
        mockEventRepo.findByChapter.mockResolvedValue([targetedEvent]);
        mockRbacService.memberHasAnyPermission.mockResolvedValue(true);

        const result = await service.findByChapter('ch-1', 'user-1');

        expect(result).toEqual([targetedEvent]);
        expect(mockMemberRepo.findByUserAndChapter).not.toHaveBeenCalled();
        expect(mockRbacService.memberHasAnyPermission).toHaveBeenCalledWith(
          'ch-1',
          'user-1',
          expect.arrayContaining(['events:update']),
        );
      });

      it('skips the permission and member lookups when nothing is role-targeted', async () => {
        mockEventRepo.findByChapter.mockResolvedValue([baseEvent]);

        const result = await service.findByChapter('ch-1', 'user-1');

        expect(result).toEqual([baseEvent]);
        expect(mockRbacService.memberHasAnyPermission).not.toHaveBeenCalled();
        expect(mockMemberRepo.findByUserAndChapter).not.toHaveBeenCalled();
      });
    });

    describe('findById', () => {
      it('returns the event when no viewerId is supplied (internal callers)', async () => {
        mockEventRepo.findById.mockResolvedValue(targetedEvent);

        const result = await service.findById('evt-targeted', 'ch-1');

        expect(mockMemberRepo.findByUserAndChapter).not.toHaveBeenCalled();
        expect(result).toEqual(targetedEvent);
      });

      it('404s a role-targeted event for a viewer without a matching role', async () => {
        mockEventRepo.findById.mockResolvedValue(targetedEvent);
        mockMemberRepo.findByUserAndChapter.mockResolvedValue({
          role_ids: ['role-member'],
        });

        await expect(
          service.findById('evt-targeted', 'ch-1', 'user-1'),
        ).rejects.toThrow(NotFoundException);
      });

      it('returns a role-targeted event for a viewer with a matching role', async () => {
        mockEventRepo.findById.mockResolvedValue(targetedEvent);
        mockMemberRepo.findByUserAndChapter.mockResolvedValue({
          role_ids: ['role-officer'],
        });

        const result = await service.findById('evt-targeted', 'ch-1', 'user-1');

        expect(result).toEqual(targetedEvent);
      });

      it('returns an untargeted event to any viewer without a member lookup', async () => {
        mockEventRepo.findById.mockResolvedValue(baseEvent);

        const result = await service.findById('evt-1', 'ch-1', 'user-1');

        expect(mockMemberRepo.findByUserAndChapter).not.toHaveBeenCalled();
        expect(result).toEqual(baseEvent);
      });

      it('treats an empty required_role_ids array as untargeted', async () => {
        const emptyArrayEvent: Event = {
          ...baseEvent,
          id: 'evt-empty',
          required_role_ids: [],
        };
        mockEventRepo.findById.mockResolvedValue(emptyArrayEvent);

        const result = await service.findById('evt-empty', 'ch-1', 'user-1');

        expect(mockMemberRepo.findByUserAndChapter).not.toHaveBeenCalled();
        expect(result).toEqual(emptyArrayEvent);
      });

      it('returns a role-targeted event for a viewer holding events:update, regardless of role', async () => {
        mockEventRepo.findById.mockResolvedValue(targetedEvent);
        mockRbacService.memberHasAnyPermission.mockResolvedValue(true);

        const result = await service.findById('evt-targeted', 'ch-1', 'user-1');

        expect(result).toEqual(targetedEvent);
        expect(mockMemberRepo.findByUserAndChapter).not.toHaveBeenCalled();
      });
    });
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
      expect(mockEventRepo.create).toHaveBeenCalledTimes(13);
      for (let i = 1; i <= 12; i++) {
        const call = mockEventRepo.create.mock.calls[i][0];
        expect(call.check_in_zone).toEqual(zone);
        expect(call.check_in_zone_name).toBe('Great Hall');
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

    it('404s a role-targeted event export for a viewer without a matching role', async () => {
      mockEventRepo.findById.mockResolvedValue({
        ...baseEvent,
        required_role_ids: ['role-officer'],
      });
      mockMemberRepo.findByUserAndChapter.mockResolvedValue({
        role_ids: ['role-member'],
      });

      await expect(
        service.generateIcs('evt-1', 'ch-1', 'user-1'),
      ).rejects.toThrow(NotFoundException);
    });

    it('generates the ICS for a role-targeted event when the viewer holds the role', async () => {
      mockEventRepo.findById.mockResolvedValue({
        ...baseEvent,
        name: 'Exec Meeting',
        required_role_ids: ['role-officer'],
      });
      mockMemberRepo.findByUserAndChapter.mockResolvedValue({
        role_ids: ['role-officer'],
      });

      const ics = await service.generateIcs('evt-1', 'ch-1', 'user-1');

      expect(ics).toContain('SUMMARY:Exec Meeting');
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

    // A role-targeted event's "New Event"/"Event Updated" push must not name
    // it to a member who now correctly 404s reading the event itself (#1463)
    // — only members whose role_ids intersect required_role_ids are notified.
    describe('role-targeted notifications (#1463)', () => {
      it('notifies only eligible members when a role-targeted event is created', async () => {
        mockEventRepo.create.mockResolvedValue({
          ...baseEvent,
          name: 'Exec Meeting',
          required_role_ids: ['role-officer'],
        });
        mockMemberRepo.findByChapter.mockResolvedValue([
          { user_id: 'user-officer', role_ids: ['role-officer'] },
          { user_id: 'user-member', role_ids: ['role-member'] },
        ]);

        await service.create({
          chapter_id: 'ch-1',
          name: 'Exec Meeting',
          start_time: baseEvent.start_time,
          end_time: baseEvent.end_time,
          required_role_ids: ['role-officer'],
        });

        expect(mockNotificationService.notifyChapter).not.toHaveBeenCalled();
        expect(mockNotificationService.notifyUser).toHaveBeenCalledTimes(1);
        expect(mockNotificationService.notifyUser).toHaveBeenCalledWith(
          'user-officer',
          'ch-1',
          expect.objectContaining({ title: 'New Event' }),
        );
      });

      it('notifies only eligible members when a role-targeted event is updated', async () => {
        mockEventRepo.update.mockResolvedValue({
          ...baseEvent,
          name: 'Exec Meeting',
          required_role_ids: ['role-officer'],
          location: 'New Location',
        });
        mockMemberRepo.findByChapter.mockResolvedValue([
          { user_id: 'user-officer', role_ids: ['role-officer'] },
          { user_id: 'user-member', role_ids: ['role-member'] },
        ]);

        await service.update('evt-1', 'ch-1', { location: 'New Location' });

        expect(mockNotificationService.notifyChapter).not.toHaveBeenCalled();
        expect(mockNotificationService.notifyUser).toHaveBeenCalledTimes(1);
        expect(mockNotificationService.notifyUser).toHaveBeenCalledWith(
          'user-officer',
          'ch-1',
          expect.objectContaining({ title: 'Event Updated' }),
        );
      });
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

    // #1469: the card is broadcast to every reader of the channel, so it would
    // show an ineligible member exactly what #1463 made `GET /v1/events/:id`
    // 404 to hide. Refused before the write, so no event row is orphaned.
    describe('role-targeted events (#1469)', () => {
      it('refuses to create a role-targeted event that asks for a card', async () => {
        await expect(
          service.create({ ...chatInput, required_role_ids: ['role-officer'] }),
        ).rejects.toThrow(BadRequestException);

        expect(mockEventRepo.create).not.toHaveBeenCalled();
        expect(mockChatService.sendMessage).not.toHaveBeenCalled();
      });

      // Neither half posts a card on its own today, but accepting the pair
      // piecemeal would make the guard depend on which key a caller omitted.
      // `it.each` rather than a loop so a regression on one key names that key
      // instead of aborting the other case.
      it.each([
        ['channel_id only', { channel_id: 'chan-1' }],
        ['client_message_id only', { client_message_id: 'cmid-1' }],
      ])('refuses a role-targeted event with %s', async (_label, chatKeys) => {
        await expect(
          service.create({
            chapter_id: 'ch-1',
            name: 'Exec Review',
            start_time: baseEvent.start_time,
            end_time: baseEvent.end_time,
            created_by: 'user-1',
            required_role_ids: ['role-officer'],
            ...chatKeys,
          }),
        ).rejects.toThrow(BadRequestException);

        expect(mockEventRepo.create).not.toHaveBeenCalled();
        expect(mockChatService.sendMessage).not.toHaveBeenCalled();
      });

      it('still posts a card when required_role_ids is an empty array', async () => {
        // `[]` is untargeted per the spec's wire semantics, so it must not be
        // caught by a truthiness check on the array itself.
        mockEventRepo.create.mockResolvedValue(baseEvent);
        mockUserRepo.findByIds.mockResolvedValue([
          { id: 'user-1', display_name: 'Alice' },
        ]);

        await service.create({ ...chatInput, required_role_ids: [] });

        expect(mockChatService.sendMessage).toHaveBeenCalledTimes(1);
      });

      it('still creates a role-targeted event with no card requested', async () => {
        // The dashboard path — role targeting is a supported feature; only the
        // broadcast surface is refused. The stub must return a *targeted* row:
        // `create` feeds the returned row's `required_role_ids` into
        // `notifyEligibleMembers`, so resolving the untargeted `baseEvent`
        // here would silently exercise the chapter-wide notification branch.
        mockEventRepo.create.mockResolvedValue({
          ...baseEvent,
          required_role_ids: ['role-officer'],
        });

        await service.create({
          chapter_id: 'ch-1',
          name: 'Exec Review',
          start_time: baseEvent.start_time,
          end_time: baseEvent.end_time,
          required_role_ids: ['role-officer'],
        });

        expect(mockEventRepo.create).toHaveBeenCalledTimes(1);
        expect(mockChatService.sendMessage).not.toHaveBeenCalled();
      });
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
        expect(mockEventRepo.deleteMany).not.toHaveBeenCalled();
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
        expect(mockEventRepo.deleteMany).not.toHaveBeenCalled();
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
        expect(mockEventRepo.deleteMany).toHaveBeenCalledWith(
          ['child-future-2'],
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

        const createdStarts = mockEventRepo.create.mock.calls.map(([payload]) =>
          new Date(payload.start_time as string).getTime(),
        );
        expect(createdStarts.length).toBeGreaterThan(0);
        for (const started of createdStarts) {
          expect(started).toBeGreaterThan(NOW);
        }
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
        expect(mockEventRepo.deleteMany).not.toHaveBeenCalled();
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

        expect(mockEventRepo.create).toHaveBeenCalledTimes(6);
        for (const [payload] of mockEventRepo.create.mock.calls) {
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
        expect(mockEventRepo.deleteMany).not.toHaveBeenCalled();
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
        expect(mockEventRepo.deleteMany).not.toHaveBeenCalled();
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

      it('leaves a non-recurring event as a plain single-row delete', async () => {
        mockEventRepo.findById.mockResolvedValue(baseEvent);

        await service.delete('evt-1', 'ch-1');

        expect(mockEventRepo.findChildren).not.toHaveBeenCalled();
        expect(mockEventRepo.delete).toHaveBeenCalledWith('evt-1', 'ch-1');
      });
    });

    // Each case below is a defect this branch's review found in #1358 and
    // fixes. Every one was reproduced against the unfixed code first.
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
        expect(mockEventRepo.create).toHaveBeenCalledTimes(6);
        for (const [payload] of mockEventRepo.create.mock.calls) {
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

        expect(mockEventRepo.deleteMany).not.toHaveBeenCalled();
        expect(mockEventRepo.update).not.toHaveBeenCalled();
      });

      it('ignores the times on a series edit issued from a child', async () => {
        // Clients round-trip the whole event object, so a rename saved from a
        // later occurrence arrived carrying that occurrence's start_time. That
        // is not a request to move the series.
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
        expect(mockEventRepo.deleteMany).not.toHaveBeenCalled();
        expect(mockEventRepo.create).not.toHaveBeenCalled();
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
        // update both enforce, and emitting DTEND before DTSTART in its .ics.
        const overnight: Event = {
          ...baseEvent,
          recurrence_rule: 'MONTHLY',
          start_time: '2027-01-29T20:00:00.000Z',
          end_time: '2027-01-30T08:00:00.000Z',
        };
        mockEventRepo.create.mockResolvedValue(overnight);

        await service.create({
          chapter_id: 'ch-1',
          name: 'Overnight',
          start_time: overnight.start_time,
          end_time: overnight.end_time,
          recurrence_rule: 'MONTHLY',
        });

        // 1 parent + 6 occurrences; assert generation ran before inspecting it.
        expect(mockEventRepo.create).toHaveBeenCalledTimes(7);
        for (let i = 1; i <= 6; i++) {
          const payload = mockEventRepo.create.mock.calls[i][0];
          expect(
            new Date(payload.end_time as string).getTime(),
          ).toBeGreaterThan(new Date(payload.start_time as string).getTime());
        }
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
