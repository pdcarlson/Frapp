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
  let mockEventTypeRepo: EventServiceFixture['mockEventTypeRepo'];

  beforeEach(async () => {
    ({
      service,
      mockEventRepo,
      mockMemberRepo,
      mockRbacService,
      mockEventTypeRepo,
    } = await createEventServiceFixture());
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

    // No window: the events list reads the whole calendar, as before.
    expect(mockEventRepo.findByChapter).toHaveBeenCalledWith('ch-1', undefined);
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

    describe('findCreatedBy', () => {
      it('reads only the maker’s events, from the given end, capped', async () => {
        mockEventRepo.findCreatedBy.mockResolvedValue([baseEvent]);

        const result = await service.findCreatedBy(
          'ch-1',
          'user-1',
          '2026-11-11T00:00:00.000Z',
          200,
        );

        expect(mockEventRepo.findCreatedBy).toHaveBeenCalledWith(
          'ch-1',
          'user-1',
          '2026-11-11T00:00:00.000Z',
          200,
        );
        expect(result).toEqual([baseEvent]);
      });

      it('drops an event that leaves its maker out: making it grants no read of it', async () => {
        mockEventRepo.findCreatedBy.mockResolvedValue([
          baseEvent,
          targetedEvent,
        ]);
        mockMemberRepo.findByUserAndChapter.mockResolvedValue({
          role_ids: ['role-member'],
        });

        const result = await service.findCreatedBy(
          'ch-1',
          'user-1',
          '2026-11-11T00:00:00.000Z',
          200,
        );

        expect(result).toEqual([baseEvent]);
      });

      it('keeps it for a maker holding events:update', async () => {
        mockEventRepo.findCreatedBy.mockResolvedValue([targetedEvent]);
        mockRbacService.memberHasAnyPermission.mockResolvedValue(true);

        const result = await service.findCreatedBy(
          'ch-1',
          'user-1',
          '2026-11-11T00:00:00.000Z',
          200,
        );

        expect(result).toEqual([targetedEvent]);
      });
    });

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
    // An officer (`events:update`): the spec's default of 10 points applies.
    mockRbacService.memberHasAnyPermission.mockResolvedValue(true);

    const result = await service.create({
      chapter_id: 'ch-1',
      name: 'Chapter Meeting',
      start_time: baseEvent.start_time,
      end_time: baseEvent.end_time,
      created_by: 'user-officer',
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
      // No type picked.
      event_type_id: null,
      created_by: 'user-officer',
    });
    expect(mockRbacService.memberHasAnyPermission).toHaveBeenCalledWith(
      'ch-1',
      'user-officer',
      ['events:update'],
    );
    expect(result).toEqual(baseEvent);
  });

  // #3709: any member with `events:create` makes an event, but making anyone
  // required and attaching points stay with `events:update` holders.
  describe('a member who cannot edit events', () => {
    const create = (extra: Record<string, unknown> = {}) =>
      service.create({
        chapter_id: 'ch-1',
        name: 'Study night',
        start_time: baseEvent.start_time,
        end_time: baseEvent.end_time,
        created_by: 'user-member',
        ...extra,
      });

    beforeEach(() => {
      mockEventRepo.create.mockResolvedValue(baseEvent);
      mockRbacService.memberHasAnyPermission.mockResolvedValue(false);
    });

    it('creates an optional event that carries no points', async () => {
      await create({ point_value: 10, is_mandatory: false });

      expect(mockEventRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({
          point_value: 0,
          is_mandatory: false,
          created_by: 'user-member',
        }),
      );
    });

    it('stores no points when none are sent either', async () => {
      await create();

      expect(mockEventRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({ point_value: 0 }),
      );
    });

    it('may still set roles optional or not invited', async () => {
      await create({
        optional_role_ids: ['role-seniors'],
        excluded_role_ids: ['role-new'],
      });

      expect(mockEventRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({
          optional_role_ids: ['role-seniors'],
          excluded_role_ids: ['role-new'],
        }),
      );
    });

    // Lowered, not refused (#3709): app builds already installed copy a
    // type's "required for everyone" into the form, and a refusal would leave
    // the member retrying a save that can never succeed.
    it('stores an event required for everyone as optional for everyone', async () => {
      await create({ is_mandatory: true });

      expect(mockEventRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({
          is_mandatory: false,
          required_role_ids: null,
          others_invited: true,
          point_value: 0,
        }),
      );
    });

    it('keeps a role it made required invited, as optional, and nobody else', async () => {
      // An older build's "required for officers": `others_invited` omitted,
      // which reads as "only the listed roles" while a role is required.
      await create({
        required_role_ids: ['role-officers'],
        optional_role_ids: ['role-seniors'],
      });

      expect(mockEventRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({
          is_mandatory: false,
          required_role_ids: null,
          optional_role_ids: ['role-seniors', 'role-officers'],
          // Written out: a null with no required role left would read as
          // "everyone" and open the event to the whole chapter.
          others_invited: false,
        }),
      );
    });

    it('keeps everyone else invited when the request said so', async () => {
      await create({
        required_role_ids: ['role-officers'],
        others_invited: true,
      });

      expect(mockEventRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({
          required_role_ids: null,
          optional_role_ids: ['role-officers'],
          others_invited: true,
        }),
      );
    });

    it('treats a create with no maker as a member', async () => {
      await service.create({
        chapter_id: 'ch-1',
        name: 'Study night',
        start_time: baseEvent.start_time,
        end_time: baseEvent.end_time,
        point_value: 25,
      });

      expect(mockRbacService.memberHasAnyPermission).not.toHaveBeenCalled();
      expect(mockEventRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({ point_value: 0 }),
      );
    });
  });

  it('lets an events:update holder make an event required with points', async () => {
    mockEventRepo.create.mockResolvedValue(baseEvent);
    mockRbacService.memberHasAnyPermission.mockResolvedValue(true);

    await service.create({
      chapter_id: 'ch-1',
      name: 'Chapter Meeting',
      start_time: baseEvent.start_time,
      end_time: baseEvent.end_time,
      created_by: 'user-officer',
      point_value: 25,
      is_mandatory: true,
      required_role_ids: ['role-officers'],
    });

    expect(mockEventRepo.create).toHaveBeenCalledWith(
      expect.objectContaining({
        point_value: 25,
        is_mandatory: true,
        required_role_ids: ['role-officers'],
      }),
    );
  });

  it('records who made the event (#3897)', async () => {
    mockEventRepo.create.mockResolvedValue(baseEvent);

    await service.create({
      chapter_id: 'ch-1',
      name: 'Chapter Meeting',
      start_time: baseEvent.start_time,
      end_time: baseEvent.end_time,
      created_by: 'user-maker',
    });

    expect(mockEventRepo.create).toHaveBeenCalledWith(
      expect.objectContaining({ created_by: 'user-maker' }),
    );
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

  // Event types (#3730): the type rides on the row, and only the chapter's
  // own types are accepted.
  describe('event type', () => {
    const schedule = {
      chapter_id: 'ch-1',
      name: 'Chapter meeting',
      start_time: '2027-02-26T18:00:00.000Z',
      end_time: '2027-02-26T19:00:00.000Z',
    };

    it('stores the type a create names', async () => {
      mockEventRepo.create.mockResolvedValue(baseEvent);
      await service.create({ ...schedule, event_type_id: 'type-1' });
      expect(mockEventTypeRepo.findById).toHaveBeenCalledWith('type-1', 'ch-1');
      expect(mockEventRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({ event_type_id: 'type-1' }),
      );
    });

    it('stores no type when a create names none', async () => {
      mockEventRepo.create.mockResolvedValue(baseEvent);
      await service.create(schedule);
      expect(mockEventTypeRepo.findById).not.toHaveBeenCalled();
      expect(mockEventRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({ event_type_id: null }),
      );
    });

    it("refuses another chapter's type before writing", async () => {
      mockEventTypeRepo.findById.mockResolvedValueOnce(null);
      await expect(
        service.create({ ...schedule, event_type_id: 'type-other' }),
      ).rejects.toThrow(BadRequestException);
      expect(mockEventRepo.create).not.toHaveBeenCalled();
    });

    it("refuses another chapter's type on an update", async () => {
      mockEventTypeRepo.findById.mockResolvedValueOnce(null);
      await expect(
        service.update('evt-1', 'ch-1', { event_type_id: 'type-other' }),
      ).rejects.toThrow(BadRequestException);
      expect(mockEventRepo.update).not.toHaveBeenCalled();
    });

    it('copies the type onto every occurrence of a series', async () => {
      mockEventRepo.create.mockResolvedValue({
        ...baseEvent,
        start_time: schedule.start_time,
        end_time: schedule.end_time,
        recurrence_rule: 'WEEKLY',
        event_type_id: 'type-1',
      });
      await service.create({
        ...schedule,
        recurrence_rule: 'WEEKLY',
        event_type_id: 'type-1',
      });
      const rows = mockEventRepo.createMany.mock.calls[0][0];
      expect(rows.length).toBeGreaterThan(0);
      expect(rows.every((row) => row.event_type_id === 'type-1')).toBe(true);
    });
  });
});
