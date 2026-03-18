import { Test, TestingModule } from '@nestjs/testing';
import { StudyGeofenceController, StudySessionController } from './study.controller';
import { StudyService } from '../../application/services/study.service';
import {
  CreateGeofenceDto,
  UpdateGeofenceDto,
  StartStudySessionDto,
  StudySessionHeartbeatDto,
} from '../dtos/study.dto';

describe('Study Controllers', () => {
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
        { provide: 'SUPABASE_CLIENT', useValue: {} },
        {
          provide: StudyService,
          useValue: mockStudyService,
        },
      ],
    }).compile();

    geofenceController = module.get<StudyGeofenceController>(StudyGeofenceController);
    sessionController = module.get<StudySessionController>(StudySessionController);
    studyService = module.get(StudyService);
  });

  describe('StudyGeofenceController', () => {
    it('should be defined', () => {
      expect(geofenceController).toBeDefined();
    });

    describe('list', () => {
      it('should return a list of geofences', async () => {
        const chapterId = 'chapter-1';
        const expectedResult = [{ id: 'geo-1', name: 'Test Geofence' }];
        studyService.listGeofences.mockResolvedValue(expectedResult as any);

        const result = await geofenceController.list(chapterId);

        expect(studyService.listGeofences).toHaveBeenCalledWith(chapterId);
        expect(result).toEqual(expectedResult);
      });
    });

    describe('create', () => {
      it('should create a geofence', async () => {
        const chapterId = 'chapter-1';
        const dto: CreateGeofenceDto = {
          name: 'New Geofence',
          coordinates: [{ lat: 1, lng: 2 }],
          is_active: true,
          minutes_per_point: 30,
          points_per_interval: 1,
          min_session_minutes: 15,
        };
        const expectedResult = { id: 'geo-new', ...dto };
        studyService.createGeofence.mockResolvedValue(expectedResult as any);

        const result = await geofenceController.create(chapterId, dto);

        expect(studyService.createGeofence).toHaveBeenCalledWith(chapterId, {
          name: dto.name,
          coordinates: dto.coordinates,
          is_active: dto.is_active,
          minutes_per_point: dto.minutes_per_point,
          points_per_interval: dto.points_per_interval,
          min_session_minutes: dto.min_session_minutes,
        });
        expect(result).toEqual(expectedResult);
      });
    });

    describe('update', () => {
      it('should update a geofence', async () => {
        const chapterId = 'chapter-1';
        const id = 'geo-1';
        const dto: UpdateGeofenceDto = { name: 'Updated Geofence' };
        const expectedResult = { id, chapter_id: chapterId, ...dto };
        studyService.updateGeofence.mockResolvedValue(expectedResult as any);

        const result = await geofenceController.update(chapterId, id, dto);

        expect(studyService.updateGeofence).toHaveBeenCalledWith(id, chapterId, dto);
        expect(result).toEqual(expectedResult);
      });
    });

    describe('delete', () => {
      it('should delete a geofence', async () => {
        const chapterId = 'chapter-1';
        const id = 'geo-1';
        studyService.deleteGeofence.mockResolvedValue(undefined);

        const result = await geofenceController.delete(chapterId, id);

        expect(studyService.deleteGeofence).toHaveBeenCalledWith(id, chapterId);
        expect(result).toEqual({ success: true });
      });
    });
  });

  describe('StudySessionController', () => {
    it('should be defined', () => {
      expect(sessionController).toBeDefined();
    });

    describe('start', () => {
      it('should start a study session', async () => {
        const userId = 'user-1';
        const chapterId = 'chapter-1';
        const dto: StartStudySessionDto = {
          geofence_id: 'geo-1',
          lat: 10,
          lng: 20,
        };
        const expectedResult = { id: 'session-1', user_id: userId, chapter_id: chapterId, geofence_id: dto.geofence_id };
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
      it('should send a heartbeat', async () => {
        const userId = 'user-1';
        const chapterId = 'chapter-1';
        const dto: StudySessionHeartbeatDto = {
          lat: 10,
          lng: 20,
        };
        const expectedResult = { id: 'session-1', status: 'ACTIVE' };
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
      it('should stop a study session', async () => {
        const userId = 'user-1';
        const chapterId = 'chapter-1';
        const expectedResult = { id: 'session-1', status: 'COMPLETED' };
        studyService.stopSession.mockResolvedValue(expectedResult as any);

        const result = await sessionController.stop(userId, chapterId);

        expect(studyService.stopSession).toHaveBeenCalledWith(userId, chapterId);
        expect(result).toEqual(expectedResult);
      });
    });

    describe('list', () => {
      it('should return a list of study sessions', async () => {
        const userId = 'user-1';
        const chapterId = 'chapter-1';
        const expectedResult = [{ id: 'session-1' }];
        studyService.listSessions.mockResolvedValue(expectedResult as any);

        const result = await sessionController.list(userId, chapterId);

        expect(studyService.listSessions).toHaveBeenCalledWith(userId, chapterId);
        expect(result).toEqual(expectedResult);
      });
    });
  });
});
