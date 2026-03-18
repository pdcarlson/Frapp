import { Test, TestingModule } from '@nestjs/testing';
import {
  StudyGeofenceController,
  StudySessionController,
} from './study.controller';
import { StudyService } from '../../application/services/study.service';
import { SupabaseAuthGuard } from '../guards/supabase-auth.guard';
import { ChapterGuard } from '../guards/chapter.guard';
import { PermissionsGuard } from '../guards/permissions.guard';

describe('StudyController', () => {
  let geofenceController: StudyGeofenceController;
  let sessionController: StudySessionController;
  let studyService: jest.Mocked<StudyService>;

  beforeEach(async () => {
    const mockStudyService = {
      listGeofences: jest.fn(),
      createGeofence: jest.fn(),
      updateGeofence: jest.fn(),
      deleteGeofence: jest.fn(),
      startSession: jest.fn(),
      heartbeat: jest.fn(),
      stopSession: jest.fn(),
      listSessions: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [StudyGeofenceController, StudySessionController],
      providers: [
        {
          provide: StudyService,
          useValue: mockStudyService,
        },
        {
          provide: 'SUPABASE_CLIENT',
          useValue: {},
        },
      ],
    })
      .overrideGuard(SupabaseAuthGuard)
      .useValue({ canActivate: () => true })
      .overrideGuard(ChapterGuard)
      .useValue({ canActivate: () => true })
      .overrideGuard(PermissionsGuard)
      .useValue({ canActivate: () => true })
      .compile();

    geofenceController = module.get<StudyGeofenceController>(
      StudyGeofenceController,
    );
    sessionController = module.get<StudySessionController>(
      StudySessionController,
    );
    studyService = module.get(StudyService);
  });

  describe('StudyGeofenceController', () => {
    it('should be defined', () => {
      expect(geofenceController).toBeDefined();
    });

    describe('list', () => {
      it('should call studyService.listGeofences with correct chapterId', async () => {
        const chapterId = 'chapter-123';
        const expectedResult = [{ id: 'geo-1' }];
        studyService.listGeofences.mockResolvedValue(expectedResult as any);

        const result = await geofenceController.list(chapterId);

        expect(studyService.listGeofences).toHaveBeenCalledWith(chapterId);
        expect(result).toEqual(expectedResult);
      });
    });

    describe('create', () => {
      it('should call studyService.createGeofence with correct payload', async () => {
        const chapterId = 'chapter-123';
        const dto = {
          name: 'Library',
          coordinates: [{ lat: 1, lng: 1 }],
          is_active: true,
          minutes_per_point: 60,
          points_per_interval: 1,
          min_session_minutes: 30,
        };
        const expectedResult = { id: 'geo-1', ...dto };
        studyService.createGeofence.mockResolvedValue(expectedResult as any);

        const result = await geofenceController.create(chapterId, dto);

        expect(studyService.createGeofence).toHaveBeenCalledWith(chapterId, dto);
        expect(result).toEqual(expectedResult);
      });
    });

    describe('update', () => {
      it('should call studyService.updateGeofence with correct id, chapterId, and payload', async () => {
        const chapterId = 'chapter-123';
        const geofenceId = 'geo-1';
        const dto = { name: 'Updated Library' };
        const expectedResult = { id: geofenceId, ...dto };
        studyService.updateGeofence.mockResolvedValue(expectedResult as any);

        const result = await geofenceController.update(chapterId, geofenceId, dto);

        expect(studyService.updateGeofence).toHaveBeenCalledWith(
          geofenceId,
          chapterId,
          dto,
        );
        expect(result).toEqual(expectedResult);
      });
    });

    describe('delete', () => {
      it('should call studyService.deleteGeofence and return success', async () => {
        const chapterId = 'chapter-123';
        const geofenceId = 'geo-1';
        studyService.deleteGeofence.mockResolvedValue(undefined as any);

        const result = await geofenceController.delete(chapterId, geofenceId);

        expect(studyService.deleteGeofence).toHaveBeenCalledWith(
          geofenceId,
          chapterId,
        );
        expect(result).toEqual({ success: true });
      });
    });
  });

  describe('StudySessionController', () => {
    it('should be defined', () => {
      expect(sessionController).toBeDefined();
    });

    describe('start', () => {
      it('should call studyService.startSession with correct arguments', async () => {
        const userId = 'user-123';
        const chapterId = 'chapter-123';
        const dto = { geofence_id: 'geo-1', lat: 10, lng: 20 };
        const expectedResult = { id: 'session-1' };
        studyService.startSession.mockResolvedValue(expectedResult as any);

        const result = await sessionController.start(userId, chapterId, dto);

        expect(studyService.startSession).toHaveBeenCalledWith(
          userId,
          chapterId,
          dto.geofence_id,
          dto.lat,
          dto.lng,
        );
        expect(result).toEqual(expectedResult);
      });
    });

    describe('heartbeat', () => {
      it('should call studyService.heartbeat with correct arguments', async () => {
        const userId = 'user-123';
        const chapterId = 'chapter-123';
        const dto = { lat: 10, lng: 20 };
        const expectedResult = { status: 'ok' };
        studyService.heartbeat.mockResolvedValue(expectedResult as any);

        const result = await sessionController.heartbeat(userId, chapterId, dto);

        expect(studyService.heartbeat).toHaveBeenCalledWith(
          userId,
          chapterId,
          dto.lat,
          dto.lng,
        );
        expect(result).toEqual(expectedResult);
      });
    });

    describe('stop', () => {
      it('should call studyService.stopSession with correct arguments', async () => {
        const userId = 'user-123';
        const chapterId = 'chapter-123';
        const expectedResult = { id: 'session-1', points: 10 };
        studyService.stopSession.mockResolvedValue(expectedResult as any);

        const result = await sessionController.stop(userId, chapterId);

        expect(studyService.stopSession).toHaveBeenCalledWith(
          userId,
          chapterId,
        );
        expect(result).toEqual(expectedResult);
      });
    });

    describe('list', () => {
      it('should call studyService.listSessions with correct arguments', async () => {
        const userId = 'user-123';
        const chapterId = 'chapter-123';
        const expectedResult = [{ id: 'session-1' }];
        studyService.listSessions.mockResolvedValue(expectedResult as any);

        const result = await sessionController.list(userId, chapterId);

        expect(studyService.listSessions).toHaveBeenCalledWith(
          userId,
          chapterId,
        );
        expect(result).toEqual(expectedResult);
      });
    });
  });
});
