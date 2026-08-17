import { Test, TestingModule } from '@nestjs/testing';
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { StudyService } from './study.service';
import { RbacService } from './rbac.service';
import { STUDY_GEOFENCE_REPOSITORY } from '../../domain/repositories/study.repository.interface';
import type { IStudyGeofenceRepository } from '../../domain/repositories/study.repository.interface';
import { STUDY_SESSION_REPOSITORY } from '../../domain/repositories/study.repository.interface';
import type { IStudySessionRepository } from '../../domain/repositories/study.repository.interface';
import { POINT_TRANSACTION_REPOSITORY } from '../../domain/repositories/point-transaction.repository.interface';
import type { IPointTransactionRepository } from '../../domain/repositories/point-transaction.repository.interface';
import type { StudyGeofence } from '../../domain/entities/study.entity';
import type { StudySession } from '../../domain/entities/study.entity';
import type { PointTransaction } from '../../domain/entities/point-transaction.entity';

// `pointInPolygon` moved to `domain/utils/geofence.ts` with #994, when event
// check-in became its second consumer. Its cases live in `geofence.spec.ts`.

describe('StudyService', () => {
  let service: StudyService;
  let mockGeofenceRepo: jest.Mocked<IStudyGeofenceRepository>;
  let mockSessionRepo: jest.Mocked<IStudySessionRepository>;
  let mockPointTxnRepo: jest.Mocked<IPointTransactionRepository>;
  let mockRbac: { isAlumni: jest.Mock };

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
    pause_grace_minutes: 5,
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
    paused_at: null,
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
      findByChapterFiltered: jest.fn(),
      countRecentAdjustments: jest.fn(),
    };

    // Default to an active (non-alumni) member so existing cases are unaffected.
    mockRbac = { isAlumni: jest.fn().mockResolvedValue(false) };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        StudyService,
        { provide: STUDY_GEOFENCE_REPOSITORY, useValue: mockGeofenceRepo },
        { provide: STUDY_SESSION_REPOSITORY, useValue: mockSessionRepo },
        { provide: POINT_TRANSACTION_REPOSITORY, useValue: mockPointTxnRepo },
        { provide: RbacService, useValue: mockRbac },
      ],
    }).compile();

    service = module.get(StudyService);
  });

  // Alumni accrue no study hours (spec/behavior/alumni.md). The study controller
  // only requires members:view — which the Alumni role holds — so the denial has
  // to happen in the service, on every session mutation.
  describe('Alumni lifecycle restrictions', () => {
    beforeEach(() => {
      mockRbac.isAlumni.mockResolvedValue(true);
    });

    it('denies startSession for an alumni member', async () => {
      await expect(
        service.startSession('user-1', 'ch-1', 'geo-1', 5, 5),
      ).rejects.toThrow(ForbiddenException);

      expect(mockRbac.isAlumni).toHaveBeenCalledWith('ch-1', 'user-1');
      // Denied before any session is created.
      expect(mockSessionRepo.create).not.toHaveBeenCalled();
    });

    it('denies heartbeat for an alumni member', async () => {
      await expect(service.heartbeat('user-1', 'ch-1', 5, 5)).rejects.toThrow(
        ForbiddenException,
      );

      expect(mockSessionRepo.update).not.toHaveBeenCalled();
    });

    // stopSession is deliberately NOT denied: nothing else moves a session out
    // of ACTIVE, so 403-ing the stop would strand a session forever for anyone
    // granted the Alumni role mid-session. They can close it, but earn nothing.
    it('lets an alumni member close an in-flight session without awarding points', async () => {
      const longSession: StudySession = {
        ...baseSession,
        total_foreground_minutes: 120,
        last_heartbeat_at: new Date().toISOString(),
      };
      mockSessionRepo.findActiveByUserAndChapter.mockResolvedValue(longSession);
      mockGeofenceRepo.findById.mockResolvedValue(baseGeofence);
      mockSessionRepo.update.mockResolvedValue({
        ...longSession,
        status: 'COMPLETED',
      });

      const result = await service.stopSession('user-1', 'ch-1');

      // Session is closed out...
      expect(mockSessionRepo.update).toHaveBeenCalledWith(
        longSession.id,
        expect.objectContaining({ status: 'COMPLETED', points_awarded: false }),
      );
      expect(result.status).toBe('COMPLETED');
      // ...but the STUDY award is withheld, despite clearing min_session_minutes.
      expect(mockPointTxnRepo.create).not.toHaveBeenCalled();
    });

    it('still awards points when an active member stops the same session', async () => {
      mockRbac.isAlumni.mockResolvedValue(false);
      const longSession: StudySession = {
        ...baseSession,
        total_foreground_minutes: 120,
        last_heartbeat_at: new Date().toISOString(),
      };
      mockSessionRepo.findActiveByUserAndChapter.mockResolvedValue(longSession);
      mockGeofenceRepo.findById.mockResolvedValue(baseGeofence);
      mockSessionRepo.update.mockResolvedValue(longSession);
      mockPointTxnRepo.create.mockResolvedValue(basePointTxn);

      await service.stopSession('user-1', 'ch-1');

      expect(mockPointTxnRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({ category: 'STUDY' }),
      );
    });

    it('still allows an active member to start a session', async () => {
      mockRbac.isAlumni.mockResolvedValue(false);
      mockGeofenceRepo.findById.mockResolvedValue(baseGeofence);
      mockSessionRepo.findActiveByUserAndChapter.mockResolvedValue(null);
      mockSessionRepo.create.mockResolvedValue(baseSession);

      await expect(
        service.startSession('user-1', 'ch-1', 'geo-1', 5, 5),
      ).resolves.toEqual(baseSession);

      expect(mockSessionRepo.create).toHaveBeenCalled();
    });
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

    // Expiry is lazy and there is no sweeper, so reading history is one of the
    // few moments a lapsed session surfaces to a member.
    it('settles a grace-expired session before returning history', async () => {
      const paused: StudySession = {
        ...baseSession,
        paused_at: '2026-02-26T10:12:00.000Z',
        last_heartbeat_at: '2026-02-26T10:12:00.000Z',
        total_foreground_minutes: 40,
      };
      jest.useFakeTimers().setSystemTime(new Date('2026-02-26T10:30:00.000Z'));

      mockSessionRepo.findActiveByUserAndChapter.mockResolvedValue(paused);
      mockGeofenceRepo.findById.mockResolvedValue(baseGeofence);
      mockSessionRepo.update.mockResolvedValue({
        ...paused,
        status: 'PAUSED_EXPIRED',
      });
      mockSessionRepo.findByUserAndChapter.mockResolvedValue([]);

      await service.listSessions('user-1', 'ch-1');

      expect(mockSessionRepo.update).toHaveBeenCalledWith(
        paused.id,
        expect.objectContaining({ status: 'PAUSED_EXPIRED' }),
      );

      jest.useRealTimers();
    });

    it('leaves a running session alone', async () => {
      mockSessionRepo.findActiveByUserAndChapter.mockResolvedValue(baseSession);
      mockSessionRepo.findByUserAndChapter.mockResolvedValue([baseSession]);

      await service.listSessions('user-1', 'ch-1');

      expect(mockSessionRepo.update).not.toHaveBeenCalled();
    });
  });

  // spec/behavior/study-sessions.md § Anti-Distraction: Foreground Requirement.
  // Pause is a sub-state of ACTIVE — only grace expiry is terminal.
  describe('pause / resume and the PAUSED_EXPIRED grace window', () => {
    // 10:05 watermark, 5 minutes already banked, grace 5 min, min 15 min.
    const runningAt1005 = baseSession;

    function pausedAt(
      isoPause: string,
      overrides: Partial<StudySession> = {},
    ): StudySession {
      return {
        ...baseSession,
        paused_at: isoPause,
        last_heartbeat_at: isoPause,
        ...overrides,
      };
    }

    afterEach(() => {
      jest.useRealTimers();
    });

    describe('pauseSession', () => {
      it('banks foreground minutes up to the pause and starts the grace clock', async () => {
        jest
          .useFakeTimers()
          .setSystemTime(new Date('2026-02-26T10:12:30.000Z'));
        mockSessionRepo.findActiveByUserAndChapter.mockResolvedValue(
          runningAt1005,
        );
        mockGeofenceRepo.findById.mockResolvedValue(baseGeofence);
        mockSessionRepo.update.mockResolvedValue(runningAt1005);

        await service.pauseSession('user-1', 'ch-1');

        expect(mockSessionRepo.update).toHaveBeenCalledWith('sess-1', {
          paused_at: '2026-02-26T10:12:30.000Z',
          // 7m30s elapsed since the 10:05 watermark -> 7 whole minutes banked
          // on top of the existing 5...
          total_foreground_minutes: 12,
          // ...and the watermark advances by exactly those 7 minutes, so the
          // leftover 30s carries forward instead of being truncated away.
          last_heartbeat_at: '2026-02-26T10:12:00.000Z',
        });
      });

      it('does not restart the grace clock on a duplicate pause', async () => {
        jest
          .useFakeTimers()
          .setSystemTime(new Date('2026-02-26T10:14:00.000Z'));
        const already = pausedAt('2026-02-26T10:12:00.000Z');
        mockSessionRepo.findActiveByUserAndChapter.mockResolvedValue(already);
        mockGeofenceRepo.findById.mockResolvedValue(baseGeofence);

        const result = await service.pauseSession('user-1', 'ch-1');

        expect(mockSessionRepo.update).not.toHaveBeenCalled();
        expect(result.paused_at).toBe('2026-02-26T10:12:00.000Z');
      });

      it('expires a session already past grace instead of re-pausing it', async () => {
        jest
          .useFakeTimers()
          .setSystemTime(new Date('2026-02-26T10:30:00.000Z'));
        const stale = pausedAt('2026-02-26T10:12:00.000Z');
        mockSessionRepo.findActiveByUserAndChapter.mockResolvedValue(stale);
        mockGeofenceRepo.findById.mockResolvedValue(baseGeofence);
        mockSessionRepo.update.mockResolvedValue({
          ...stale,
          status: 'PAUSED_EXPIRED',
        });

        const result = await service.pauseSession('user-1', 'ch-1');

        expect(result.status).toBe('PAUSED_EXPIRED');
      });

      it('throws NotFoundException when no active session', async () => {
        mockSessionRepo.findActiveByUserAndChapter.mockResolvedValue(null);

        await expect(service.pauseSession('user-1', 'ch-1')).rejects.toThrow(
          NotFoundException,
        );
      });

      // A pause proves nothing about the gap that preceded it. Crediting an
      // unheartbeaten hour would bank time the server never verified — and
      // stopSession skips its own stale check once paused_at is set, so
      // nothing downstream would catch it.
      it('expires instead of banking a gap older than the stale window', async () => {
        jest
          .useFakeTimers()
          .setSystemTime(new Date('2026-02-26T11:05:00.000Z'));
        // Watermark still at 10:05 — an hour with no heartbeat.
        mockSessionRepo.findActiveByUserAndChapter.mockResolvedValue(
          runningAt1005,
        );
        mockGeofenceRepo.findById.mockResolvedValue(baseGeofence);
        mockSessionRepo.update.mockResolvedValue({
          ...runningAt1005,
          status: 'EXPIRED',
        });

        const result = await service.pauseSession('user-1', 'ch-1');

        expect(result.status).toBe('EXPIRED');
        expect(mockSessionRepo.update).toHaveBeenCalledWith(
          'sess-1',
          expect.objectContaining({ status: 'EXPIRED' }),
        );
        // Critically, the 60-minute gap was never credited.
        expect(mockSessionRepo.update).not.toHaveBeenCalledWith(
          'sess-1',
          expect.objectContaining({ total_foreground_minutes: 65 }),
        );
        expect(mockPointTxnRepo.create).not.toHaveBeenCalled();
      });
    });

    describe('resumeSession', () => {
      it('resumes inside grace without resetting accumulated minutes', async () => {
        jest
          .useFakeTimers()
          .setSystemTime(new Date('2026-02-26T10:15:00.000Z'));
        const paused = pausedAt('2026-02-26T10:12:00.000Z', {
          total_foreground_minutes: 12,
        });
        mockSessionRepo.findActiveByUserAndChapter.mockResolvedValue(paused);
        mockGeofenceRepo.findById.mockResolvedValue(baseGeofence);
        mockSessionRepo.update.mockResolvedValue({
          ...paused,
          paused_at: null,
        });

        await service.resumeSession('user-1', 'ch-1', 5, 5);

        // Paused time never accrues: the watermark restarts at the resume
        // instant and the 12 banked minutes are left untouched.
        expect(mockSessionRepo.update).toHaveBeenCalledWith('sess-1', {
          paused_at: null,
          last_heartbeat_at: '2026-02-26T10:15:00.000Z',
        });
        expect(mockPointTxnRepo.create).not.toHaveBeenCalled();
      });

      it('expires past grace and awards points for pre-pause foreground time only', async () => {
        jest
          .useFakeTimers()
          .setSystemTime(new Date('2026-02-26T10:20:00.000Z'));
        // 60 banked minutes, paused at 10:12, returning 8 minutes later — 3
        // minutes past the 5-minute grace window.
        const paused = pausedAt('2026-02-26T10:12:00.000Z', {
          total_foreground_minutes: 60,
        });
        mockSessionRepo.findActiveByUserAndChapter.mockResolvedValue(paused);
        mockGeofenceRepo.findById.mockResolvedValue(baseGeofence);
        mockSessionRepo.update.mockResolvedValue({
          ...paused,
          status: 'PAUSED_EXPIRED',
        });
        mockPointTxnRepo.create.mockResolvedValue(basePointTxn);

        const result = await service.resumeSession('user-1', 'ch-1', 5, 5);

        expect(result.status).toBe('PAUSED_EXPIRED');
        expect(mockSessionRepo.update).toHaveBeenCalledWith(
          'sess-1',
          expect.objectContaining({
            status: 'PAUSED_EXPIRED',
            // The session ends at the pause, not at the late return.
            end_time: '2026-02-26T10:12:00.000Z',
            total_foreground_minutes: 60,
            points_awarded: true,
          }),
        );
        // 60 / 30 * 1 — the 8 paused minutes earn nothing.
        expect(mockPointTxnRepo.create).toHaveBeenCalledWith(
          expect.objectContaining({ amount: 2, category: 'STUDY' }),
        );
      });

      it('awards nothing when pre-pause minutes are below min_session_minutes', async () => {
        jest
          .useFakeTimers()
          .setSystemTime(new Date('2026-02-26T10:20:00.000Z'));
        const paused = pausedAt('2026-02-26T10:12:00.000Z', {
          total_foreground_minutes: 12, // below min_session_minutes: 15
        });
        mockSessionRepo.findActiveByUserAndChapter.mockResolvedValue(paused);
        mockGeofenceRepo.findById.mockResolvedValue(baseGeofence);
        mockSessionRepo.update.mockResolvedValue({
          ...paused,
          status: 'PAUSED_EXPIRED',
        });

        await service.resumeSession('user-1', 'ch-1', 5, 5);

        expect(mockPointTxnRepo.create).not.toHaveBeenCalled();
        expect(mockSessionRepo.update).toHaveBeenCalledWith(
          'sess-1',
          expect.objectContaining({
            status: 'PAUSED_EXPIRED',
            points_awarded: false,
          }),
        );
      });

      it('invalidates a resume from outside the geofence', async () => {
        jest
          .useFakeTimers()
          .setSystemTime(new Date('2026-02-26T10:15:00.000Z'));
        const paused = pausedAt('2026-02-26T10:12:00.000Z');
        mockSessionRepo.findActiveByUserAndChapter.mockResolvedValue(paused);
        mockGeofenceRepo.findById.mockResolvedValue(baseGeofence);
        mockSessionRepo.update.mockResolvedValue({
          ...paused,
          status: 'LOCATION_INVALID',
        });

        const result = await service.resumeSession('user-1', 'ch-1', 99, 99);

        expect(result.status).toBe('LOCATION_INVALID');
      });

      // Regression: resume used to reset the watermark to `now`, throwing away
      // the sub-minute remainder pauseSession had deliberately parked. Across
      // many tab switches that is the exact compounding loss accrue() exists
      // to prevent.
      it('carries the pre-pause sub-minute remainder across the resume', async () => {
        jest
          .useFakeTimers()
          .setSystemTime(new Date('2026-02-26T10:15:00.000Z'));
        // Watermark parked at 10:12:00, paused at 10:12:30 -> 30s still owed.
        // Resuming at 10:15 is 2m30s paused, comfortably inside the 5m grace.
        const paused: StudySession = {
          ...baseSession,
          last_heartbeat_at: '2026-02-26T10:12:00.000Z',
          paused_at: '2026-02-26T10:12:30.000Z',
          total_foreground_minutes: 12,
        };
        mockSessionRepo.findActiveByUserAndChapter.mockResolvedValue(paused);
        mockGeofenceRepo.findById.mockResolvedValue(baseGeofence);
        mockSessionRepo.update.mockResolvedValue({
          ...paused,
          paused_at: null,
        });

        await service.resumeSession('user-1', 'ch-1', 5, 5);

        expect(mockSessionRepo.update).toHaveBeenCalledWith('sess-1', {
          paused_at: null,
          // 10:15:00 minus the 30s owed — not 10:15:00 flat.
          last_heartbeat_at: '2026-02-26T10:14:30.000Z',
        });
      });

      it('is a no-op on a session that was never paused', async () => {
        mockSessionRepo.findActiveByUserAndChapter.mockResolvedValue(
          runningAt1005,
        );
        mockGeofenceRepo.findById.mockResolvedValue(baseGeofence);

        const result = await service.resumeSession('user-1', 'ch-1', 5, 5);

        expect(mockSessionRepo.update).not.toHaveBeenCalled();
        expect(result).toEqual(runningAt1005);
      });
    });

    describe('grace window governs a paused session', () => {
      // A chapter may configure grace above the 10-minute stale-heartbeat
      // threshold. The stale rule must not silently win and report EXPIRED
      // where the spec calls for PAUSED_EXPIRED.
      const patientGeofence: StudyGeofence = {
        ...baseGeofence,
        pause_grace_minutes: 30,
      };

      it('keeps a paused session alive past the stale-heartbeat window', async () => {
        jest
          .useFakeTimers()
          .setSystemTime(new Date('2026-02-26T10:32:00.000Z'));
        const paused = pausedAt('2026-02-26T10:12:00.000Z', {
          total_foreground_minutes: 12,
        });
        mockSessionRepo.findActiveByUserAndChapter.mockResolvedValue(paused);
        mockGeofenceRepo.findById.mockResolvedValue(patientGeofence);
        mockSessionRepo.update.mockResolvedValue({
          ...paused,
          paused_at: null,
        });

        // 20 paused minutes: past the 10-minute stale threshold, inside the
        // chapter's 30-minute grace.
        const result = await service.resumeSession('user-1', 'ch-1', 5, 5);

        expect(result.status).not.toBe('EXPIRED');
        expect(mockSessionRepo.update).toHaveBeenCalledWith(
          'sess-1',
          expect.objectContaining({ paused_at: null }),
        );
      });

      it('falls back to the 5-minute default when the geofence has none', async () => {
        jest
          .useFakeTimers()
          .setSystemTime(new Date('2026-02-26T10:20:00.000Z'));
        const legacyGeofence = {
          ...baseGeofence,
          pause_grace_minutes: null,
        } as unknown as StudyGeofence;
        const paused = pausedAt('2026-02-26T10:12:00.000Z');
        mockSessionRepo.findActiveByUserAndChapter.mockResolvedValue(paused);
        mockGeofenceRepo.findById.mockResolvedValue(legacyGeofence);
        mockSessionRepo.update.mockResolvedValue({
          ...paused,
          status: 'PAUSED_EXPIRED',
        });

        const result = await service.resumeSession('user-1', 'ch-1', 5, 5);

        expect(result.status).toBe('PAUSED_EXPIRED');
      });
    });

    describe('heartbeat on a paused session', () => {
      it('treats a heartbeat inside grace as an implicit resume', async () => {
        jest
          .useFakeTimers()
          .setSystemTime(new Date('2026-02-26T10:15:00.000Z'));
        const paused = pausedAt('2026-02-26T10:12:00.000Z', {
          total_foreground_minutes: 12,
        });
        mockSessionRepo.findActiveByUserAndChapter.mockResolvedValue(paused);
        mockGeofenceRepo.findById.mockResolvedValue(baseGeofence);
        mockSessionRepo.update.mockResolvedValue({
          ...paused,
          paused_at: null,
        });

        await service.heartbeat('user-1', 'ch-1', 5, 5);

        // The 3 paused minutes are not credited — a client that never called
        // /resume still cannot bank background time.
        expect(mockSessionRepo.update).toHaveBeenCalledWith('sess-1', {
          paused_at: null,
          last_heartbeat_at: '2026-02-26T10:15:00.000Z',
        });
      });

      // The implicit resume is the path taken by a client that never calls
      // /resume, so skipping the polygon check here would let a member resume
      // from anywhere and accrue from the next heartbeat onward.
      it('rejects an implicit resume from outside the geofence', async () => {
        jest
          .useFakeTimers()
          .setSystemTime(new Date('2026-02-26T10:15:00.000Z'));
        const paused = pausedAt('2026-02-26T10:12:00.000Z', {
          total_foreground_minutes: 12,
        });
        mockSessionRepo.findActiveByUserAndChapter.mockResolvedValue(paused);
        mockGeofenceRepo.findById.mockResolvedValue(baseGeofence);
        mockSessionRepo.update.mockResolvedValue({
          ...paused,
          status: 'LOCATION_INVALID',
        });

        const result = await service.heartbeat('user-1', 'ch-1', 99, 99);

        expect(result.status).toBe('LOCATION_INVALID');
        expect(mockSessionRepo.update).toHaveBeenCalledWith(
          'sess-1',
          expect.objectContaining({ status: 'LOCATION_INVALID' }),
        );
      });

      it('expires a heartbeat that arrives after grace', async () => {
        jest
          .useFakeTimers()
          .setSystemTime(new Date('2026-02-26T10:25:00.000Z'));
        const paused = pausedAt('2026-02-26T10:12:00.000Z', {
          total_foreground_minutes: 12,
        });
        mockSessionRepo.findActiveByUserAndChapter.mockResolvedValue(paused);
        mockGeofenceRepo.findById.mockResolvedValue(baseGeofence);
        mockSessionRepo.update.mockResolvedValue({
          ...paused,
          status: 'PAUSED_EXPIRED',
        });

        const result = await service.heartbeat('user-1', 'ch-1', 5, 5);

        expect(result.status).toBe('PAUSED_EXPIRED');
      });
    });

    describe('stopSession while paused', () => {
      it('credits time up to the pause, never up to the stop', async () => {
        jest
          .useFakeTimers()
          .setSystemTime(new Date('2026-02-26T10:16:00.000Z'));
        // Watermark 10:05 with 5 banked, paused at 10:12:30, stopped at 10:16.
        const paused: StudySession = {
          ...baseSession,
          paused_at: '2026-02-26T10:12:30.000Z',
        };
        mockSessionRepo.findActiveByUserAndChapter.mockResolvedValue(paused);
        mockGeofenceRepo.findById.mockResolvedValue(baseGeofence);
        mockSessionRepo.update.mockResolvedValue({
          ...paused,
          status: 'COMPLETED',
        });

        await service.stopSession('user-1', 'ch-1');

        expect(mockSessionRepo.update).toHaveBeenCalledWith(
          'sess-1',
          expect.objectContaining({
            status: 'COMPLETED',
            paused_at: null,
            // 5 banked + 7 whole minutes to the pause instant. The 3.5
            // paused minutes before the stop earn nothing.
            total_foreground_minutes: 12,
          }),
        );
      });

      it('reports PAUSED_EXPIRED rather than COMPLETED when grace already lapsed', async () => {
        jest
          .useFakeTimers()
          .setSystemTime(new Date('2026-02-26T10:40:00.000Z'));
        const paused = pausedAt('2026-02-26T10:12:00.000Z', {
          total_foreground_minutes: 30,
        });
        mockSessionRepo.findActiveByUserAndChapter.mockResolvedValue(paused);
        mockGeofenceRepo.findById.mockResolvedValue(baseGeofence);
        mockSessionRepo.update.mockResolvedValue({
          ...paused,
          status: 'PAUSED_EXPIRED',
        });
        mockPointTxnRepo.create.mockResolvedValue(basePointTxn);

        const result = await service.stopSession('user-1', 'ch-1');

        expect(result.status).toBe('PAUSED_EXPIRED');
      });
    });

    describe('startSession against a lapsed session', () => {
      it('frees the slot instead of 409-ing forever', async () => {
        jest
          .useFakeTimers()
          .setSystemTime(new Date('2026-02-26T11:00:00.000Z'));
        const abandoned = pausedAt('2026-02-26T10:12:00.000Z', {
          total_foreground_minutes: 12,
        });
        mockGeofenceRepo.findById.mockResolvedValue(baseGeofence);
        mockSessionRepo.findActiveByUserAndChapter.mockResolvedValue(abandoned);
        mockSessionRepo.update.mockResolvedValue({
          ...abandoned,
          status: 'PAUSED_EXPIRED',
        });
        mockSessionRepo.create.mockResolvedValue({
          ...baseSession,
          id: 'sess-2',
        });

        const result = await service.startSession(
          'user-1',
          'ch-1',
          'geo-1',
          5,
          5,
        );

        expect(mockSessionRepo.update).toHaveBeenCalledWith(
          'sess-1',
          expect.objectContaining({ status: 'PAUSED_EXPIRED' }),
        );
        expect(result.id).toBe('sess-2');
        expect(mockSessionRepo.create).toHaveBeenCalledWith(
          expect.objectContaining({ paused_at: null, status: 'ACTIVE' }),
        );
      });

      it('still 409s while the paused session is inside its grace window', async () => {
        jest
          .useFakeTimers()
          .setSystemTime(new Date('2026-02-26T10:14:00.000Z'));
        const paused = pausedAt('2026-02-26T10:12:00.000Z');
        mockGeofenceRepo.findById.mockResolvedValue(baseGeofence);
        mockSessionRepo.findActiveByUserAndChapter.mockResolvedValue(paused);

        await expect(
          service.startSession('user-1', 'ch-1', 'geo-1', 5, 5),
        ).rejects.toThrow(ConflictException);

        expect(mockSessionRepo.create).not.toHaveBeenCalled();
      });
    });

    // Mirrors stopSession: alumni may close out a session they were mid-way
    // through, but the STUDY award is withheld.
    it('withholds points when a grace-expired session belongs to an alumni member', async () => {
      jest.useFakeTimers().setSystemTime(new Date('2026-02-26T10:30:00.000Z'));
      mockRbac.isAlumni.mockResolvedValue(true);
      const paused = pausedAt('2026-02-26T10:12:00.000Z', {
        total_foreground_minutes: 120,
      });
      mockSessionRepo.findActiveByUserAndChapter.mockResolvedValue(paused);
      mockGeofenceRepo.findById.mockResolvedValue(baseGeofence);
      mockSessionRepo.update.mockResolvedValue({
        ...paused,
        status: 'PAUSED_EXPIRED',
      });

      const result = await service.pauseSession('user-1', 'ch-1');

      expect(result.status).toBe('PAUSED_EXPIRED');
      expect(mockPointTxnRepo.create).not.toHaveBeenCalled();
    });
  });

  describe('foreground minute accounting', () => {
    afterEach(() => {
      jest.useRealTimers();
    });

    // Regression: the accumulator used to floor the elapsed gap and then jump
    // the watermark to `now`, discarding the sub-minute remainder on every
    // heartbeat. Across a long session that silently lost real study time.
    it('carries the sub-minute remainder into the next interval', async () => {
      jest.useFakeTimers().setSystemTime(new Date('2026-02-26T10:12:30.000Z'));
      mockSessionRepo.findActiveByUserAndChapter.mockResolvedValue(baseSession);
      mockGeofenceRepo.findById.mockResolvedValue(baseGeofence);
      mockSessionRepo.update.mockResolvedValue(baseSession);

      await service.heartbeat('user-1', 'ch-1', 5, 5);

      expect(mockSessionRepo.update).toHaveBeenCalledWith('sess-1', {
        total_foreground_minutes: 12,
        // Not 10:12:30 — the leftover 30s stays owed to the member.
        last_heartbeat_at: '2026-02-26T10:12:00.000Z',
      });
    });

    it('credits nothing for a heartbeat under a minute after the last', async () => {
      jest.useFakeTimers().setSystemTime(new Date('2026-02-26T10:05:40.000Z'));
      mockSessionRepo.findActiveByUserAndChapter.mockResolvedValue(baseSession);
      mockGeofenceRepo.findById.mockResolvedValue(baseGeofence);
      mockSessionRepo.update.mockResolvedValue(baseSession);

      await service.heartbeat('user-1', 'ch-1', 5, 5);

      expect(mockSessionRepo.update).toHaveBeenCalledWith('sess-1', {
        total_foreground_minutes: 5,
        last_heartbeat_at: '2026-02-26T10:05:00.000Z',
      });
    });
  });
});
