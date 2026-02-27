import { Test, TestingModule } from '@nestjs/testing';
import {
  BadRequestException,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
import { StudyService, pointInPolygon } from './study.service';
import { STUDY_GEOFENCE_REPOSITORY } from '../../domain/repositories/study.repository.interface';
import type { IStudyGeofenceRepository } from '../../domain/repositories/study.repository.interface';
import { STUDY_SESSION_REPOSITORY } from '../../domain/repositories/study.repository.interface';
import type { IStudySessionRepository } from '../../domain/repositories/study.repository.interface';
import { POINT_TRANSACTION_REPOSITORY } from '../../domain/repositories/point-transaction.repository.interface';
import type { IPointTransactionRepository } from '../../domain/repositories/point-transaction.repository.interface';
import type { StudyGeofence } from '../../domain/entities/study.entity';
import type { StudySession } from '../../domain/entities/study.entity';
import type { PointTransaction } from '../../domain/entities/point-transaction.entity';

describe('pointInPolygon', () => {
  const square: { lat: number; lng: number }[] = [
    { lat: 0, lng: 0 },
    { lat: 0, lng: 10 },
    { lat: 10, lng: 10 },
    { lat: 10, lng: 0 },
  ];

  it('returns true for point inside polygon', () => {
    expect(pointInPolygon(5, 5, square)).toBe(true);
  });

  it('returns false for point outside polygon', () => {
    expect(pointInPolygon(15, 15, square)).toBe(false);
  });

  it('returns false for empty or insufficient polygon', () => {
    expect(pointInPolygon(5, 5, [])).toBe(false);
    expect(pointInPolygon(5, 5, [{ lat: 0, lng: 0 }])).toBe(false);
    expect(
      pointInPolygon(5, 5, [
        { lat: 0, lng: 0 },
        { lat: 1, lng: 1 },
      ]),
    ).toBe(false);
  });

  it('handles complex polygon', () => {
    const triangle = [
      { lat: 0, lng: 0 },
      { lat: 10, lng: 0 },
      { lat: 5, lng: 10 },
    ];
    expect(pointInPolygon(5, 3, triangle)).toBe(true);
    expect(pointInPolygon(0, 0, triangle)).toBe(false);
  });
});

describe('StudyService', () => {
  let service: StudyService;
  let mockGeofenceRepo: jest.Mocked<IStudyGeofenceRepository>;
  let mockSessionRepo: jest.Mocked<IStudySessionRepository>;
  let mockPointTxnRepo: jest.Mocked<IPointTransactionRepository>;

  const baseGeofence: StudyGeofence = {
    id: 'geo-1',
    chapter_id: 'ch-1',
    name: 'Library',
    coordinates: [
      { lat: 0, lng: 0 },
      { lat: 0, lng: 10 },
      { lat: 10, lng: 10 },
      { lat: 10, lng: 0 },
    ],
    is_active: true,
    minutes_per_point: 30,
    points_per_interval: 1,
    min_session_minutes: 15,
    created_at: '2026-02-26T00:00:00.000Z',
  };

  const baseSession: StudySession = {
    id: 'sess-1',
    chapter_id: 'ch-1',
    user_id: 'user-1',
    geofence_id: 'geo-1',
    status: 'ACTIVE',
    start_time: '2026-02-26T10:00:00.000Z',
    end_time: null,
    last_heartbeat_at: '2026-02-26T10:05:00.000Z',
    total_foreground_minutes: 5,
    points_awarded: false,
    created_at: '2026-02-26T10:00:00.000Z',
  };

  const basePointTxn: PointTransaction = {
    id: 'pt-1',
    chapter_id: 'ch-1',
    user_id: 'user-1',
    amount: 2,
    category: 'STUDY',
    description: 'Study session: Library',
    metadata: {},
    created_at: '2026-02-26T10:30:00.000Z',
  };

  beforeEach(async () => {
    mockGeofenceRepo = {
      findById: jest.fn(),
      findByChapter: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
      delete: jest.fn(),
    };

    mockSessionRepo = {
      findById: jest.fn(),
      findActiveByUserAndChapter: jest.fn(),
      findByUserAndChapter: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
    };

    mockPointTxnRepo = {
      create: jest.fn(),
      findByUser: jest.fn(),
      findByChapter: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        StudyService,
        { provide: STUDY_GEOFENCE_REPOSITORY, useValue: mockGeofenceRepo },
        { provide: STUDY_SESSION_REPOSITORY, useValue: mockSessionRepo },
        { provide: POINT_TRANSACTION_REPOSITORY, useValue: mockPointTxnRepo },
      ],
    }).compile();

    service = module.get(StudyService);
  });

  describe('listGeofences', () => {
    it('returns geofences for chapter', async () => {
      mockGeofenceRepo.findByChapter.mockResolvedValue([baseGeofence]);

      const result = await service.listGeofences('ch-1');

      expect(mockGeofenceRepo.findByChapter).toHaveBeenCalledWith('ch-1');
      expect(result).toEqual([baseGeofence]);
    });
  });

  describe('createGeofence', () => {
    it('creates geofence with valid coordinates', async () => {
      mockGeofenceRepo.create.mockResolvedValue(baseGeofence);

      const result = await service.createGeofence('ch-1', {
        name: 'Library',
        coordinates: baseGeofence.coordinates,
      });

      expect(mockGeofenceRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({
          chapter_id: 'ch-1',
          name: 'Library',
          coordinates: baseGeofence.coordinates,
          is_active: true,
          minutes_per_point: 30,
          points_per_interval: 1,
          min_session_minutes: 15,
        }),
      );
      expect(result).toEqual(baseGeofence);
    });

    it('throws BadRequestException when coordinates have fewer than 3 points', async () => {
      await expect(
        service.createGeofence('ch-1', {
          name: 'Bad',
          coordinates: [
            { lat: 0, lng: 0 },
            { lat: 1, lng: 1 },
          ],
        }),
      ).rejects.toThrow(BadRequestException);
      expect(mockGeofenceRepo.create).not.toHaveBeenCalled();
    });
  });

  describe('updateGeofence', () => {
    it('updates geofence when found', async () => {
      const updated = { ...baseGeofence, name: 'Updated Library' };
      mockGeofenceRepo.findById.mockResolvedValue(baseGeofence);
      mockGeofenceRepo.update.mockResolvedValue(updated);

      const result = await service.updateGeofence('geo-1', 'ch-1', {
        name: 'Updated Library',
      });

      expect(mockGeofenceRepo.update).toHaveBeenCalledWith('geo-1', 'ch-1', {
        name: 'Updated Library',
      });
      expect(result).toEqual(updated);
    });

    it('throws NotFoundException when geofence does not exist', async () => {
      mockGeofenceRepo.findById.mockResolvedValue(null);

      await expect(
        service.updateGeofence('geo-1', 'ch-1', { name: 'X' }),
      ).rejects.toThrow(NotFoundException);
    });

    it('throws BadRequestException when coordinates have fewer than 3 points', async () => {
      mockGeofenceRepo.findById.mockResolvedValue(baseGeofence);

      await expect(
        service.updateGeofence('geo-1', 'ch-1', {
          coordinates: [{ lat: 0, lng: 0 }],
        }),
      ).rejects.toThrow(BadRequestException);
    });
  });

  describe('deleteGeofence', () => {
    it('deletes geofence when found', async () => {
      mockGeofenceRepo.findById.mockResolvedValue(baseGeofence);

      await service.deleteGeofence('geo-1', 'ch-1');

      expect(mockGeofenceRepo.delete).toHaveBeenCalledWith('geo-1', 'ch-1');
    });

    it('throws NotFoundException when geofence does not exist', async () => {
      mockGeofenceRepo.findById.mockResolvedValue(null);

      await expect(service.deleteGeofence('geo-1', 'ch-1')).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  describe('startSession', () => {
    it('creates session when inside geofence and no active session', async () => {
      mockGeofenceRepo.findById.mockResolvedValue(baseGeofence);
      mockSessionRepo.findActiveByUserAndChapter.mockResolvedValue(null);
      mockSessionRepo.create.mockResolvedValue(baseSession);

      const result = await service.startSession(
        'user-1',
        'ch-1',
        'geo-1',
        5,
        5,
      );

      expect(mockSessionRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({
          chapter_id: 'ch-1',
          user_id: 'user-1',
          geofence_id: 'geo-1',
          status: 'ACTIVE',
          points_awarded: false,
        }),
      );
      expect(result).toEqual(baseSession);
    });

    it('throws NotFoundException when geofence not found', async () => {
      mockGeofenceRepo.findById.mockResolvedValue(null);

      await expect(
        service.startSession('user-1', 'ch-1', 'geo-1', 5, 5),
      ).rejects.toThrow(NotFoundException);
    });

    it('throws BadRequestException when geofence is inactive', async () => {
      mockGeofenceRepo.findById.mockResolvedValue({
        ...baseGeofence,
        is_active: false,
      });

      await expect(
        service.startSession('user-1', 'ch-1', 'geo-1', 5, 5),
      ).rejects.toThrow(BadRequestException);
    });

    it('throws BadRequestException when location is outside geofence', async () => {
      mockGeofenceRepo.findById.mockResolvedValue(baseGeofence);

      await expect(
        service.startSession('user-1', 'ch-1', 'geo-1', 15, 15),
      ).rejects.toThrow(BadRequestException);
      expect(mockSessionRepo.create).not.toHaveBeenCalled();
    });

    it('throws ConflictException when user already has active session', async () => {
      mockGeofenceRepo.findById.mockResolvedValue(baseGeofence);
      mockSessionRepo.findActiveByUserAndChapter.mockResolvedValue(baseSession);

      await expect(
        service.startSession('user-1', 'ch-1', 'geo-1', 5, 5),
      ).rejects.toThrow(ConflictException);
      expect(mockSessionRepo.create).not.toHaveBeenCalled();
    });
  });

  describe('heartbeat', () => {
    it('updates last_heartbeat and total_foreground_minutes when valid', async () => {
      const updated = {
        ...baseSession,
        last_heartbeat_at: '2026-02-26T10:10:00.000Z',
        total_foreground_minutes: 10,
      };
      mockSessionRepo.findActiveByUserAndChapter.mockResolvedValue(baseSession);
      mockGeofenceRepo.findById.mockResolvedValue(baseGeofence);
      mockSessionRepo.update.mockResolvedValue(updated);

      jest.useFakeTimers();
      jest.setSystemTime(new Date('2026-02-26T10:10:00.000Z'));

      const result = await service.heartbeat('user-1', 'ch-1', 5, 5);

      expect(mockSessionRepo.update).toHaveBeenCalledWith(
        'sess-1',
        expect.objectContaining({
          last_heartbeat_at: '2026-02-26T10:10:00.000Z',
          total_foreground_minutes: 10,
        }),
      );
      expect(result).toEqual(updated);

      jest.useRealTimers();
    });

    it('expires session when heartbeat is stale (>10 min)', async () => {
      mockSessionRepo.findActiveByUserAndChapter.mockResolvedValue(baseSession);
      mockGeofenceRepo.findById.mockResolvedValue(baseGeofence);
      const expired = { ...baseSession, status: 'EXPIRED' as const };
      mockSessionRepo.update.mockResolvedValue(expired);

      jest.useFakeTimers();
      jest.setSystemTime(new Date('2026-02-26T10:20:00.000Z')); // 15 min since last heartbeat

      const result = await service.heartbeat('user-1', 'ch-1', 5, 5);

      expect(mockSessionRepo.update).toHaveBeenCalledWith(
        'sess-1',
        expect.objectContaining({
          status: 'EXPIRED',
          end_time: '2026-02-26T10:20:00.000Z',
        }),
      );
      expect(result.status).toBe('EXPIRED');

      jest.useRealTimers();
    });

    it('expires session when location is outside geofence', async () => {
      mockSessionRepo.findActiveByUserAndChapter.mockResolvedValue(baseSession);
      mockGeofenceRepo.findById.mockResolvedValue(baseGeofence);
      const invalid = { ...baseSession, status: 'LOCATION_INVALID' as const };
      mockSessionRepo.update.mockResolvedValue(invalid);

      jest.useFakeTimers();
      jest.setSystemTime(new Date('2026-02-26T10:07:00.000Z'));

      const result = await service.heartbeat('user-1', 'ch-1', 15, 15);

      expect(mockSessionRepo.update).toHaveBeenCalledWith(
        'sess-1',
        expect.objectContaining({
          status: 'LOCATION_INVALID',
        }),
      );
      expect(result.status).toBe('LOCATION_INVALID');

      jest.useRealTimers();
    });

    it('throws NotFoundException when no active session', async () => {
      mockSessionRepo.findActiveByUserAndChapter.mockResolvedValue(null);

      await expect(service.heartbeat('user-1', 'ch-1', 5, 5)).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  describe('stopSession', () => {
    it('calculates and awards points when session meets minimum length', async () => {
      const sessionWithMinutes = {
        ...baseSession,
        total_foreground_minutes: 35,
        last_heartbeat_at: '2026-02-26T10:35:00.000Z',
      };
      mockSessionRepo.findActiveByUserAndChapter.mockResolvedValue(
        sessionWithMinutes,
      );
      mockGeofenceRepo.findById.mockResolvedValue(baseGeofence);
      mockPointTxnRepo.create.mockResolvedValue(basePointTxn);

      const completed = {
        ...sessionWithMinutes,
        status: 'COMPLETED' as const,
        end_time: '2026-02-26T10:40:00.000Z',
        total_foreground_minutes: 40,
        points_awarded: true,
      };
      mockSessionRepo.update.mockResolvedValue(completed);

      jest.useFakeTimers();
      jest.setSystemTime(new Date('2026-02-26T10:40:00.000Z'));

      const result = await service.stopSession('user-1', 'ch-1');

      // 40 min / 30 min_per_point = 1, * 1 = 1 point
      expect(mockPointTxnRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({
          chapter_id: 'ch-1',
          user_id: 'user-1',
          amount: 1,
          category: 'STUDY',
          description: 'Study session: Library',
        }),
      );
      expect(result.status).toBe('COMPLETED');
      expect(result.points_awarded).toBe(true);

      jest.useRealTimers();
    });

    it('awards zero points when session is shorter than min_session_minutes', async () => {
      const shortSession = {
        ...baseSession,
        total_foreground_minutes: 5,
        last_heartbeat_at: '2026-02-26T10:05:00.000Z',
      };
      mockSessionRepo.findActiveByUserAndChapter.mockResolvedValue(
        shortSession,
      );
      mockGeofenceRepo.findById.mockResolvedValue(baseGeofence);

      const completed = {
        ...shortSession,
        status: 'COMPLETED' as const,
        end_time: '2026-02-26T10:06:00.000Z',
        total_foreground_minutes: 6,
        points_awarded: false,
      };
      mockSessionRepo.update.mockResolvedValue(completed);

      jest.useFakeTimers();
      jest.setSystemTime(new Date('2026-02-26T10:06:00.000Z'));

      const result = await service.stopSession('user-1', 'ch-1');

      expect(mockPointTxnRepo.create).not.toHaveBeenCalled();
      expect(result.points_awarded).toBe(false);

      jest.useRealTimers();
    });

    it('does not double-award when points_awarded is already true', async () => {
      const alreadyAwarded = {
        ...baseSession,
        total_foreground_minutes: 60,
        points_awarded: true,
      };
      mockSessionRepo.findActiveByUserAndChapter.mockResolvedValue(
        alreadyAwarded,
      );
      mockGeofenceRepo.findById.mockResolvedValue(baseGeofence);

      const completed = {
        ...alreadyAwarded,
        status: 'COMPLETED' as const,
        end_time: '2026-02-26T11:00:00.000Z',
      };
      mockSessionRepo.update.mockResolvedValue(completed);

      await service.stopSession('user-1', 'ch-1');

      expect(mockPointTxnRepo.create).not.toHaveBeenCalled();
    });

    it('calculates points correctly: floor(total/minutes_per_point)*points_per_interval', async () => {
      const geofence = {
        ...baseGeofence,
        minutes_per_point: 30,
        points_per_interval: 2,
      };
      const session = {
        ...baseSession,
        total_foreground_minutes: 89,
        last_heartbeat_at: '2026-02-26T11:29:00.000Z',
      };
      mockSessionRepo.findActiveByUserAndChapter.mockResolvedValue(session);
      mockGeofenceRepo.findById.mockResolvedValue(geofence);
      mockPointTxnRepo.create.mockResolvedValue(basePointTxn);

      const completed = {
        ...session,
        status: 'COMPLETED' as const,
        end_time: '2026-02-26T11:30:00.000Z',
        total_foreground_minutes: 90,
        points_awarded: true,
      };
      mockSessionRepo.update.mockResolvedValue(completed);

      jest.useFakeTimers();
      jest.setSystemTime(new Date('2026-02-26T11:30:00.000Z'));

      await service.stopSession('user-1', 'ch-1');

      // floor(90/30) * 2 = 3 * 2 = 6
      expect(mockPointTxnRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({
          amount: 6,
        }),
      );

      jest.useRealTimers();
    });

    it('throws NotFoundException when no active session', async () => {
      mockSessionRepo.findActiveByUserAndChapter.mockResolvedValue(null);

      await expect(service.stopSession('user-1', 'ch-1')).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  describe('listSessions', () => {
    it('returns user sessions for chapter', async () => {
      mockSessionRepo.findByUserAndChapter.mockResolvedValue([baseSession]);

      const result = await service.listSessions('user-1', 'ch-1');

      expect(mockSessionRepo.findByUserAndChapter).toHaveBeenCalledWith(
        'user-1',
        'ch-1',
      );
      expect(result).toEqual([baseSession]);
    });
  });
});
