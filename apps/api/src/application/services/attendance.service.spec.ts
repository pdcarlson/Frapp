import { Test, TestingModule } from '@nestjs/testing';
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import {
  AttendanceService,
  CHECK_IN_NEEDS_CODE,
  CHECK_IN_NEEDS_LOCATION,
  CHECK_IN_TOO_FAR,
} from './attendance.service';
import { SERVER_MESSAGE_COPY } from '@repo/validation';
import {
  CHECK_IN_TOKEN_WINDOW_MS,
  mintCheckInToken,
} from '#domain/utils/check-in-token';
import { RbacService } from './rbac.service';
import { ATTENDANCE_REPOSITORY } from '#domain/repositories/attendance.repository.interface';
import { EVENT_CHECK_IN_SCREEN_REPOSITORY } from '#domain/repositories/event-check-in-screen.repository.interface';
import type { IEventCheckInScreenRepository } from '#domain/repositories/event-check-in-screen.repository.interface';
import type { EventCheckInScreen } from '#domain/entities/event-check-in-screen.entity';
import type { IAttendanceRepository } from '#domain/repositories/attendance.repository.interface';
import { EVENT_REPOSITORY } from '#domain/repositories/event.repository.interface';
import type { IEventRepository } from '#domain/repositories/event.repository.interface';
import { MEMBER_REPOSITORY } from '#domain/repositories/member.repository.interface';
import type { IMemberRepository } from '#domain/repositories/member.repository.interface';
import { EVENT_EXCUSE_REPOSITORY } from '#domain/repositories/event-excuse.repository.interface';
import type { Event } from '#domain/entities/event.entity';
import type { EventAttendance } from '#domain/entities/event-attendance.entity';
import type { Member } from '#domain/entities/member.entity';
import { memberFixture } from '#test/helpers/entity-fixtures';
import { enqueueSanitizedLog } from '../../infrastructure/analytics/posthog-runtime';

jest.mock('../../infrastructure/analytics/posthog-runtime', () => ({
  enqueueSanitizedLog: jest.fn(),
}));

/** The machine `code` on the refusal `pending` rejects with. */
async function refusalCode(pending: Promise<unknown>): Promise<unknown> {
  try {
    await pending;
  } catch (error) {
    const body = (error as { getResponse?: () => unknown }).getResponse?.();
    return (body as { code?: unknown } | undefined)?.code;
  }
  throw new Error('expected a refusal');
}

describe('AttendanceService', () => {
  let service: AttendanceService;
  let mockAttendanceRepo: jest.Mocked<IAttendanceRepository>;
  let mockEventRepo: jest.Mocked<IEventRepository>;
  let mockMemberRepo: jest.Mocked<IMemberRepository>;
  let mockExcuseRepo: {
    findUserIdsByEventAndStatus: jest.Mock;
    withdrawAtomic: jest.Mock;
  };
  let mockScreenRepo: jest.Mocked<IEventCheckInScreenRepository>;
  let mockRbac: {
    isAlumni: jest.Mock;
    getAlumniRoleId: jest.Mock;
    memberHasAnyPermission: jest.Mock;
  };

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
    optional_role_ids: null,
    excluded_role_ids: null,
    others_invited: true,
    notes: null,
    check_in_zone: null,
    check_in_zone_name: null,
    check_in_opens_minutes: 10,
    event_type_id: null,
    agenda: [],
    attachments: [],
    created_by: null,
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
      findByUserForEvents: jest.fn(),
      createMany: jest.fn(),
      update: jest.fn(),
      checkInAtomic: jest.fn(),
    };

    mockEventRepo = {
      findById: jest.fn(),
      findByIds: jest.fn(),
      findByChapter: jest.fn(),
      findCreatedBy: jest.fn(),
      create: jest.fn(),
      createMany: jest.fn(),
      update: jest.fn(),
      delete: jest.fn(),
      findChildren: jest.fn(),
      updateMany: jest.fn(),
      deleteMany: jest.fn(),
      deleteReplacedOccurrences: jest.fn(),
    };

    mockMemberRepo = {
      findById: jest.fn(),
      findByUserAndChapter: jest.fn(),
      findByChapter: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
      delete: jest.fn(),
      findByUser: jest.fn(),
      findChapterMemberIdentities: jest.fn(),
      transferPresidencyAtomic: jest.fn(),
      claimPresidencyAtomic: jest.fn(),
      setRoleIds: jest.fn(),
    };

    // Default: nobody holds an excuse.
    mockExcuseRepo = {
      findUserIdsByEventAndStatus: jest.fn().mockResolvedValue([]),
      withdrawAtomic: jest.fn().mockResolvedValue(null),
    };

    // No screen has shown the code unless a test says so.
    mockScreenRepo = {
      findLive: jest.fn().mockResolvedValue([]),
      recordShown: jest.fn(),
      deleteExpired: jest.fn(),
    };

    // Default to an active (non-alumni) member so existing cases are unaffected.
    mockRbac = {
      isAlumni: jest.fn().mockResolvedValue(false),
      getAlumniRoleId: jest.fn().mockResolvedValue(null),
      memberHasAnyPermission: jest.fn().mockResolvedValue(false),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AttendanceService,
        { provide: ATTENDANCE_REPOSITORY, useValue: mockAttendanceRepo },
        { provide: EVENT_REPOSITORY, useValue: mockEventRepo },
        { provide: MEMBER_REPOSITORY, useValue: mockMemberRepo },
        { provide: EVENT_EXCUSE_REPOSITORY, useValue: mockExcuseRepo },
        {
          provide: EVENT_CHECK_IN_SCREEN_REPOSITORY,
          useValue: mockScreenRepo,
        },
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
        others_invited: false,
      };
      const alumniMember: Member = memberFixture({
        role_ids: ['role-alumni'],
        has_completed_onboarding: true,
        created_at: '2026-02-01T00:00:00.000Z',
        updated_at: '2026-02-01T00:00:00.000Z',
      });

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
      const activeMember: Member = memberFixture({
        user_id: 'user-active',
        role_ids: ['role-member'],
        has_completed_onboarding: true,
        created_at: '2026-02-01T00:00:00.000Z',
        updated_at: '2026-02-01T00:00:00.000Z',
      });
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
        async (rows: Partial<EventAttendance>[]) => rows as EventAttendance[],
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
    const activeMember: Member = memberFixture({
      user_id: 'user-active',
      role_ids: ['role-member'],
      has_completed_onboarding: true,
      created_at: '2026-02-01T00:00:00.000Z',
      updated_at: '2026-02-01T00:00:00.000Z',
    });
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

    // Attendance by role: required for one role, optional for everyone
    // else. Only the role's holders are required; the rest are invited.
    it('requires only the listed role when everyone else is optional', async () => {
      mockMemberRepo.findByChapter.mockResolvedValue([
        activeMember,
        execMember,
      ]);

      const members = await service.resolveRequiredMembers('ch-1', {
        is_mandatory: false,
        required_role_ids: ['role-exec'],
        others_invited: true,
      });

      expect(members.map((m) => m.user_id)).toEqual(['user-exec']);
    });

    it('drops a role marked optional from an everyone-required event, and alumni by default', async () => {
      mockMemberRepo.findByChapter.mockResolvedValue([
        activeMember,
        execMember,
        alumniMember,
      ]);
      mockRbac.getAlumniRoleId.mockResolvedValue('role-alumni');

      const members = await service.resolveRequiredMembers('ch-1', {
        is_mandatory: true,
        optional_role_ids: ['role-exec'],
        others_invited: true,
      });

      expect(members.map((m) => m.user_id)).toEqual(['user-active']);
    });

    it('never requires a role that is not invited', async () => {
      mockMemberRepo.findByChapter.mockResolvedValue([
        activeMember,
        execMember,
      ]);
      mockRbac.getAlumniRoleId.mockResolvedValue(null);

      const members = await service.resolveRequiredMembers('ch-1', {
        is_mandatory: true,
        excluded_role_ids: ['role-exec'],
        others_invited: true,
      });

      expect(members.map((m) => m.user_id)).toEqual(['user-active']);
    });

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
        others_invited: false,
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
        others_invited: false,
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

    it('drops a pending excuse once the member checks in (#3735)', async () => {
      jest.useFakeTimers();
      jest.setSystemTime(new Date('2026-02-26T18:30:00.000Z'));
      mockEventRepo.findById.mockResolvedValue(baseEvent);
      mockAttendanceRepo.findByEventAndUser.mockResolvedValue(null);
      mockAttendanceRepo.checkInAtomic.mockResolvedValue(baseAttendance);

      await service.checkIn('evt-1', 'user-1', 'ch-1');

      expect(mockExcuseRepo.withdrawAtomic).toHaveBeenCalledWith(
        'ch-1',
        'evt-1',
        'user-1',
      );

      // And a failure there doesn't undo the check-in.
      mockExcuseRepo.withdrawAtomic.mockRejectedValueOnce(new Error('down'));
      await expect(service.checkIn('evt-1', 'user-1', 'ch-1')).resolves.toEqual(
        baseAttendance,
      );
      jest.useRealTimers();
    });

    // #3703: members arrive early, so the window opens the event's lead
    // before the start (17:50 for an 18:00 start with the default 10).
    it('opens check-in the default ten minutes before the start', async () => {
      jest.useFakeTimers();
      jest.setSystemTime(new Date('2026-02-26T17:50:00.000Z'));

      mockEventRepo.findById.mockResolvedValue(baseEvent);
      mockAttendanceRepo.findByEventAndUser.mockResolvedValue(null);
      mockAttendanceRepo.checkInAtomic.mockResolvedValue(baseAttendance);

      await expect(service.checkIn('evt-1', 'user-1', 'ch-1')).resolves.toEqual(
        baseAttendance,
      );
      jest.useRealTimers();
    });

    it("refuses a check-in before the event's own lead", async () => {
      jest.useFakeTimers();
      // 17:54 is inside the default lead but outside this event's five.
      jest.setSystemTime(new Date('2026-02-26T17:54:00.000Z'));

      mockEventRepo.findById.mockResolvedValue({
        ...baseEvent,
        check_in_opens_minutes: 5,
      });

      await expect(service.checkIn('evt-1', 'user-1', 'ch-1')).rejects.toThrow(
        'Check-in is only allowed during the event time window',
      );
      expect(mockAttendanceRepo.checkInAtomic).not.toHaveBeenCalled();
      jest.useRealTimers();
    });

    it('should reject role-targeted event check-in when member lacks required role', async () => {
      const duringEvent = new Date('2026-02-26T18:30:00.000Z');
      const roleTargetedEvent: Event = {
        ...baseEvent,
        required_role_ids: ['role-exec'],
        others_invited: false,
      };
      const member: Member = memberFixture({
        role_ids: ['role-member'],
        has_completed_onboarding: true,
        created_at: '2026-02-01T00:00:00.000Z',
        updated_at: '2026-02-01T00:00:00.000Z',
      });

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

    it('rejects check-in from a role the event does not invite', async () => {
      jest.useFakeTimers();
      jest.setSystemTime(new Date('2026-02-26T18:30:00.000Z'));
      mockEventRepo.findById.mockResolvedValue({
        ...baseEvent,
        excluded_role_ids: ['role-new-member'],
      });
      mockMemberRepo.findByUserAndChapter.mockResolvedValue(
        memberFixture({ role_ids: ['role-new-member'] }),
      );

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
      expect(
        await refusalCode(service.checkIn('evt-1', 'user-1', 'ch-1')),
      ).toBe('attendance.already_checked_in');
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
      expect(
        await refusalCode(service.checkIn('evt-1', 'user-1', 'ch-1')),
      ).toBe('attendance.check_in.window_closed');

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
      // The code keeps a second scan out of the clients' Sentry reports.
      expect(
        await refusalCode(service.checkIn('evt-1', 'user-1', 'ch-1')),
      ).toBe('attendance.already_checked_in');

      expect(mockAttendanceRepo.checkInAtomic).not.toHaveBeenCalled();
    });
  });

  describe('getMyAttendance', () => {
    it("returns the caller's own row", async () => {
      mockEventRepo.findById.mockResolvedValue(baseEvent);
      mockAttendanceRepo.findByEventAndUser.mockResolvedValue(baseAttendance);

      await expect(
        service.getMyAttendance('evt-1', 'user-1', 'ch-1'),
      ).resolves.toEqual(baseAttendance);
      expect(mockEventRepo.findById).toHaveBeenCalledWith('evt-1', 'ch-1');
      expect(mockAttendanceRepo.findByEventAndUser).toHaveBeenCalledWith(
        'evt-1',
        'user-1',
      );
    });

    it('returns null when the caller has no row', async () => {
      mockEventRepo.findById.mockResolvedValue(baseEvent);
      mockAttendanceRepo.findByEventAndUser.mockResolvedValue(null);

      await expect(
        service.getMyAttendance('evt-1', 'user-1', 'ch-1'),
      ).resolves.toBeNull();
    });

    // A role-targeted event the caller can't see answers as a missing id
    // does, as GET /v1/events/:id does, never as `{ attendance: null }`.
    describe('an event that leaves people out', () => {
      const officersOnly: Event = {
        ...baseEvent,
        required_role_ids: ['role-officer'],
        others_invited: false,
      };

      it("404s a member it doesn't invite", async () => {
        mockEventRepo.findById.mockResolvedValue(officersOnly);
        mockMemberRepo.findByUserAndChapter.mockResolvedValue({
          role_ids: ['role-member'],
        } as never);

        await expect(
          service.getMyAttendance('evt-1', 'user-1', 'ch-1'),
        ).rejects.toThrow(new NotFoundException('Event not found'));
        expect(mockAttendanceRepo.findByEventAndUser).not.toHaveBeenCalled();
      });

      it('answers a member it invites', async () => {
        mockEventRepo.findById.mockResolvedValue(officersOnly);
        mockMemberRepo.findByUserAndChapter.mockResolvedValue({
          role_ids: ['role-officer'],
        } as never);
        mockAttendanceRepo.findByEventAndUser.mockResolvedValue(null);

        await expect(
          service.getMyAttendance('evt-1', 'user-1', 'ch-1'),
        ).resolves.toBeNull();
      });

      it('answers anyone who may update events', async () => {
        mockEventRepo.findById.mockResolvedValue(officersOnly);
        mockRbac.memberHasAnyPermission.mockResolvedValue(true);
        mockAttendanceRepo.findByEventAndUser.mockResolvedValue(null);

        await expect(
          service.getMyAttendance('evt-1', 'user-1', 'ch-1'),
        ).resolves.toBeNull();
        expect(mockMemberRepo.findByUserAndChapter).not.toHaveBeenCalled();
      });
    });

    it("404s an event outside the caller's chapter", async () => {
      mockEventRepo.findById.mockResolvedValue(null);

      await expect(
        service.getMyAttendance('evt-1', 'user-1', 'ch-1'),
      ).rejects.toThrow(new NotFoundException('Event not found'));
      expect(mockAttendanceRepo.findByEventAndUser).not.toHaveBeenCalled();
    });
  });

  describe('getMyAttendanceForEvents', () => {
    it("reads the caller's rows for this chapter's events in one read", async () => {
      mockAttendanceRepo.findByUserForEvents.mockResolvedValue([
        baseAttendance,
      ]);

      await expect(
        service.getMyAttendanceForEvents('user-1', 'ch-1', [
          { id: 'evt-1', chapter_id: 'ch-1' },
          { id: 'evt-2', chapter_id: 'ch-1' },
        ]),
      ).resolves.toEqual([baseAttendance]);
      expect(mockAttendanceRepo.findByUserForEvents).toHaveBeenCalledWith(
        'user-1',
        ['evt-1', 'evt-2'],
      );
    });

    it("drops another chapter's event instead of reading it", async () => {
      mockAttendanceRepo.findByUserForEvents.mockResolvedValue([]);

      await service.getMyAttendanceForEvents('user-1', 'ch-1', [
        { id: 'evt-1', chapter_id: 'ch-1' },
        { id: 'evt-other', chapter_id: 'ch-2' },
      ]);
      expect(mockAttendanceRepo.findByUserForEvents).toHaveBeenCalledWith(
        'user-1',
        ['evt-1'],
      );
    });

    it('reads nothing when no event is left', async () => {
      await expect(
        service.getMyAttendanceForEvents('user-1', 'ch-1', [
          { id: 'evt-other', chapter_id: 'ch-2' },
        ]),
      ).resolves.toEqual([]);
      expect(mockAttendanceRepo.findByUserForEvents).not.toHaveBeenCalled();
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
      memberFixture({
        role_ids: ['role-member'],
        has_completed_onboarding: true,
        created_at: '2020-01-01T00:00:00.000Z',
        updated_at: '2020-01-01T00:00:00.000Z',
      }),
      memberFixture({
        id: 'member-2',
        user_id: 'user-2',
        role_ids: ['role-member'],
        has_completed_onboarding: true,
        created_at: '2020-01-01T00:00:00.000Z',
        updated_at: '2020-01-01T00:00:00.000Z',
      }),
      memberFixture({
        id: 'member-3',
        user_id: 'user-3',
        role_ids: ['role-exec'],
        has_completed_onboarding: true,
        created_at: '2020-01-01T00:00:00.000Z',
        updated_at: '2020-01-01T00:00:00.000Z',
      }),
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
        others_invited: false,
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

    it('skips members with a pending or approved excuse (#3735)', async () => {
      mockEventRepo.findById.mockResolvedValue(pastEvent);
      mockMemberRepo.findByChapter.mockResolvedValue(members);
      mockAttendanceRepo.findByEvent.mockResolvedValue([]);
      mockExcuseRepo.findUserIdsByEventAndStatus.mockResolvedValue(['user-2']);

      const result = await service.markAutoAbsent('evt-1', 'ch-1');

      expect(result.marked).toBe(2);
      expect(mockExcuseRepo.findUserIdsByEventAndStatus).toHaveBeenCalledWith(
        'ch-1',
        'evt-1',
        ['PENDING', 'APPROVED'],
      );
      const payload = mockAttendanceRepo.createMany.mock.calls[0][0];
      expect(payload.map((r) => r.user_id)).toEqual(['user-1', 'user-3']);
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

    // The cutoff is the check-in window's close, end + 15 minutes, never its
    // opening: marking absent while check-in is still open would refuse the
    // members still arriving (their row would exist).
    it('refuses until the check-in window closes, and runs once it has', async () => {
      const endedEvent: Event = {
        ...baseEvent,
        is_mandatory: true,
        start_time: '2026-02-26T18:00:00.000Z',
        end_time: '2026-02-26T19:00:00.000Z',
      };
      mockEventRepo.findById.mockResolvedValue(endedEvent);
      mockMemberRepo.findByChapter.mockResolvedValue([]);
      jest.useFakeTimers();
      try {
        jest.setSystemTime(new Date('2026-02-26T19:14:00.000Z'));
        await expect(service.markAutoAbsent('evt-1', 'ch-1')).rejects.toThrow(
          'Cannot mark auto-absent before the grace period ends',
        );

        jest.setSystemTime(new Date('2026-02-26T19:16:00.000Z'));
        await expect(service.markAutoAbsent('evt-1', 'ch-1')).resolves.toEqual({
          marked: 0,
        });
      } finally {
        jest.useRealTimers();
      }
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
        'https://app.frapp.live',
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
        'https://app.frapp.live',
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
        'https://app.frapp.live',
      );

      await expect(
        service.checkIn('evt-1', 'user-1', 'ch-1', { token }),
      ).rejects.toThrow(ForbiddenException);
      expect(mockAttendanceRepo.checkInAtomic).not.toHaveBeenCalled();
    });

    it('rejects a token from four windows ago', async () => {
      const { token } = mintCheckInToken(
        'evt-1',
        SECRET,
        duringEvent.getTime() - 4 * CHECK_IN_TOKEN_WINDOW_MS,
        'https://app.frapp.live',
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

    // `events.md` keeps the chat event card as a token-less check-in surface
    // until an officer's screen shows the code (#4532, covered below). This
    // pins the first half, so a change to it is a visible decision.
    it('still allows a check-in with no token while no screen has shown the code', async () => {
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
        'https://app.frapp.live',
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
        /use the Frapp mobile app to check in/,
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

  describe('requiresMember', () => {
    it('is true for a member a mandatory event requires by default', async () => {
      await expect(
        service.requiresMember('ch-1', { ...baseEvent, is_mandatory: true }, [
          'role-member',
        ]),
      ).resolves.toBe(true);
    });

    it('is false on an optional event', async () => {
      await expect(
        service.requiresMember('ch-1', baseEvent, ['role-member']),
      ).resolves.toBe(false);
    });

    it('leaves out an alumnus required only by the default, as the sweep does', async () => {
      mockRbac.getAlumniRoleId.mockResolvedValue('role-alumni');
      await expect(
        service.requiresMember('ch-1', { ...baseEvent, is_mandatory: true }, [
          'role-alumni',
        ]),
      ).resolves.toBe(false);
    });

    it('holds an alumnus whose role the event names as required', async () => {
      mockRbac.getAlumniRoleId.mockResolvedValue('role-alumni');
      await expect(
        service.requiresMember(
          'ch-1',
          { ...baseEvent, required_role_ids: ['role-alumni'] },
          ['role-alumni'],
        ),
      ).resolves.toBe(true);
    });
  });

  // ── Near the QR screen (#4532) ──────────────────────────────────────
  //
  // The officer's phone showing the code is the zone: a member must be within
  // 100 yards of it (plus each phone's accuracy, capped at 50 m), and once it
  // has shown the code, the code is required.
  describe('Check-in near the QR screen', () => {
    const duringEvent = new Date('2026-02-26T18:30:00.000Z');
    const SECRET = 'spec-check-in-secret';
    let previousSecret: string | undefined;

    // The front steps of a plausible chapter house.
    const house = { lat: 42.7298, lng: -73.678 };
    const locatedScreen: EventCheckInScreen = {
      event_id: 'evt-1',
      reported_by: 'officer-1',
      chapter_id: 'ch-1',
      lat: house.lat,
      lng: house.lng,
      accuracy_m: 10,
      located_at: duringEvent.toISOString(),
      shown_at: duringEvent.toISOString(),
      expires_at: '2026-02-26T19:15:00.000Z',
    };
    const unlocatedScreen: EventCheckInScreen = {
      ...locatedScreen,
      lat: null,
      lng: null,
      accuracy_m: null,
      located_at: null,
    };
    // One degree of latitude is about 111,195 m.
    const north = (meters: number) => ({
      lat: house.lat + meters / 111_195,
      lng: house.lng,
    });
    const freshToken = () =>
      mintCheckInToken(
        'evt-1',
        SECRET,
        duringEvent.getTime(),
        'https://app.frapp.live',
      ).token;

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

    it('words each refusal through the shared error map', () => {
      // The clients show these through `SERVER_MESSAGE_COPY`, keyed by the
      // exact sentence: a rewording here without the map would fall back to
      // a generic refusal.
      for (const sentence of [
        CHECK_IN_NEEDS_CODE,
        CHECK_IN_NEEDS_LOCATION,
        CHECK_IN_TOO_FAR,
      ]) {
        expect(SERVER_MESSAGE_COPY[sentence]).toEqual(expect.any(String));
      }
    });

    it('reads only live screen rows', async () => {
      await service.checkIn('evt-1', 'user-1', 'ch-1');
      expect(mockScreenRepo.findLive).toHaveBeenCalledWith(
        'evt-1',
        'ch-1',
        duringEvent.toISOString(),
      );
    });

    it('checks in a member standing in the room', async () => {
      mockScreenRepo.findLive.mockResolvedValue([locatedScreen]);

      await expect(
        service.checkIn('evt-1', 'user-1', 'ch-1', {
          token: freshToken(),
          ...north(30),
          accuracyMeters: 20,
        }),
      ).resolves.toEqual(baseAttendance);
    });

    it('takes a link scanned 90 seconds back when a located screen checks where the member is', async () => {
      // The camera banner, the app starting and a location prompt sit between
      // the scan and the request (`check-in-token.ts`).
      const scannedEarlier = mintCheckInToken(
        'evt-1',
        SECRET,
        duringEvent.getTime() - 3 * CHECK_IN_TOKEN_WINDOW_MS,
        'https://app.frapp.live',
      ).token;
      mockScreenRepo.findLive.mockResolvedValue([locatedScreen]);
      await expect(
        service.checkIn('evt-1', 'user-1', 'ch-1', {
          token: scannedEarlier,
          ...north(30),
          accuracyMeters: 20,
        }),
      ).resolves.toEqual(baseAttendance);
    });

    it('keeps a link to one spare window when nothing checks where the member is', async () => {
      // A screen that stored no location anchors nothing, so the token is the
      // only proof: a forwarded link must not last two minutes.
      const scannedEarlier = mintCheckInToken(
        'evt-1',
        SECRET,
        duringEvent.getTime() - 2 * CHECK_IN_TOKEN_WINDOW_MS,
        'https://app.frapp.live',
      ).token;
      mockScreenRepo.findLive.mockResolvedValue([unlocatedScreen]);
      await expect(
        service.checkIn('evt-1', 'user-1', 'ch-1', { token: scannedEarlier }),
      ).rejects.toThrow(ForbiddenException);
      expect(mockAttendanceRepo.checkInAtomic).not.toHaveBeenCalled();
    });

    it('logs why a check-in was refused, without where the member was', async () => {
      const log = jest.mocked(enqueueSanitizedLog);
      log.mockClear();
      mockScreenRepo.findLive.mockResolvedValue([locatedScreen]);

      await expect(
        service.checkIn('evt-1', 'user-1', 'ch-1', { token: freshToken() }),
      ).rejects.toThrow(CHECK_IN_NEEDS_LOCATION);
      expect(log).toHaveBeenLastCalledWith(
        expect.objectContaining({
          body: 'check_in_refused',
          attributes: expect.objectContaining({
            reason: 'needs_location',
            has_code: true,
            has_location: false,
          }),
        }),
      );

      const far = north(274);
      await expect(
        service.checkIn('evt-1', 'user-1', 'ch-1', {
          token: freshToken(),
          ...far,
          accuracyMeters: 20,
        }),
      ).rejects.toThrow(CHECK_IN_TOO_FAR);
      const entry = log.mock.lastCall![0];
      expect(entry.attributes).toMatchObject({
        reason: 'too_far',
        has_location: true,
      });
      const written = JSON.stringify(entry);
      expect(written).not.toContain(String(far.lat));
      expect(written).not.toContain('evt-1');
      expect(written).not.toContain('user-1');
    });

    it('mints the QR as a check-in link on the configured dashboard origin', async () => {
      const previous = process.env.APP_URL;
      process.env.APP_URL = 'https://app.staging.frapp.live/';
      try {
        const minted = await service.mintCheckInToken('evt-1', 'ch-1');
        expect(minted.qrPayload).toBe(
          `https://app.staging.frapp.live/check-in?event=evt-1&t=${minted.token}`,
        );
      } finally {
        if (previous === undefined) delete process.env.APP_URL;
        else process.env.APP_URL = previous;
      }
    });

    it('refuses a member 300 yards away holding a fresh code, before any write', async () => {
      mockScreenRepo.findLive.mockResolvedValue([locatedScreen]);

      await expect(
        service.checkIn('evt-1', 'user-1', 'ch-1', {
          token: freshToken(),
          ...north(274),
          accuracyMeters: 20,
        }),
      ).rejects.toThrow(CHECK_IN_TOO_FAR);
      expect(mockAttendanceRepo.checkInAtomic).not.toHaveBeenCalled();
    });

    it('widens the radius by each phone accuracy, and caps it', async () => {
      mockScreenRepo.findLive.mockResolvedValue([
        { ...locatedScreen, accuracy_m: 40 },
      ]);

      // 91 m + 40 m + 30 m = 161 m allowed: 150 m passes.
      await expect(
        service.checkIn('evt-1', 'user-1', 'ch-1', {
          token: freshToken(),
          ...north(150),
          accuracyMeters: 30,
        }),
      ).resolves.toEqual(baseAttendance);

      // A 2 km circle adds only 50 m: 91 + 40 + 50 = 181 m, so 200 m fails.
      await expect(
        service.checkIn('evt-1', 'user-1', 'ch-1', {
          token: freshToken(),
          ...north(200),
          accuracyMeters: 2000,
        }),
      ).rejects.toThrow(CHECK_IN_TOO_FAR);
    });

    it('asks for the member location when the screen has one', async () => {
      mockScreenRepo.findLive.mockResolvedValue([locatedScreen]);

      await expect(
        service.checkIn('evt-1', 'user-1', 'ch-1', { token: freshToken() }),
      ).rejects.toThrow(CHECK_IN_NEEDS_LOCATION);
      expect(mockAttendanceRepo.checkInAtomic).not.toHaveBeenCalled();
    });

    it('requires the code once a screen has shown it', async () => {
      mockScreenRepo.findLive.mockResolvedValue([locatedScreen]);

      // The chat event card's bare body, even from inside the room.
      await expect(
        service.checkIn('evt-1', 'user-1', 'ch-1', north(10)),
      ).rejects.toThrow(CHECK_IN_NEEDS_CODE);
      expect(mockAttendanceRepo.checkInAtomic).not.toHaveBeenCalled();
    });

    it('requires the code for an event with a drawn zone too', async () => {
      mockScreenRepo.findLive.mockResolvedValue([unlocatedScreen]);
      mockEventRepo.findById.mockResolvedValue({
        ...baseEvent,
        check_in_zone: [
          { lat: 42.729, lng: -73.679 },
          { lat: 42.729, lng: -73.677 },
          { lat: 42.731, lng: -73.677 },
          { lat: 42.731, lng: -73.679 },
        ],
      });

      await expect(
        service.checkIn('evt-1', 'user-1', 'ch-1', house),
      ).rejects.toThrow(CHECK_IN_NEEDS_CODE);
    });

    it('tells a member already checked in so, before asking for the code', async () => {
      mockScreenRepo.findLive.mockResolvedValue([locatedScreen]);
      mockAttendanceRepo.findByEventAndUser.mockResolvedValue(baseAttendance);

      await expect(service.checkIn('evt-1', 'user-1', 'ch-1')).rejects.toThrow(
        ConflictException,
      );
    });

    it('passes a member near any located screen, and ignores one that has none', async () => {
      // A second door 400 m north, and a laptop that can't tell where it is.
      mockScreenRepo.findLive.mockResolvedValue([
        locatedScreen,
        {
          ...locatedScreen,
          reported_by: 'officer-2',
          ...north(400),
        },
        { ...unlocatedScreen, reported_by: 'officer-3' },
      ]);

      await expect(
        service.checkIn('evt-1', 'user-1', 'ch-1', {
          token: freshToken(),
          ...north(420),
          accuracyMeters: 10,
        }),
      ).resolves.toEqual(baseAttendance);
      await expect(
        service.checkIn('evt-1', 'user-1', 'ch-1', {
          token: freshToken(),
          ...north(250),
          accuracyMeters: 10,
        }),
      ).rejects.toThrow(CHECK_IN_TOO_FAR);
    });

    it('checks the typed code against the screen too', async () => {
      mockScreenRepo.findLive.mockResolvedValue([locatedScreen]);
      const { manualCode } = mintCheckInToken(
        'evt-1',
        SECRET,
        duringEvent.getTime(),
        'https://app.frapp.live',
      );

      await expect(
        service.checkIn('evt-1', 'user-1', 'ch-1', {
          manualCode,
          ...north(500),
        }),
      ).rejects.toThrow(CHECK_IN_TOO_FAR);
    });

    it('requires the code but checks no distance when no screen could tell where it is', async () => {
      mockScreenRepo.findLive.mockResolvedValue([unlocatedScreen]);

      await expect(service.checkIn('evt-1', 'user-1', 'ch-1')).rejects.toThrow(
        CHECK_IN_NEEDS_CODE,
      );
      await expect(
        service.checkIn('evt-1', 'user-1', 'ch-1', { token: freshToken() }),
      ).resolves.toEqual(baseAttendance);
    });

    it('lets a drawn zone win over the screen', async () => {
      mockScreenRepo.findLive.mockResolvedValue([locatedScreen]);
      mockEventRepo.findById.mockResolvedValue({
        ...baseEvent,
        // A box around a building 1 km north of the screen.
        check_in_zone: [
          { lat: 42.738, lng: -73.6785 },
          { lat: 42.738, lng: -73.6775 },
          { lat: 42.7387, lng: -73.6775 },
          { lat: 42.7387, lng: -73.6785 },
        ],
      });

      await expect(
        service.checkIn('evt-1', 'user-1', 'ch-1', {
          token: freshToken(),
          lat: 42.7383,
          lng: -73.678,
        }),
      ).resolves.toEqual(baseAttendance);
    });

    describe('reportCheckInScreen', () => {
      beforeEach(() => {
        mockScreenRepo.recordShown.mockImplementation(async (input) => ({
          ...unlocatedScreen,
          reported_by: input.reportedBy,
          ...(input.location
            ? {
                lat: input.location.lat,
                lng: input.location.lng,
                accuracy_m: input.location.accuracy_m,
                located_at: input.nowIso,
              }
            : {}),
          expires_at: input.expiresAt,
        }));
      });

      it('stores a precise fix until check-in closes', async () => {
        await expect(
          service.reportCheckInScreen('evt-1', 'ch-1', 'officer-1', {
            ...house,
            accuracyMeters: 12,
          }),
        ).resolves.toEqual({ check: 'screen' });
        expect(mockScreenRepo.recordShown).toHaveBeenCalledWith({
          eventId: 'evt-1',
          reportedBy: 'officer-1',
          chapterId: 'ch-1',
          nowIso: duringEvent.toISOString(),
          // 19:00 end plus the 15-minute grace.
          expiresAt: '2026-02-26T19:15:00.000Z',
          location: { ...house, accuracy_m: 12 },
        });
      });

      it('stores no location from a fix worse than 100 m, or with no accuracy', async () => {
        await expect(
          service.reportCheckInScreen('evt-1', 'ch-1', 'officer-1', {
            ...house,
            accuracyMeters: 450,
          }),
        ).resolves.toEqual({ check: 'no_location' });
        await expect(
          service.reportCheckInScreen('evt-1', 'ch-1', 'officer-1', house),
        ).resolves.toEqual({ check: 'no_location' });
        await expect(
          service.reportCheckInScreen('evt-1', 'ch-1', 'officer-1', {}),
        ).resolves.toEqual({ check: 'no_location' });
        for (const [input] of mockScreenRepo.recordShown.mock.calls) {
          expect(input.location).toBeNull();
        }
      });

      it("tells a screen with no fix when another officer's screen is checking distance", async () => {
        mockScreenRepo.findLive.mockResolvedValue([
          { ...unlocatedScreen, reported_by: 'officer-2' },
          { ...locatedScreen, reported_by: 'officer-3' },
        ]);

        await expect(
          service.reportCheckInScreen('evt-1', 'ch-1', 'officer-2', {}),
        ).resolves.toEqual({ check: 'other_screen' });
        // This officer's own row is replaced with no location, so their old
        // spot never lingers.
        expect(mockScreenRepo.recordShown.mock.calls[0][0]).toMatchObject({
          reportedBy: 'officer-2',
          location: null,
        });
      });

      it('stores no location for an event with a drawn zone', async () => {
        mockEventRepo.findById.mockResolvedValue({
          ...baseEvent,
          check_in_zone: [
            { lat: 1, lng: 1 },
            { lat: 1, lng: 2 },
            { lat: 2, lng: 2 },
          ],
        });

        await expect(
          service.reportCheckInScreen('evt-1', 'ch-1', 'officer-1', {
            ...house,
            accuracyMeters: 5,
          }),
        ).resolves.toEqual({ check: 'zone' });
        expect(mockScreenRepo.recordShown.mock.calls[0][0].location).toBeNull();
      });

      it('stores nothing before check-in opens or after it closes', async () => {
        jest.setSystemTime(new Date('2026-02-26T17:30:00.000Z'));
        await expect(
          service.reportCheckInScreen('evt-1', 'ch-1', 'officer-1', {
            ...house,
            accuracyMeters: 5,
          }),
        ).resolves.toEqual({ check: 'not_open' });

        jest.setSystemTime(new Date('2026-02-26T19:20:00.000Z'));
        await expect(
          service.reportCheckInScreen('evt-1', 'ch-1', 'officer-1', {
            ...house,
            accuracyMeters: 5,
          }),
        ).resolves.toEqual({ check: 'closed' });

        expect(mockScreenRepo.recordShown).not.toHaveBeenCalled();
      });

      it('sweeps closed rows through the repository', async () => {
        mockScreenRepo.deleteExpired.mockResolvedValue(3);

        await expect(service.deleteExpiredCheckInScreens()).resolves.toBe(3);
        expect(mockScreenRepo.deleteExpired).toHaveBeenCalledWith(
          duringEvent.toISOString(),
        );
      });

      it('404s an event outside the caller chapter', async () => {
        mockEventRepo.findById.mockResolvedValue(null);

        await expect(
          service.reportCheckInScreen('evt-1', 'ch-1', 'officer-1', {}),
        ).rejects.toThrow(NotFoundException);
      });
    });
  });
});
