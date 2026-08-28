import { Test, TestingModule } from '@nestjs/testing';
import { AttendanceController } from './attendance.controller';
import { AttendanceService } from '../../application/services/attendance.service';
import { CheckInDto, UpdateAttendanceDto } from '../dtos/attendance.dto';
import { PERMISSIONS_KEY } from '../decorators/permissions.decorator';
import { SystemPermissions } from '../../domain/constants/permissions';

describe('AttendanceController', () => {
  let controller: AttendanceController;
  let attendanceService: jest.Mocked<Partial<AttendanceService>>;

  beforeEach(async () => {
    attendanceService = {
      checkIn: jest.fn(),
      getAttendance: jest.fn(),
      updateStatus: jest.fn(),
      markAutoAbsent: jest.fn(),
      mintCheckInToken: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [AttendanceController],
      providers: [
        {
          provide: AttendanceService,
          useValue: attendanceService,
        },
        {
          provide: 'SUPABASE_CLIENT',
          useValue: {},
        },
      ],
    }).compile();

    controller = module.get<AttendanceController>(AttendanceController);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });

  describe('checkIn', () => {
    it('should call attendanceService.checkIn with correct parameters', async () => {
      const eventId = 'event-1';
      const userId = 'user-1';
      const chapterId = 'chapter-1';
      const dto: CheckInDto = {};
      const expectedResult = { success: true };

      attendanceService.checkIn!.mockResolvedValue(expectedResult as any);

      const result = await controller.checkIn(eventId, userId, chapterId, dto);

      expect(attendanceService.checkIn).toHaveBeenCalledWith(
        eventId,
        userId,
        chapterId,
        {
          token: undefined,
          manualCode: undefined,
          lat: undefined,
          lng: undefined,
        },
      );
      expect(result).toEqual(expectedResult);
    });

    it('forwards the scanner payload instead of discarding the DTO', async () => {
      // The defect this slice fixes: the controller used to `void dto;`, so a
      // scanned token and the member's coordinates never reached the service.
      const dto: CheckInDto = {
        token: 'signed-token',
        manualCode: '4KQ-88',
        lat: 42.7298,
        lng: -73.678,
      };
      attendanceService.checkIn!.mockResolvedValue({ ok: true } as any);

      await controller.checkIn('event-1', 'user-1', 'chapter-1', dto);

      expect(attendanceService.checkIn).toHaveBeenCalledWith(
        'event-1',
        'user-1',
        'chapter-1',
        {
          token: 'signed-token',
          manualCode: '4KQ-88',
          lat: 42.7298,
          lng: -73.678,
        },
      );
    });
  });

  describe('mintCheckInToken', () => {
    it('should call attendanceService.mintCheckInToken with correct parameters', async () => {
      const expectedResult = { token: 't', manualCode: '4KQ-88' };
      attendanceService.mintCheckInToken!.mockResolvedValue(
        expectedResult as any,
      );

      const result = await controller.mintCheckInToken('event-1', 'chapter-1');

      expect(attendanceService.mintCheckInToken).toHaveBeenCalledWith(
        'event-1',
        'chapter-1',
      );
      expect(result).toEqual(expectedResult);
    });

    // The mint route hands out what admits members to the attendance record, so
    // it must carry the same officer gate as the roster read on this controller.
    // Asserted off the route metadata rather than by exercising the guard: the
    // guard itself is covered by its own spec, and what regresses in practice is
    // someone adding a route and forgetting the decorator.
    it('is gated on events:update', () => {
      const permissions = Reflect.getMetadata(
        PERMISSIONS_KEY,
        AttendanceController.prototype.mintCheckInToken,
      ) as string[] | undefined;

      expect(permissions).toEqual([SystemPermissions.EVENTS_UPDATE]);
    });

    it('does not gate plain self check-in, which every member may do', () => {
      const permissions = Reflect.getMetadata(
        PERMISSIONS_KEY,
        AttendanceController.prototype.checkIn,
      ) as string[] | undefined;

      expect(permissions).toBeUndefined();
    });
  });

  describe('list', () => {
    it('should call attendanceService.getAttendance with correct parameters', async () => {
      const eventId = 'event-1';
      const chapterId = 'chapter-1';
      const expectedResult = [{ id: 'attendance-1' }];

      attendanceService.getAttendance!.mockResolvedValue(expectedResult as any);

      const result = await controller.list(eventId, chapterId);

      expect(attendanceService.getAttendance).toHaveBeenCalledWith(
        eventId,
        chapterId,
      );
      expect(result).toEqual(expectedResult);
    });
  });

  describe('updateStatus', () => {
    it('should call attendanceService.updateStatus with correct parameters', async () => {
      const eventId = 'event-1';
      const userId = 'user-1';
      const chapterId = 'chapter-1';
      const adminId = 'admin-1';
      const dto: UpdateAttendanceDto = {
        status: 'PRESENT',
        excuse_reason: 'Sick',
      };
      const expectedResult = { id: 'attendance-1' };

      attendanceService.updateStatus!.mockResolvedValue(expectedResult as any);

      const result = await controller.updateStatus(
        eventId,
        userId,
        chapterId,
        adminId,
        dto,
      );

      expect(attendanceService.updateStatus).toHaveBeenCalledWith(
        eventId,
        userId,
        chapterId,
        dto.status,
        dto.excuse_reason,
        adminId,
      );
      expect(result).toEqual(expectedResult);
    });

    it('should fallback excuse_reason to null if not provided', async () => {
      const eventId = 'event-1';
      const userId = 'user-1';
      const chapterId = 'chapter-1';
      const adminId = 'admin-1';
      const dto: UpdateAttendanceDto = {
        status: 'PRESENT',
      };
      const expectedResult = { id: 'attendance-1' };

      attendanceService.updateStatus!.mockResolvedValue(expectedResult as any);

      const result = await controller.updateStatus(
        eventId,
        userId,
        chapterId,
        adminId,
        dto,
      );

      expect(attendanceService.updateStatus).toHaveBeenCalledWith(
        eventId,
        userId,
        chapterId,
        dto.status,
        null,
        adminId,
      );
      expect(result).toEqual(expectedResult);
    });
  });

  describe('markAutoAbsent', () => {
    it('should call attendanceService.markAutoAbsent with correct parameters', async () => {
      const eventId = 'event-1';
      const chapterId = 'chapter-1';
      const expectedResult = { marked: 5 };

      attendanceService.markAutoAbsent!.mockResolvedValue(
        expectedResult as any,
      );

      const result = await controller.markAutoAbsent(eventId, chapterId);

      expect(attendanceService.markAutoAbsent).toHaveBeenCalledWith(
        eventId,
        chapterId,
      );
      expect(result).toEqual(expectedResult);
    });
  });
});
