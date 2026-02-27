import { Test, TestingModule } from '@nestjs/testing';
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { AttendanceService } from './attendance.service';
import { ATTENDANCE_REPOSITORY } from '../../domain/repositories/attendance.repository.interface';
import type { IAttendanceRepository } from '../../domain/repositories/attendance.repository.interface';
import { EVENT_REPOSITORY } from '../../domain/repositories/event.repository.interface';
import type { IEventRepository } from '../../domain/repositories/event.repository.interface';
import { POINT_TRANSACTION_REPOSITORY } from '../../domain/repositories/point-transaction.repository.interface';
import type { IPointTransactionRepository } from '../../domain/repositories/point-transaction.repository.interface';
import { MEMBER_REPOSITORY } from '../../domain/repositories/member.repository.interface';
import type { IMemberRepository } from '../../domain/repositories/member.repository.interface';
import type { Event } from '../../domain/entities/event.entity';
import type { EventAttendance } from '../../domain/entities/event-attendance.entity';
import type { PointTransaction } from '../../domain/entities/point-transaction.entity';
import type { Member } from '../../domain/entities/member.entity';

describe('AttendanceService', () => {
  let service: AttendanceService;
  let mockAttendanceRepo: jest.Mocked<IAttendanceRepository>;
  let mockEventRepo: jest.Mocked<IEventRepository>;
  let mockPointTxnRepo: jest.Mocked<IPointTransactionRepository>;
  let mockMemberRepo: jest.Mocked<IMemberRepository>;

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

  const basePointTxn: PointTransaction = {
    id: 'pt-1',
    chapter_id: 'ch-1',
    user_id: 'user-1',
    amount: 10,
    category: 'ATTENDANCE',
    description: 'Attendance for event: Chapter Meeting',
    metadata: { event_id: 'evt-1' },
    created_at: '2026-02-26T18:30:00.000Z',
  };

  beforeEach(async () => {
    mockAttendanceRepo = {
      findById: jest.fn(),
      findByEvent: jest.fn(),
      findByEventAndUser: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
      delete: jest.fn(),
    };

    mockEventRepo = {
      findById: jest.fn(),
      findByChapter: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
      delete: jest.fn(),
    };

    mockPointTxnRepo = {
      create: jest.fn(),
      findByUser: jest.fn(),
      findByChapter: jest.fn(),
    };

    mockMemberRepo = {
      findById: jest.fn(),
      findByUserAndChapter: jest.fn(),
      findByChapter: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
      delete: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AttendanceService,
        { provide: ATTENDANCE_REPOSITORY, useValue: mockAttendanceRepo },
        { provide: EVENT_REPOSITORY, useValue: mockEventRepo },
        { provide: POINT_TRANSACTION_REPOSITORY, useValue: mockPointTxnRepo },
        { provide: MEMBER_REPOSITORY, useValue: mockMemberRepo },
      ],
    }).compile();

    service = module.get(AttendanceService);
  });

  describe('checkIn', () => {
    it('should create attendance and point transaction when within event window', async () => {
      const duringEvent = new Date('2026-02-26T18:30:00.000Z');
      jest.useFakeTimers();
      jest.setSystemTime(duringEvent);

      mockEventRepo.findById.mockResolvedValue(baseEvent);
      mockAttendanceRepo.findByEventAndUser.mockResolvedValue(null);
      mockAttendanceRepo.create.mockResolvedValue(baseAttendance);
      mockPointTxnRepo.create.mockResolvedValue(basePointTxn);

      const result = await service.checkIn('evt-1', 'user-1', 'ch-1');

      expect(mockEventRepo.findById).toHaveBeenCalledWith('evt-1', 'ch-1');
      expect(mockAttendanceRepo.findByEventAndUser).toHaveBeenCalledWith(
        'evt-1',
        'user-1',
      );
      expect(mockAttendanceRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({
          event_id: 'evt-1',
          user_id: 'user-1',
          status: 'PRESENT',
          excuse_reason: null,
          marked_by: null,
        }),
      );
      expect(mockPointTxnRepo.create).toHaveBeenCalledWith({
        chapter_id: 'ch-1',
        user_id: 'user-1',
        amount: 10,
        category: 'ATTENDANCE',
        description: 'Attendance for event: Chapter Meeting',
        metadata: { event_id: 'evt-1' },
      });
      expect(result).toEqual(baseAttendance);

      jest.useRealTimers();
    });

    it('should allow check-in within the grace period after event end', async () => {
      const justAfterEnd = new Date('2026-02-26T19:10:00.000Z');
      jest.useFakeTimers();
      jest.setSystemTime(justAfterEnd);

      mockEventRepo.findById.mockResolvedValue(baseEvent);
      mockAttendanceRepo.findByEventAndUser.mockResolvedValue(null);
      mockAttendanceRepo.create.mockResolvedValue(baseAttendance);
      mockPointTxnRepo.create.mockResolvedValue(basePointTxn);

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
      expect(mockAttendanceRepo.create).not.toHaveBeenCalled();
      expect(mockPointTxnRepo.create).not.toHaveBeenCalled();
      jest.useRealTimers();
    });

    it('should rollback attendance row when points creation fails', async () => {
      const duringEvent = new Date('2026-02-26T18:30:00.000Z');
      jest.useFakeTimers();
      jest.setSystemTime(duringEvent);

      mockEventRepo.findById.mockResolvedValue(baseEvent);
      mockAttendanceRepo.findByEventAndUser.mockResolvedValue(null);
      mockAttendanceRepo.create.mockResolvedValue(baseAttendance);
      mockPointTxnRepo.create.mockRejectedValue(new Error('points write failed'));

      await expect(service.checkIn('evt-1', 'user-1', 'ch-1')).rejects.toThrow(
        'points write failed',
      );
      expect(mockAttendanceRepo.delete).toHaveBeenCalledWith('att-1');
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

      expect(mockAttendanceRepo.create).not.toHaveBeenCalled();
      expect(mockPointTxnRepo.create).not.toHaveBeenCalled();
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

      expect(mockAttendanceRepo.create).not.toHaveBeenCalled();
      expect(mockPointTxnRepo.create).not.toHaveBeenCalled();
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

      expect(mockAttendanceRepo.create).not.toHaveBeenCalled();
      expect(mockPointTxnRepo.create).not.toHaveBeenCalled();
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
        NotFoundException,
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
});
