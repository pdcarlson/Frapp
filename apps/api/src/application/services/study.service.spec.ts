import { Test, TestingModule } from '@nestjs/testing';
import { StudyService } from './study.service';
import { STUDY_REPOSITORY } from '../../domain/repositories/study.repository.interface';
import { GeoService } from './geo.service';
import { PointsService } from './points.service';
import { NotificationService } from './notification.service';
import { BadRequestException } from '@nestjs/common';

describe('StudyService', () => {
  let service: StudyService;
  let notificationService: {
    notifyUser: jest.Mock;
  };

  const mockStudyRepo = {
    findGeofenceById: jest.fn(),
    findActiveSession: jest.fn(),
    createSession: jest.fn(),
    updateSession: jest.fn(),
    findSessionById: jest.fn(),
  };

  const mockGeoService = {
    isPointInPolygon: jest.fn(),
  };

  const mockPointsService = {
    awardPoints: jest.fn(),
  };

  const mockNotificationService = {
    notifyUser: jest.fn(),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        StudyService,
        { provide: STUDY_REPOSITORY, useValue: mockStudyRepo },
        { provide: GeoService, useValue: mockGeoService },
        { provide: PointsService, useValue: mockPointsService },
        { provide: NotificationService, useValue: mockNotificationService },
      ],
    }).compile();

    service = module.get<StudyService>(StudyService);
    notificationService = mockNotificationService;
    jest.clearAllMocks();
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('startSession', () => {
    it('should start a session if location is valid', async () => {
      const geofence = { id: 'g1', coordinates: [], isActive: true };
      mockStudyRepo.findGeofenceById.mockResolvedValue(geofence);
      mockGeoService.isPointInPolygon.mockReturnValue(true);
      mockStudyRepo.findActiveSession.mockResolvedValue(null);
      mockStudyRepo.createSession.mockResolvedValue({ id: 's1' });

      await service.startSession('u1', 'c1', 'g1', 10, 20);

      expect(mockStudyRepo.createSession).toHaveBeenCalled();
    });

    it('should throw if location is invalid', async () => {
      const geofence = { id: 'g1', coordinates: [], isActive: true };
      mockStudyRepo.findGeofenceById.mockResolvedValue(geofence);
      mockGeoService.isPointInPolygon.mockReturnValue(false);

      await expect(
        service.startSession('u1', 'c1', 'g1', 10, 20),
      ).rejects.toThrow(BadRequestException);
    });
  });

  describe('processHeartbeat', () => {
    it('should update session if inside geofence', async () => {
      const session = {
        id: 's1',
        geofenceId: 'g1',
        userId: 'u1',
        lastHeartbeatAt: new Date(),
      };
      const geofence = { id: 'g1', coordinates: [] };
      mockStudyRepo.findActiveSession.mockResolvedValue(session);
      mockStudyRepo.findGeofenceById.mockResolvedValue(geofence);
      mockGeoService.isPointInPolygon.mockReturnValue(true);

      await service.processHeartbeat('u1', 10, 20);

      expect(mockStudyRepo.updateSession).toHaveBeenCalledWith(
        's1',
        // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
        expect.objectContaining({ lastHeartbeatAt: expect.any(Date) }),
      );
    });

    it('should expire session if outside geofence', async () => {
      const session = {
        id: 's1',
        geofenceId: 'g1',
        userId: 'u1',
        chapterId: 'c1',
      };
      const geofence = { id: 'g1', coordinates: [] };
      mockStudyRepo.findActiveSession.mockResolvedValue(session);
      mockStudyRepo.findGeofenceById.mockResolvedValue(geofence);
      mockGeoService.isPointInPolygon.mockReturnValue(false);

      await service.processHeartbeat('u1', 10, 20);

      expect(mockStudyRepo.updateSession).toHaveBeenCalledWith(
        's1',
        expect.objectContaining({ status: 'EXPIRED' }),
      );
      expect(notificationService.notifyUser).toHaveBeenCalled();
    });
  });
});
