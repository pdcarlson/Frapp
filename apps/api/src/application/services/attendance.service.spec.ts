import { Test, TestingModule } from '@nestjs/testing';
import { AttendanceService } from './attendance.service';
import { EVENT_REPOSITORY } from '../../domain/repositories/event.repository.interface';
import { PointsService } from './points.service';
import { NotFoundException, BadRequestException } from '@nestjs/common';

describe('AttendanceService', () => {
  let service: AttendanceService;
  let pointsService: Record<string, any>;

  const mockEventRepo = {
    findById: jest.fn(),
    upsertAttendance: jest.fn(),
    findAttendance: jest.fn(),
  };

  const mockPointsService = {
    awardPoints: jest.fn(),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AttendanceService,
        { provide: EVENT_REPOSITORY, useValue: mockEventRepo },
        { provide: PointsService, useValue: mockPointsService },
      ],
    }).compile();

    service = module.get<AttendanceService>(AttendanceService);
    pointsService = module.get(PointsService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('checkIn', () => {
    const userId = 'u1';
    const chapterId = 'c1';
    const eventId = 'e1';

    it('should throw NotFoundException if event does not exist', async () => {
      mockEventRepo.findById.mockResolvedValue(null);
      await expect(service.checkIn(userId, chapterId, eventId)).rejects.toThrow(
        NotFoundException,
      );
    });

    it('should throw BadRequestException if already checked in', async () => {
      mockEventRepo.findById.mockResolvedValue({ id: eventId });
      mockEventRepo.findAttendance.mockResolvedValue({ status: 'PRESENT' });
      await expect(service.checkIn(userId, chapterId, eventId)).rejects.toThrow(
        BadRequestException,
      );
    });

    it('should upsert attendance and award points', async () => {
      const mockEvent = {
        id: eventId,
        chapterId,
        pointValue: 20,
        name: 'Meeting',
      };
      mockEventRepo.findById.mockResolvedValue(mockEvent);
      mockEventRepo.findAttendance.mockResolvedValue(null);

      await service.checkIn(userId, chapterId, eventId);

      expect(mockEventRepo.upsertAttendance).toHaveBeenCalledWith(
        expect.objectContaining({
          eventId,
          userId,
          status: 'PRESENT',
        }),
      );
      expect(pointsService.awardPoints).toHaveBeenCalledWith(
        userId,
        chapterId,
        20,
        'ATTENDANCE',
        'Attended Meeting',
        { eventId },
      );
    });
  });
});
