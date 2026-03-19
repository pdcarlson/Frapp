import { Test, TestingModule } from '@nestjs/testing';
import { AttendanceController } from './attendance.controller';
import { AttendanceService } from '../../application/services/attendance.service';
import { CheckInDto, UpdateAttendanceDto } from '../dtos/attendance.dto';

describe('AttendanceController', () => {
  let controller: AttendanceController;
  let attendanceService: jest.Mocked<Partial<AttendanceService>>;

  beforeEach(async () => {
    attendanceService = {
      checkIn: jest.fn(),
      getAttendance: jest.fn(),
      updateStatus: jest.fn(),
      markAutoAbsent: jest.fn(),
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
      );
      expect(result).toEqual(expectedResult);
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
