import { Test, TestingModule } from '@nestjs/testing';
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { AttendanceService } from './attendance.service';
import {
  CHECK_IN_TOKEN_WINDOW_MS,
  mintCheckInToken,
} from '#domain/utils/check-in-token';
import { RbacService } from './rbac.service';
import { ATTENDANCE_REPOSITORY } from '#domain/repositories/attendance.repository.interface';
import type { IAttendanceRepository } from '#domain/repositories/attendance.repository.interface';
import { EVENT_REPOSITORY } from '#domain/repositories/event.repository.interface';
import type { IEventRepository } from '#domain/repositories/event.repository.interface';
import { MEMBER_REPOSITORY } from '#domain/repositories/member.repository.interface';
import type { IMemberRepository } from '#domain/repositories/member.repository.interface';
import type { Event } from '#domain/entities/event.entity';
import type { EventAttendance } from '#domain/entities/event-attendance.entity';
import type { Member } from '#domain/entities/member.entity';

describe('AttendanceService', () => {
  let service: AttendanceService;
  let mockAttendanceRepo: jest.Mocked<IAttendanceRepository>;
  let mockEventRepo: jest.Mocked<IEventRepository>;
  let mockMemberRepo: jest.Mocked<IMemberRepository>;
  let mockRbac: { isAlumni: jest.Mock; getAlumniRoleId: jest.Mock };

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
    check_in_zone: null,
    check_in_zone_name: null,
    created_at: '2026-02-26T00:00:00.000Z',
  };

  const baseAttendance: EventAttendance = {
    id: 'att-1',
    event_id: 'evt-1',
    user_id: 'user-1',
    status: 'PRESENT',
    check_in_time: '2026-02-26T18:30:00.000Z',
    excuse_reason: null,
    marked_by: null,
    created_at: '2026-02-26T18:30:00.000Z',
  };

  beforeEach(async () => {
    mockAttendanceRepo = {
      findByEvent: jest.fn(),
      findByEventAndUser: jest.fn(),
      createMany: jest.fn(),
      update: jest.fn(),
      checkInAtomic: jest.fn(),
    };

    mockEventRepo = {
      findById: jest.fn(),
      findByChapter: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
      delete: jest.fn(),
    };

    mockMemberRepo = {
      findById: jest.fn(),
      findByUserAndChapter: jest.fn(),
      findByChapter: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
      delete: jest.fn(),
    };

    // Default to an active (non-alumni) member so existing cases are unaffected.
    mockRbac = {
      isAlumni: jest.fn().mockResolvedValue(false),
      getAlumniRoleId: jest.fn().mockResolvedValue(null),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AttendanceService,
        { provide: ATTENDANCE_REPOSITORY, useValue: mockAttendanceRepo },
        { provide: EVENT_REPOSITORY, useValue: mockEventRepo },
        { provide: MEMBER_REPOSITORY, useValue: mockMemberRepo },
        { provide: RbacService, useValue: mockRbac },
      ],
    }).compile();

    service = module.get(AttendanceService);
  });

  // Alumni do not check in to events or accrue attendance points
  // (spec/behavior/alumni.md). POST check-in carries no permission requirement,
  // so the denial has to happen in the service.
  describe('Alumni lifecycle restrictions', () => {
    it('denies check-in for an alumni member and awards no points', async () => {
      const duringEvent = new Date('2026-02-26T18:30:00.000Z');
      jest.useFakeTimers();
      jest.setSystemTime(duringEvent);

      mockRbac.isAlumni.mockResolvedValue(true);
      mockEventRepo.findById.mockResolvedValue(baseEvent);
      mockAttendanceRepo.findByEventAndUser.mockResolvedValue(null);

      await expect(service.checkIn('evt-1', 'user-1', 'ch-1')).rejects.toThrow(
        ForbiddenException,
      );

      expect(mockRbac.isAlumni).toHaveBeenCalledWith('ch-1', 'user-1');
      // Denied before the atomic attendance + points write.
      expect(mockAttendanceRepo.checkInAtomic).not.toHaveBeenCalled();

      jest.useRealTimers();
    });

    // An event that names roles is an explicit decision about who attends, so
    // an alumni-facing event (homecoming) must stay reachable by alumni.
    it('allows alumni check-in to an event that explicitly targets their role', async () => {
      const duringEvent = new Date('2026-02-26T18:30:00.000Z');
      jest.useFakeTimers();
      jest.setSystemTime(duringEvent);

      const alumniEvent: Event = {
        ...baseEvent,
        required_role_ids: ['role-alumni'],
      };
      const alumniMember: Member = {
        id: 'member-1',
        user_id: 'user-1',
        chapter_id: 'ch-1',
        role_ids: ['role-alumni'],
        custom_role_ids: [],
        has_completed_onboarding: true,
        created_at: '2026-02-01T00:00:00.000Z',
        updated_at: '2026-02-01T00:00:00.000Z',
      };

      mockRbac.isAlumni.mockResolvedValue(true);
      mockEventRepo.findById.mockResolvedValue(alumniEvent);
      mockMemberRepo.findByUserAndChapter.mockResolvedValue(alumniMember);
      mockAttendanceRepo.findByEventAndUser.mockResolvedValue(null);
      mockAttendanceRepo.checkInAtomic.mockResolvedValue(baseAttendance);

      await expect(service.checkIn('evt-1', 'user-1', 'ch-1')).resolves.toEqual(
        baseAttendance,
      );
      expect(mockAttendanceRepo.checkInAtomic).toHaveBeenCalled();

      jest.useRealTimers();
    });

    // Alumni can neither check in nor self-excuse, so auto-absent must not hand
    // them a guaranteed ABSENT record on every mandatory event.
    it('excludes alumni from auto-absent marking on a non-targeted event', async () => {
      const mandatoryEvent: Event = {
        ...baseEvent,
        is_mandatory: true,
        required_role_ids: null,
      };
      const activeMember: Member = {
        id: 'member-1',
        user_id: 'user-active',
        chapter_id: 'ch-1',
        role_ids: ['role-member'],
        custom_role_ids: [],
        has_completed_onboarding: true,
        created_at: '2026-02-01T00:00:00.000Z',
        updated_at: '2026-02-01T00:00:00.000Z',
      };
      const alumniMember: Member = {
        ...activeMember,
        id: 'member-2',
        user_id: 'user-alumni',
        role_ids: ['role-alumni'],
        custom_role_ids: [],
      };

      mockEventRepo.findById.mockResolvedValue(mandatoryEvent);
      mockMemberRepo.findByChapter.mockResolvedValue([
        activeMember,
        alumniMember,
      ]);
      mockAttendanceRepo.findByEvent.mockResolvedValue([]);
      mockRbac.getAlumniRoleId.mockResolvedValue('role-alumni');
      mockAttendanceRepo.createMany.mockImplementation(
        async (rows: unknown[]) => rows,
      );

      const result = await service.markAutoAbsent('evt-1', 'ch-1');

      expect(mockRbac.getAlumniRoleId).toHaveBeenCalledWith('ch-1');
      expect(result).toEqual({ marked: 1 });
      const rows = mockAttendanceRepo.createMany.mock.calls[0][0];
      expect(rows).toHaveLength(1);
      expect(rows[0]).toEqual(
        expect.objectContaining({ user_id: 'user-active', status: 'ABSENT' }),
      );
    });
  });

  // Pinned directly, not only through markAutoAbsent, because the pre-event
  // reminder sweep (#391) is now a second caller. These three branches are the
  // whole contract both callers rely on, and the role-targeted one doubles as
  // the reminder's visibility guarantee.
  describe('resolveRequiredMembers', () => {
    const activeMember: Member = {
      id: 'member-1',
      user_id: 'user-active',
      chapter_id: 'ch-1',
      role_ids: ['role-member'],
      custom_role_ids: [],
      has_completed_onboarding: true,
      created_at: '2026-02-01T00:00:00.000Z',
      updated_at: '2026-02-01T00:00:00.000Z',
    };
    const alumniMember: Member = {
      ...activeMember,
      id: 'member-2',
      user_id: 'user-alumni',
      role_ids: ['role-alumni'],
    };
    const execMember: Member = {
      ...activeMember,
      id: 'member-3',
      user_id: 'user-exec',
      role_ids: ['role-exec'],
    };

    it('returns nobody for an optional, untargeted event', async () => {
      const members = await service.resolveRequiredMembers('ch-1', {
        is_mandatory: false,
        required_role_ids: null,
      });

      expect(members).toEqual([]);
      // Cheap by construction: no roster read at all for the common case.
      expect(mockMemberRepo.findByChapter).not.toHaveBeenCalled();
    });

    // A cleared targeting list round-trips as [] rather than null, so
    // emptiness — not nullness — has to be the test.
    it('treats an empty required_role_ids as untargeted, not as targeting nobody', async () => {
      mockMemberRepo.findByChapter.mockResolvedValue([activeMember]);
      mockRbac.getAlumniRoleId.mockResolvedValue('role-alumni');

      const members = await service.resolveRequiredMembers('ch-1', {
        is_mandatory: true,
        required_role_ids: [],
      });

      expect(members.map((m) => m.user_id)).toEqual(['user-active']);
    });

    it('returns only members holding an intersecting role for a targeted event', async () => {
      mockMemberRepo.findByChapter.mockResolvedValue([
        activeMember,
        execMember,
      ]);

      const members = await service.resolveRequiredMembers('ch-1', {
        is_mandatory: false,
        required_role_ids: ['role-exec'],
      });

      expect(members.map((m) => m.user_id)).toEqual(['user-exec']);
    });

    // Targeting names its audience explicitly, so alumni are not subtracted
    // from it — this is what keeps an alumni-facing event reaching alumni.
    it('keeps alumni in a role-targeted event that names their role', async () => {
      mockMemberRepo.findByChapter.mockResolvedValue([
        activeMember,
        alumniMember,
      ]);
      mockRbac.getAlumniRoleId.mockResolvedValue('role-alumni');

      const members = await service.resolveRequiredMembers('ch-1', {
        is_mandatory: false,
        required_role_ids: ['role-alumni'],
      });

      expect(members.map((m) => m.user_id)).toEqual(['user-alumni']);
      expect(mockRbac.getAlumniRoleId).not.toHaveBeenCalled();
    });

    it('excludes alumni from a mandatory untargeted event', async () => {
      mockMemberRepo.findByChapter.mockResolvedValue([
        activeMember,
        alumniMember,
      ]);
      mockRbac.getAlumniRoleId.mockResolvedValue('role-alumni');

      const members = await service.resolveRequiredMembers('ch-1', {
        is_mandatory: true,
        required_role_ids: null,
      });

      expect(members.map((m) => m.user_id)).toEqual(['user-active']);
    });

    it('falls back to every member when the chapter has no alumni role', async () => {
      mockMemberRepo.findByChapter.mockResolvedValue([
        activeMember,
        alumniMember,
      ]);
      mockRbac.getAlumniRoleId.mockResolvedValue(null);

      const members = await service.resolveRequiredMembers('ch-1', {
        is_mandatory: true,
        required_role_ids: null,
      });

      expect(members).toHaveLength(2);
    });
  });

  describe('checkIn', () => {
    it('should atomically create attendance and award points within the event window', async () => {
      const duringEvent = new Date('2026-02-26T18:30:00.000Z');
      jest.useFakeTimers();
      jest.setSystemTime(duringEvent);

      mockEventRepo.findById.mockResolvedValue(baseEvent);
      mockAttendanceRepo.findByEventAndUser.mockResolvedValue(null);
      mockAttendanceRepo.checkInAtomic.mockResolvedValue(baseAttendance);

      const result = await service.checkIn('evt-1', 'user-1', 'ch-1');

      expect(mockEventRepo.findById).toHaveBeenCalledWith('evt-1', 'ch-1');
      expect(mockAttendanceRepo.findByEventAndUser).toHaveBeenCalledWith(
        'evt-1',
        'user-1',
      );
      // Attendance insert + point award happen in a single atomic RPC call.
      expect(mockAttendanceRepo.checkInAtomic).toHaveBeenCalledWith(
        'evt-1',
        'user-1',
        'ch-1',
        duringEvent.toISOString(),
        10,
        'Chapter Meeting',
      );
      expect(result).toEqual(baseAttendance);

      jest.useRealTimers();
    });

    it('should allow check-in within the grace period after event end', async () => {
      const justAfterEnd = new Date('2026-02-26T19:10:00.000Z');
      jest.useFakeTimers();
      jest.setSystemTime(justAfterEnd);

      mockEventRepo.findById.mockResolvedValue(baseEvent);
      mockAttendanceRepo.findByEventAndUser.mockResolvedValue(null);
      mockAttendanceRepo.checkInAtomic.mockResolvedValue(baseAttendance);

      await expect(service.checkIn('evt-1', 'user-1', 'ch-1')).resolves.toEqual(
        baseAttendance,
      );
      jest.useRealTimers();
    });

    it('should reject role-targeted event check-in when member lacks required role', async () => {
      const duringEvent = new Date('2026-02-26T18:30:00.000Z');
      const roleTargetedEvent: Event = {
        ...baseEvent,
        required_role_ids: ['role-exec'],
      };
      const member: Member = {
        id: 'member-1',
        user_id: 'user-1',
        chapter_id: 'ch-1',
        role_ids: ['role-member'],
        custom_role_ids: [],
        has_completed_onboarding: true,
        created_at: '2026-02-01T00:00:00.000Z',
        updated_at: '2026-02-01T00:00:00.000Z',
      };

      jest.useFakeTimers();
      jest.setSystemTime(duringEvent);
      mockEventRepo.findById.mockResolvedValue(roleTargetedEvent);
      mockMemberRepo.findByUserAndChapter.mockResolvedValue(member);

      await expect(service.checkIn('evt-1', 'user-1', 'ch-1')).rejects.toThrow(
        ForbiddenException,
      );
      expect(mockAttendanceRepo.checkInAtomic).not.toHaveBeenCalled();
      jest.useRealTimers();
    });

    it('should return 409 Conflict when the atomic check-in inserts nothing (lost race)', async () => {
      const duringEvent = new Date('2026-02-26T18:30:00.000Z');
      jest.useFakeTimers();
      jest.setSystemTime(duringEvent);

      mockEventRepo.findById.mockResolvedValue(baseEvent);
      // Fast-path read sees no row, but a concurrent check-in wins the race, so
      // the RPC's `on conflict do nothing` inserts nothing and returns null.
      mockAttendanceRepo.findByEventAndUser.mockResolvedValue(null);
      mockAttendanceRepo.checkInAtomic.mockResolvedValue(null);

      await expect(service.checkIn('evt-1', 'user-1', 'ch-1')).rejects.toThrow(
        ConflictException,
      );
      await expect(service.checkIn('evt-1', 'user-1', 'ch-1')).rejects.toThrow(
        'Already checked in for this event',
      );
      jest.useRealTimers();
    });

    it('should propagate atomic check-in failures without partial writes', async () => {
      const duringEvent = new Date('2026-02-26T18:30:00.000Z');
      jest.useFakeTimers();
      jest.setSystemTime(duringEvent);

      mockEventRepo.findById.mockResolvedValue(baseEvent);
      mockAttendanceRepo.findByEventAndUser.mockResolvedValue(null);
      mockAttendanceRepo.checkInAtomic.mockRejectedValue(
        new Error('db transaction failed'),
      );

      // The RPC is one transaction: on failure nothing commits, so there is no
      // attendance row to delete and no separate point write to undo.
      await expect(service.checkIn('evt-1', 'user-1', 'ch-1')).rejects.toThrow(
        'db transaction failed',
      );
      expect(mockAttendanceRepo.checkInAtomic).toHaveBeenCalled();
      jest.useRealTimers();
    });

    it('should throw NotFoundException when event does not exist', async () => {
      mockEventRepo.findById.mockResolvedValue(null);

      await expect(service.checkIn('evt-1', 'user-1', 'ch-1')).rejects.toThrow(
        NotFoundException,
      );
      await expect(service.checkIn('evt-1', 'user-1', 'ch-1')).rejects.toThrow(
        'Event not found',
      );

      expect(mockAttendanceRepo.checkInAtomic).not.toHaveBeenCalled();
    });

    it('should throw BadRequestException when outside event time window', async () => {
      const pastEvent: Event = {
        ...baseEvent,
        start_time: '2026-02-26T10:00:00.000Z',
        end_time: '2026-02-26T11:00:00.000Z',
      };
      mockEventRepo.findById.mockResolvedValue(pastEvent);
      mockAttendanceRepo.findByEventAndUser.mockResolvedValue(null);

      await expect(service.checkIn('evt-1', 'user-1', 'ch-1')).rejects.toThrow(
        BadRequestException,
      );
      await expect(service.checkIn('evt-1', 'user-1', 'ch-1')).rejects.toThrow(
        'Check-in is only allowed during the event time window',
      );

      expect(mockAttendanceRepo.checkInAtomic).not.toHaveBeenCalled();
    });

    it('should throw ConflictException when already checked in', async () => {
      const wideWindowEvent: Event = {
        ...baseEvent,
        start_time: '2000-01-01T00:00:00.000Z',
        end_time: '2030-12-31T23:59:59.000Z',
      };
      mockEventRepo.findById.mockResolvedValue(wideWindowEvent);
      mockAttendanceRepo.findByEventAndUser.mockResolvedValue(baseAttendance);

      await expect(service.checkIn('evt-1', 'user-1', 'ch-1')).rejects.toThrow(
        ConflictException,
      );

      expect(mockAttendanceRepo.checkInAtomic).not.toHaveBeenCalled();
    });
  });

  describe('getAttendance', () => {
    it('should return attendance list for event', async () => {
      mockEventRepo.findById.mockResolvedValue(baseEvent);
      mockAttendanceRepo.findByEvent.mockResolvedValue([baseAttendance]);

      const result = await service.getAttendance('evt-1', 'ch-1');

      expect(mockEventRepo.findById).toHaveBeenCalledWith('evt-1', 'ch-1');
      expect(mockAttendanceRepo.findByEvent).toHaveBeenCalledWith('evt-1');
      expect(result).toEqual([baseAttendance]);
    });

    it('should throw NotFoundException when event does not exist', async () => {
      mockEventRepo.findById.mockResolvedValue(null);

      await expect(service.getAttendance('evt-1', 'ch-1')).rejects.toThrow(
        new NotFoundException('Event not found'),
      );
      expect(mockAttendanceRepo.findByEvent).not.toHaveBeenCalled();
    });
  });

  describe('updateStatus', () => {
    it('should update attendance status and set marked_by', async () => {
      const updated: EventAttendance = {
        ...baseAttendance,
        status: 'EXCUSED',
        excuse_reason: 'Family emergency',
        marked_by: 'admin-1',
      };
      mockEventRepo.findById.mockResolvedValue(baseEvent);
      mockAttendanceRepo.findByEventAndUser.mockResolvedValue(baseAttendance);
      mockAttendanceRepo.update.mockResolvedValue(updated);

      const result = await service.updateStatus(
        'evt-1',
        'user-1',
        'ch-1',
        'EXCUSED',
        'Family emergency',
        'admin-1',
      );

      expect(mockAttendanceRepo.update).toHaveBeenCalledWith('att-1', {
        status: 'EXCUSED',
        excuse_reason: 'Family emergency',
        marked_by: 'admin-1',
      });
      expect(result).toEqual(updated);
    });

    it('should throw NotFoundException when event does not exist', async () => {
      mockEventRepo.findById.mockResolvedValue(null);

      await expect(
        service.updateStatus(
          'evt-1',
          'user-1',
          'ch-1',
          'EXCUSED',
          null,
          'admin-1',
        ),
      ).rejects.toThrow(NotFoundException);
      expect(mockAttendanceRepo.update).not.toHaveBeenCalled();
    });

    it('should throw NotFoundException when attendance record does not exist', async () => {
      mockEventRepo.findById.mockResolvedValue(baseEvent);
      mockAttendanceRepo.findByEventAndUser.mockResolvedValue(null);

      await expect(
        service.updateStatus(
          'evt-1',
          'user-1',
          'ch-1',
          'EXCUSED',
          null,
          'admin-1',
        ),
      ).rejects.toThrow(NotFoundException);
      expect(mockAttendanceRepo.update).not.toHaveBeenCalled();
    });
  });

  describe('markAutoAbsent', () => {
    beforeEach(() => {
      mockAttendanceRepo.createMany.mockImplementation((dataArr) =>
        Promise.resolve(
          dataArr.map((d, i) => ({
            ...baseAttendance,
            id: `att-new-${i}`,
            user_id: d.user_id!,
            event_id: d.event_id!,
            status: 'ABSENT',
            check_in_time: null,
            excuse_reason: null,
            marked_by: null,
            created_at: baseAttendance.created_at,
          })),
        ),
      );
    });

    const pastEvent: Event = {
      ...baseEvent,
      is_mandatory: true,
      start_time: '2020-01-01T10:00:00.000Z',
      end_time: '2020-01-01T11:00:00.000Z',
    };

    const members: Member[] = [
      {
        id: 'member-1',
        user_id: 'user-1',
        chapter_id: 'ch-1',
        role_ids: ['role-member'],
        custom_role_ids: [],
        has_completed_onboarding: true,
        created_at: '2020-01-01T00:00:00.000Z',
        updated_at: '2020-01-01T00:00:00.000Z',
      },
      {
        id: 'member-2',
        user_id: 'user-2',
        chapter_id: 'ch-1',
        role_ids: ['role-member'],
        custom_role_ids: [],
        has_completed_onboarding: true,
        created_at: '2020-01-01T00:00:00.000Z',
        updated_at: '2020-01-01T00:00:00.000Z',
      },
      {
        id: 'member-3',
        user_id: 'user-3',
        chapter_id: 'ch-1',
        role_ids: ['role-exec'],
        custom_role_ids: [],
        has_completed_onboarding: true,
        created_at: '2020-01-01T00:00:00.000Z',
        updated_at: '2020-01-01T00:00:00.000Z',
      },
    ];

    it('should mark ABSENT for mandatory event (members without attendance)', async () => {
      mockEventRepo.findById.mockResolvedValue(pastEvent);
      mockMemberRepo.findByChapter.mockResolvedValue(members);
      mockAttendanceRepo.findByEvent.mockResolvedValue([]);

      const result = await service.markAutoAbsent('evt-1', 'ch-1');

      expect(result.marked).toBe(3);
      expect(mockAttendanceRepo.createMany).toHaveBeenCalledTimes(1);
      expect(mockAttendanceRepo.createMany).toHaveBeenCalledWith([
        expect.objectContaining({ status: 'ABSENT', user_id: 'user-1' }),
        expect.objectContaining({ status: 'ABSENT', user_id: 'user-2' }),
        expect.objectContaining({ status: 'ABSENT', user_id: 'user-3' }),
      ]);
    });

    it('should mark ABSENT for role-targeted event (only required role members)', async () => {
      const roleEvent: Event = {
        ...pastEvent,
        is_mandatory: false,
        required_role_ids: ['role-exec'],
      };
      mockEventRepo.findById.mockResolvedValue(roleEvent);
      mockMemberRepo.findByChapter.mockResolvedValue(members);
      mockAttendanceRepo.findByEvent.mockResolvedValue([]);

      const result = await service.markAutoAbsent('evt-1', 'ch-1');

      // Only user-3 has role-exec
      expect(result.marked).toBe(1);
      expect(mockAttendanceRepo.createMany).toHaveBeenCalledTimes(1);
      expect(mockAttendanceRepo.createMany).toHaveBeenCalledWith([
        expect.objectContaining({ user_id: 'user-3', status: 'ABSENT' }),
      ]);
    });

    it('should skip members who already checked in (PRESENT)', async () => {
      const presentRecord: EventAttendance = {
        ...baseAttendance,
        user_id: 'user-1',
        status: 'PRESENT',
      };
      mockEventRepo.findById.mockResolvedValue(pastEvent);
      mockMemberRepo.findByChapter.mockResolvedValue(members);
      mockAttendanceRepo.findByEvent.mockResolvedValue([presentRecord]);

      const result = await service.markAutoAbsent('evt-1', 'ch-1');

      // user-1 is skipped; user-2, user-3 are marked absent
      expect(result.marked).toBe(2);
      expect(mockAttendanceRepo.createMany).toHaveBeenCalledWith([
        expect.objectContaining({ user_id: 'user-2' }),
        expect.objectContaining({ user_id: 'user-3' }),
      ]);
    });

    it('should not create duplicate ABSENT records when one already exists', async () => {
      const absentRecord: EventAttendance = {
        ...baseAttendance,
        user_id: 'user-2',
        status: 'ABSENT',
      };
      mockEventRepo.findById.mockResolvedValue(pastEvent);
      mockMemberRepo.findByChapter.mockResolvedValue(members);
      mockAttendanceRepo.findByEvent.mockResolvedValue([absentRecord]);

      const result = await service.markAutoAbsent('evt-1', 'ch-1');

      expect(result.marked).toBe(2);
      const payload = mockAttendanceRepo.createMany.mock.calls[0][0];
      expect(payload.map((r) => r.user_id)).not.toContain('user-2');
    });

    it('should skip members who are EXCUSED', async () => {
      const excusedRecord: EventAttendance = {
        ...baseAttendance,
        user_id: 'user-2',
        status: 'EXCUSED',
        excuse_reason: 'Family emergency',
      };
      mockEventRepo.findById.mockResolvedValue(pastEvent);
      mockMemberRepo.findByChapter.mockResolvedValue(members);
      mockAttendanceRepo.findByEvent.mockResolvedValue([excusedRecord]);

      const result = await service.markAutoAbsent('evt-1', 'ch-1');

      expect(result.marked).toBe(2);
      // user-2 should not have been marked
      const payload = mockAttendanceRepo.createMany.mock.calls[0][0];
      expect(payload.map((r) => r.user_id)).not.toContain('user-2');
    });

    it('should reject if called before grace period ends', async () => {
      const futureEvent: Event = {
        ...baseEvent,
        is_mandatory: true,
        start_time: '2099-01-01T10:00:00.000Z',
        end_time: '2099-01-01T11:00:00.000Z',
      };
      mockEventRepo.findById.mockResolvedValue(futureEvent);

      await expect(service.markAutoAbsent('evt-1', 'ch-1')).rejects.toThrow(
        BadRequestException,
      );
    });

    it('should do nothing for optional events', async () => {
      const optionalEvent: Event = {
        ...pastEvent,
        is_mandatory: false,
        required_role_ids: null,
      };
      mockEventRepo.findById.mockResolvedValue(optionalEvent);

      const result = await service.markAutoAbsent('evt-1', 'ch-1');

      expect(result.marked).toBe(0);
      expect(mockMemberRepo.findByChapter).not.toHaveBeenCalled();
      expect(mockAttendanceRepo.createMany).not.toHaveBeenCalled();
    });
  });
  // ── Rotating check-in token (C2 of #937) ────────────────────────────
  //
  // The signing secret is an optional env var, so every test here sets and
  // restores it explicitly rather than relying on the ambient environment —
  // CI runs without it, and a test that silently depended on it would pass
  // locally and fail there.
  describe('Rotating check-in token', () => {
    const duringEvent = new Date('2026-02-26T18:30:00.000Z');
    const SECRET = 'spec-check-in-secret';
    let previousSecret: string | undefined;

    beforeEach(() => {
      previousSecret = process.env.EVENT_CHECK_IN_TOKEN_SECRET;
      process.env.EVENT_CHECK_IN_TOKEN_SECRET = SECRET;
      jest.useFakeTimers();
      jest.setSystemTime(duringEvent);

      mockRbac.isAlumni.mockResolvedValue(false);
      mockEventRepo.findById.mockResolvedValue(baseEvent);
      mockAttendanceRepo.findByEventAndUser.mockResolvedValue(null);
      mockAttendanceRepo.checkInAtomic.mockResolvedValue(baseAttendance);
    });

    afterEach(() => {
      jest.useRealTimers();
      if (previousSecret === undefined) {
        delete process.env.EVENT_CHECK_IN_TOKEN_SECRET;
      } else {
        process.env.EVENT_CHECK_IN_TOKEN_SECRET = previousSecret;
      }
    });

    it('accepts a token minted for this event in the current window', async () => {
      const { token } = mintCheckInToken(
        'evt-1',
        SECRET,
        duringEvent.getTime(),
      );

      await expect(
        service.checkIn('evt-1', 'user-1', 'ch-1', { token }),
      ).resolves.toEqual(baseAttendance);
      expect(mockAttendanceRepo.checkInAtomic).toHaveBeenCalled();
    });

    it('accepts the typed manual code', async () => {
      const { manualCode } = mintCheckInToken(
        'evt-1',
        SECRET,
        duringEvent.getTime(),
      );

      await expect(
        service.checkIn('evt-1', 'user-1', 'ch-1', { manualCode }),
      ).resolves.toEqual(baseAttendance);
    });

    it('rejects a token minted for a different event, before any write', async () => {
      const { token } = mintCheckInToken(
        'evt-OTHER',
        SECRET,
        duringEvent.getTime(),
      );

      await expect(
        service.checkIn('evt-1', 'user-1', 'ch-1', { token }),
      ).rejects.toThrow(ForbiddenException);
      expect(mockAttendanceRepo.checkInAtomic).not.toHaveBeenCalled();
    });

    it('rejects a token from two windows ago', async () => {
      const { token } = mintCheckInToken(
        'evt-1',
        SECRET,
        duringEvent.getTime() - 2 * CHECK_IN_TOKEN_WINDOW_MS,
      );

      await expect(
        service.checkIn('evt-1', 'user-1', 'ch-1', { token }),
      ).rejects.toThrow(ForbiddenException);
    });

    it('rejects garbage in the token field rather than ignoring it', async () => {
      await expect(
        service.checkIn('evt-1', 'user-1', 'ch-1', { token: 'nonsense' }),
      ).rejects.toThrow(ForbiddenException);
      expect(mockAttendanceRepo.checkInAtomic).not.toHaveBeenCalled();
    });

    // The documented design: `patterns.md` says the code raises effort while the
    // geofence enforces presence, and `events.md` keeps the chat event card as a
    // token-less check-in surface. This test pins that deliberate behavior so a
    // future change to it is a visible decision, not a silent regression.
    it('still allows a check-in that supplies no token at all', async () => {
      await expect(service.checkIn('evt-1', 'user-1', 'ch-1')).resolves.toEqual(
        baseAttendance,
      );
    });

    it('503s the mint route when no signing secret is configured', async () => {
      delete process.env.EVENT_CHECK_IN_TOKEN_SECRET;

      await expect(service.mintCheckInToken('evt-1', 'ch-1')).rejects.toThrow(
        ServiceUnavailableException,
      );
    });

    it('rejects a supplied token when no signing secret is configured', async () => {
      // Must not degrade to "accept anything": an unconfigured environment
      // makes the feature unavailable, not permissive.
      const { token } = mintCheckInToken(
        'evt-1',
        SECRET,
        duringEvent.getTime(),
      );
      delete process.env.EVENT_CHECK_IN_TOKEN_SECRET;

      await expect(
        service.checkIn('evt-1', 'user-1', 'ch-1', { token }),
      ).rejects.toThrow(ServiceUnavailableException);
      expect(mockAttendanceRepo.checkInAtomic).not.toHaveBeenCalled();
    });

    it('404s the mint route for an event outside the caller chapter', async () => {
      mockEventRepo.findById.mockResolvedValue(null);

      await expect(service.mintCheckInToken('evt-1', 'ch-1')).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  // ── Check-in geofence (C2 of #937) ──────────────────────────────────
  //
  // `spec/ui/mobile/patterns.md`: "the check that defeats proxy check-ins is the
  // server's zone check on the scanner's location". These tests are that claim.
  describe('Check-in geofence', () => {
    const duringEvent = new Date('2026-02-26T18:30:00.000Z');

    // ~80m box around a plausible chapter house.
    const zonedEvent: Event = {
      ...baseEvent,
      check_in_zone: [
        { lat: 42.7295, lng: -73.6785 },
        { lat: 42.7295, lng: -73.6775 },
        { lat: 42.7302, lng: -73.6775 },
        { lat: 42.7302, lng: -73.6785 },
      ],
      check_in_zone_name: 'Great Hall',
    };

    beforeEach(() => {
      jest.useFakeTimers();
      jest.setSystemTime(duringEvent);

      mockRbac.isAlumni.mockResolvedValue(false);
      mockAttendanceRepo.findByEventAndUser.mockResolvedValue(null);
      mockAttendanceRepo.checkInAtomic.mockResolvedValue(baseAttendance);
    });

    afterEach(() => {
      jest.useRealTimers();
    });

    it('accepts a check-in from inside the zone', async () => {
      mockEventRepo.findById.mockResolvedValue(zonedEvent);

      await expect(
        service.checkIn('evt-1', 'user-1', 'ch-1', {
          lat: 42.7298,
          lng: -73.678,
        }),
      ).resolves.toEqual(baseAttendance);
    });

    it('rejects a check-in from outside the zone, before any write', async () => {
      mockEventRepo.findById.mockResolvedValue(zonedEvent);

      await expect(
        service.checkIn('evt-1', 'user-1', 'ch-1', {
          lat: 42.731,
          lng: -73.678,
        }),
      ).rejects.toThrow(ForbiddenException);
      expect(mockAttendanceRepo.checkInAtomic).not.toHaveBeenCalled();
    });

    // The bypass that would make the whole feature theatre: omit the
    // coordinates and hope the check is skipped.
    it('rejects a zoned check-in that supplies no coordinates', async () => {
      mockEventRepo.findById.mockResolvedValue(zonedEvent);

      await expect(service.checkIn('evt-1', 'user-1', 'ch-1')).rejects.toThrow(
        BadRequestException,
      );
      expect(mockAttendanceRepo.checkInAtomic).not.toHaveBeenCalled();
    });

    it('rejects a zoned check-in with a partial or non-finite fix', async () => {
      mockEventRepo.findById.mockResolvedValue(zonedEvent);

      await expect(
        service.checkIn('evt-1', 'user-1', 'ch-1', { lat: 42.7298 }),
      ).rejects.toThrow(BadRequestException);
      await expect(
        service.checkIn('evt-1', 'user-1', 'ch-1', {
          lat: Number.NaN,
          lng: -73.678,
        }),
      ).rejects.toThrow(BadRequestException);
    });

    // A corrupted zone must fail closed. Treating it as "no zone" would let a
    // bad write silently switch off the control for that event.
    it('fails closed on a malformed zone rather than skipping the check', async () => {
      mockEventRepo.findById.mockResolvedValue({
        ...zonedEvent,
        check_in_zone: [{ lat: 1, lng: 1 }] as Event['check_in_zone'],
      });

      await expect(
        service.checkIn('evt-1', 'user-1', 'ch-1', {
          lat: 42.7298,
          lng: -73.678,
        }),
      ).rejects.toThrow(BadRequestException);
      expect(mockAttendanceRepo.checkInAtomic).not.toHaveBeenCalled();
    });

    it('ignores coordinates entirely for an event with no zone', async () => {
      mockEventRepo.findById.mockResolvedValue(baseEvent);

      // Nowhere near anything — an unzoned event has no location rule to break.
      await expect(
        service.checkIn('evt-1', 'user-1', 'ch-1', { lat: 0, lng: 0 }),
      ).resolves.toEqual(baseAttendance);
    });
  });
});
