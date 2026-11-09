import { BadRequestException, NotFoundException } from '@nestjs/common';
import { Event } from '#domain/entities/event.entity';
import {
  baseEvent,
  createEventServiceFixture,
  type EventServiceFixture,
} from '#test/helpers/event-service.fixture';

describe('EventService', () => {
  let service: EventServiceFixture['service'];
  let mockEventRepo: EventServiceFixture['mockEventRepo'];
  let mockMemberRepo: EventServiceFixture['mockMemberRepo'];
  let mockRbacService: EventServiceFixture['mockRbacService'];

  beforeEach(async () => {
    ({ service, mockEventRepo, mockMemberRepo, mockRbacService } =
      await createEventServiceFixture());
  });

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
      others_invited: false,
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

      // Attendance by role: "required for officers, optional for everyone
      // else" names a role without hiding the event from anyone.
      it('keeps an event required for one role when everyone else is invited', async () => {
        const mixed: Event = {
          ...baseEvent,
          id: 'evt-mixed',
          required_role_ids: ['role-officer'],
          others_invited: true,
        };
        mockEventRepo.findByChapter.mockResolvedValue([mixed]);

        const result = await service.findByChapter('ch-1', 'user-1');

        expect(result).toEqual([mixed]);
        expect(mockMemberRepo.findByUserAndChapter).not.toHaveBeenCalled();
      });

      it('drops an event for a viewer whose only role is not invited', async () => {
        const excluding: Event = {
          ...baseEvent,
          id: 'evt-excluding',
          excluded_role_ids: ['role-new-member'],
        };
        mockEventRepo.findByChapter.mockResolvedValue([baseEvent, excluding]);
        mockMemberRepo.findByUserAndChapter.mockResolvedValue({
          role_ids: ['role-new-member'],
        });

        const result = await service.findByChapter('ch-1', 'user-1');

        expect(result).toEqual([baseEvent]);
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
      optional_role_ids: null,
      excluded_role_ids: null,
      // Omitted, stored null: read with the older meaning on every read.
      others_invited: null,
      notes: null,
      check_in_zone: null,
      check_in_zone_name: null,
      // Omitted: the ten-minute default (#3703).
      check_in_opens_minutes: 10,
    });
    expect(result).toEqual(baseEvent);
  });

  it("stores the event's own check-in lead", async () => {
    mockEventRepo.create.mockResolvedValue(baseEvent);

    await service.create({
      chapter_id: 'ch-1',
      name: 'Chapter Meeting',
      start_time: baseEvent.start_time,
      end_time: baseEvent.end_time,
      check_in_opens_minutes: 0,
    });

    expect(mockEventRepo.create).toHaveBeenCalledWith(
      expect.objectContaining({ check_in_opens_minutes: 0 }),
    );
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
});
