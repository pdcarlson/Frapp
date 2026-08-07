import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { RbacService } from './rbac.service';
import { STUDY_GEOFENCE_REPOSITORY } from '../../domain/repositories/study.repository.interface';
import type { IStudyGeofenceRepository } from '../../domain/repositories/study.repository.interface';
import { STUDY_SESSION_REPOSITORY } from '../../domain/repositories/study.repository.interface';
import type { IStudySessionRepository } from '../../domain/repositories/study.repository.interface';
import { POINT_TRANSACTION_REPOSITORY } from '../../domain/repositories/point-transaction.repository.interface';
import type { IPointTransactionRepository } from '../../domain/repositories/point-transaction.repository.interface';
import type {
  StudyGeofence,
  StudySession,
  GeofenceCoordinate,
} from '../../domain/entities/study.entity';

const HEARTBEAT_STALE_MINUTES = 10;
const MS_PER_MINUTE = 60 * 1000;

/**
 * Fallback grace window for rows written before `pause_grace_minutes` existed
 * and for any geofence that somehow carries a null. Matches the column default
 * and `spec/behavior/study-sessions.md`.
 */
const DEFAULT_PAUSE_GRACE_MINUTES = 5;

/**
 * Ray-casting point-in-polygon algorithm.
 * Coordinates are array of {lat, lng} forming a closed polygon.
 */
export function pointInPolygon(
  lat: number,
  lng: number,
  polygon: GeofenceCoordinate[],
): boolean {
  if (!polygon || polygon.length < 3) return false;

  let inside = false;
  const n = polygon.length;

  for (let i = 0, j = n - 1; i < n; j = i++) {
    const xi = polygon[i].lng;
    const yi = polygon[i].lat;
    const xj = polygon[j].lng;
    const yj = polygon[j].lat;

    const intersect =
      yi > lat !== yj > lat && lng < ((xj - xi) * (lat - yi)) / (yj - yi) + xi;

    if (intersect) inside = !inside;
  }

  return inside;
}

@Injectable()
export class StudyService {
  constructor(
    @Inject(STUDY_GEOFENCE_REPOSITORY)
    private readonly geofenceRepo: IStudyGeofenceRepository,
    @Inject(STUDY_SESSION_REPOSITORY)
    private readonly sessionRepo: IStudySessionRepository,
    @Inject(POINT_TRANSACTION_REPOSITORY)
    private readonly pointTxnRepo: IPointTransactionRepository,
    private readonly rbac: RbacService,
  ) {}

  /**
   * Alumni do not accrue study hours (`spec/behavior/alumni.md`). The study
   * controller only requires `members:view`, which the Alumni role holds, so
   * the lifecycle rule is enforced here at the service boundary — covering
   * every session mutation rather than a single route.
   */
  private async assertNotAlumni(
    chapterId: string,
    userId: string,
  ): Promise<void> {
    if (await this.rbac.isAlumni(chapterId, userId)) {
      throw new ForbiddenException(
        'Alumni members cannot record study hours in this chapter',
      );
    }
  }

  /**
   * Credit foreground time accumulated between the session's watermark and
   * `upTo`.
   *
   * The watermark advances by exactly the whole minutes credited, never to
   * `upTo` itself, so the sub-minute remainder carries into the next interval.
   * Flooring and then jumping the watermark forward — what this used to do —
   * silently discarded up to 59s on every heartbeat. That was tolerable at one
   * truncation per 5-minute heartbeat; with pause/resume able to fire on every
   * tab switch it would compound into real lost study time.
   */
  private accrue(
    session: StudySession,
    upTo: Date,
  ): { totalMinutes: number; watermark: string } {
    const from = new Date(session.last_heartbeat_at).getTime();
    const elapsedMinutes = (upTo.getTime() - from) / MS_PER_MINUTE;
    const credited = Math.max(0, Math.floor(elapsedMinutes));
    return {
      totalMinutes: session.total_foreground_minutes + credited,
      watermark: new Date(from + credited * MS_PER_MINUTE).toISOString(),
    };
  }

  private graceMinutes(geofence: StudyGeofence): number {
    return geofence.pause_grace_minutes ?? DEFAULT_PAUSE_GRACE_MINUTES;
  }

  /**
   * Watermark to restart from when a paused session resumes.
   *
   * `pauseSession` parks the watermark on the last whole credited minute, so
   * `paused_at - last_heartbeat_at` is up to 59s of real, already-earned
   * foreground time still owed to the member. Resuming at `now` would discard
   * it — the very truncation `accrue()` exists to prevent, on the path that
   * fires most often. Shifting the restart back by the owed remainder carries
   * it into the next interval instead.
   */
  private resumeWatermark(session: StudySession, now: Date): string {
    const owedMs =
      new Date(session.paused_at as string).getTime() -
      new Date(session.last_heartbeat_at).getTime();
    // Clamp: a clock skew or a hand-edited row must never hand out free time.
    const carry = Math.min(Math.max(owedMs, 0), MS_PER_MINUTE);
    return new Date(now.getTime() - carry).toISOString();
  }

  /**
   * True when the watermark is older than the stale-heartbeat window, i.e. the
   * server has no recent proof the member was actually in the zone. Crediting
   * that gap would bank unverified time.
   */
  private isStale(session: StudySession, now: Date): boolean {
    const gap =
      (now.getTime() - new Date(session.last_heartbeat_at).getTime()) /
      MS_PER_MINUTE;
    return gap > HEARTBEAT_STALE_MINUTES;
  }

  /**
   * Points for a finished session. Shared by COMPLETED and PAUSED_EXPIRED —
   * `spec/behavior/study-sessions.md` awards both on foreground minutes,
   * unlike EXPIRED / LOCATION_INVALID which award nothing.
   */
  private async awardPoints(
    session: StudySession,
    geofence: StudyGeofence,
    totalMinutes: number,
    isAlumni: boolean,
  ): Promise<number> {
    if (
      isAlumni ||
      session.points_awarded ||
      totalMinutes < geofence.min_session_minutes
    ) {
      return 0;
    }

    const points =
      Math.floor(totalMinutes / geofence.minutes_per_point) *
      geofence.points_per_interval;

    if (points > 0) {
      await this.pointTxnRepo.create({
        chapter_id: session.chapter_id,
        user_id: session.user_id,
        amount: points,
        category: 'STUDY',
        description: `Study session: ${geofence.name}`,
        metadata: {
          study_session_id: session.id,
          geofence_id: session.geofence_id,
          total_minutes: totalMinutes,
        },
      });
    }

    return points;
  }

  /**
   * Resolve a paused session whose grace window has elapsed.
   *
   * Expiry is lazy — there is no sweeper — so every entry point that touches a
   * session runs this first. Returns the expired session, or null when the
   * session is not paused or is still inside its grace window.
   */
  private async expireIfGraceElapsed(
    session: StudySession,
    geofence: StudyGeofence,
    now: Date,
    isAlumni: boolean,
  ): Promise<StudySession | null> {
    if (!session.paused_at) return null;

    const pausedAt = new Date(session.paused_at);
    const pausedMinutes = (now.getTime() - pausedAt.getTime()) / MS_PER_MINUTE;
    if (pausedMinutes <= this.graceMinutes(geofence)) return null;

    // Minutes were already credited up to `paused_at` when the pause landed;
    // paused time never accrues. Settle any sub-minute remainder and stop.
    const { totalMinutes, watermark } = this.accrue(session, pausedAt);
    const points = await this.awardPoints(
      session,
      geofence,
      totalMinutes,
      isAlumni,
    );

    return this.sessionRepo.update(session.id, {
      status: 'PAUSED_EXPIRED',
      end_time: pausedAt.toISOString(),
      last_heartbeat_at: watermark,
      total_foreground_minutes: totalMinutes,
      points_awarded: points > 0 || session.points_awarded,
    });
  }

  async listGeofences(chapterId: string): Promise<StudyGeofence[]> {
    return this.geofenceRepo.findByChapter(chapterId);
  }

  async createGeofence(
    chapterId: string,
    data: {
      name: string;
      coordinates: GeofenceCoordinate[];
      is_active?: boolean;
      minutes_per_point?: number;
      points_per_interval?: number;
      min_session_minutes?: number;
      pause_grace_minutes?: number;
    },
  ): Promise<StudyGeofence> {
    if (!data.coordinates || data.coordinates.length < 3) {
      throw new BadRequestException(
        'Coordinates must form a polygon with at least 3 points',
      );
    }
    return this.geofenceRepo.create({
      chapter_id: chapterId,
      name: data.name,
      coordinates: data.coordinates,
      is_active: data.is_active ?? true,
      minutes_per_point: data.minutes_per_point ?? 30,
      points_per_interval: data.points_per_interval ?? 1,
      min_session_minutes: data.min_session_minutes ?? 15,
      pause_grace_minutes:
        data.pause_grace_minutes ?? DEFAULT_PAUSE_GRACE_MINUTES,
    });
  }

  async updateGeofence(
    id: string,
    chapterId: string,
    data: Partial<{
      name: string;
      coordinates: GeofenceCoordinate[];
      is_active: boolean;
      minutes_per_point: number;
      points_per_interval: number;
      min_session_minutes: number;
      pause_grace_minutes: number;
    }>,
  ): Promise<StudyGeofence> {
    const existing = await this.geofenceRepo.findById(id, chapterId);
    if (!existing) {
      throw new NotFoundException('Geofence not found');
    }
    if (data.coordinates !== undefined && data.coordinates.length < 3) {
      throw new BadRequestException(
        'Coordinates must form a polygon with at least 3 points',
      );
    }
    return this.geofenceRepo.update(id, chapterId, data);
  }

  async deleteGeofence(id: string, chapterId: string): Promise<void> {
    const existing = await this.geofenceRepo.findById(id, chapterId);
    if (!existing) {
      throw new NotFoundException('Geofence not found');
    }
    await this.geofenceRepo.delete(id, chapterId);
  }

  async startSession(
    userId: string,
    chapterId: string,
    geofenceId: string,
    lat: number,
    lng: number,
  ): Promise<StudySession> {
    await this.assertNotAlumni(chapterId, userId);

    const geofence = await this.geofenceRepo.findById(geofenceId, chapterId);
    if (!geofence) {
      throw new NotFoundException('Geofence not found');
    }
    if (!geofence.is_active) {
      throw new BadRequestException('Geofence is not active');
    }

    const inside = pointInPolygon(lat, lng, geofence.coordinates);
    if (!inside) {
      throw new BadRequestException('Location is outside the geofence');
    }

    const activeSession = await this.sessionRepo.findActiveByUserAndChapter(
      userId,
      chapterId,
    );
    if (activeSession) {
      // A session paused past its grace window is finished in every sense
      // except the row's status — expiry is lazy, so nothing has settled it
      // yet. Resolving it here frees the slot instead of 409-ing the member
      // out of ever starting another session.
      const priorGeofence = await this.geofenceRepo.findById(
        activeSession.geofence_id,
        chapterId,
      );
      const expired = priorGeofence
        ? await this.expireIfGraceElapsed(
            activeSession,
            priorGeofence,
            new Date(),
            false,
          )
        : null;

      if (!expired) {
        throw new ConflictException(
          'You already have an active study session. Stop it before starting a new one.',
        );
      }
    }

    const now = new Date().toISOString();
    return this.sessionRepo.create({
      chapter_id: chapterId,
      user_id: userId,
      geofence_id: geofenceId,
      status: 'ACTIVE',
      start_time: now,
      end_time: null,
      last_heartbeat_at: now,
      paused_at: null,
      total_foreground_minutes: 0,
      points_awarded: false,
    });
  }

  async heartbeat(
    userId: string,
    chapterId: string,
    lat: number,
    lng: number,
  ): Promise<StudySession> {
    await this.assertNotAlumni(chapterId, userId);

    const session = await this.sessionRepo.findActiveByUserAndChapter(
      userId,
      chapterId,
    );
    if (!session) {
      throw new NotFoundException('No active study session found');
    }

    const geofence = await this.geofenceRepo.findById(
      session.geofence_id,
      chapterId,
    );
    if (!geofence) {
      throw new NotFoundException('Geofence not found');
    }

    const now = new Date();

    // A heartbeat only fires in the foreground, so one arriving on a paused
    // session means the member is back — treat it as an implicit resume rather
    // than requiring the client to have called /resume. Grace is checked
    // first, so a late return still expires.
    const expired = await this.expireIfGraceElapsed(
      session,
      geofence,
      now,
      false,
    );
    if (expired) return expired;

    // Location is checked before the implicit resume below, not after: the
    // member may have left the zone while backgrounded, and this heartbeat is
    // the only evidence available until the next one five minutes out.
    const inside = pointInPolygon(lat, lng, geofence.coordinates);

    if (session.paused_at) {
      if (!inside) {
        return this.sessionRepo.update(session.id, {
          status: 'LOCATION_INVALID',
          end_time: now.toISOString(),
        });
      }
      // Inside grace and back in the zone. Paused time does not accrue, so
      // restart the watermark — carrying the pre-pause remainder with it.
      return this.sessionRepo.update(session.id, {
        paused_at: null,
        last_heartbeat_at: this.resumeWatermark(session, now),
      });
    }

    if (this.isStale(session, now)) {
      return this.sessionRepo.update(session.id, {
        status: 'EXPIRED',
        end_time: now.toISOString(),
      });
    }

    if (!inside) {
      return this.sessionRepo.update(session.id, {
        status: 'LOCATION_INVALID',
        end_time: now.toISOString(),
      });
    }

    const { totalMinutes, watermark } = this.accrue(session, now);

    return this.sessionRepo.update(session.id, {
      last_heartbeat_at: watermark,
      total_foreground_minutes: totalMinutes,
    });
  }

  /**
   * Backgrounding signal. Credits foreground time up to this instant and starts
   * the grace clock; the session stays ACTIVE until the window elapses.
   *
   * Not gated by `assertNotAlumni`, for the same reason `stopSession` isn't:
   * refusing the pause would leave the session running and accruing for someone
   * granted the Alumni role mid-session. The award gate in `awardPoints` is what
   * withholds their points.
   */
  async pauseSession(userId: string, chapterId: string): Promise<StudySession> {
    const isAlumni = await this.rbac.isAlumni(chapterId, userId);

    const session = await this.sessionRepo.findActiveByUserAndChapter(
      userId,
      chapterId,
    );
    if (!session) {
      throw new NotFoundException('No active study session found');
    }

    const geofence = await this.geofenceRepo.findById(
      session.geofence_id,
      chapterId,
    );
    if (!geofence) {
      throw new NotFoundException('Geofence not found');
    }

    const now = new Date();

    const expired = await this.expireIfGraceElapsed(
      session,
      geofence,
      now,
      isAlumni,
    );
    if (expired) return expired;

    // Already paused and still inside grace — a duplicate pause (two tab-hide
    // events, a retry) must not restart the grace clock.
    if (session.paused_at) return session;

    // A pause arriving long after the last heartbeat proves nothing about the
    // gap before it: the member may have been away the whole time, and every
    // other write path bounds crediting by the stale window. Without this,
    // POSTing /pause after an hour of silence would bank the hour as
    // foreground time and `stopSession` would skip its own stale check
    // (paused_at governs there), so nothing downstream would catch it.
    if (this.isStale(session, now)) {
      return this.sessionRepo.update(session.id, {
        status: 'EXPIRED',
        end_time: now.toISOString(),
      });
    }

    const { totalMinutes, watermark } = this.accrue(session, now);

    return this.sessionRepo.update(session.id, {
      paused_at: now.toISOString(),
      last_heartbeat_at: watermark,
      total_foreground_minutes: totalMinutes,
    });
  }

  /**
   * Return-to-foreground signal. Resumes inside the grace window without
   * resetting accumulated foreground minutes; past it, the session has already
   * expired as PAUSED_EXPIRED and that is what comes back.
   *
   * Location is re-checked on resume — the member may have left the zone while
   * away, and the next heartbeat is up to five minutes out.
   */
  async resumeSession(
    userId: string,
    chapterId: string,
    lat: number,
    lng: number,
  ): Promise<StudySession> {
    const isAlumni = await this.rbac.isAlumni(chapterId, userId);

    const session = await this.sessionRepo.findActiveByUserAndChapter(
      userId,
      chapterId,
    );
    if (!session) {
      throw new NotFoundException('No active study session found');
    }

    const geofence = await this.geofenceRepo.findById(
      session.geofence_id,
      chapterId,
    );
    if (!geofence) {
      throw new NotFoundException('Geofence not found');
    }

    const now = new Date();

    const expired = await this.expireIfGraceElapsed(
      session,
      geofence,
      now,
      isAlumni,
    );
    if (expired) return expired;

    if (!session.paused_at) return session;

    if (!pointInPolygon(lat, lng, geofence.coordinates)) {
      return this.sessionRepo.update(session.id, {
        status: 'LOCATION_INVALID',
        end_time: now.toISOString(),
      });
    }

    return this.sessionRepo.update(session.id, {
      paused_at: null,
      last_heartbeat_at: this.resumeWatermark(session, now),
    });
  }

  async stopSession(userId: string, chapterId: string): Promise<StudySession> {
    // Deliberately NOT gated by assertNotAlumni. Nothing else transitions a
    // session out of ACTIVE — expiry is computed lazily inside heartbeat/stop,
    // there is no sweeper — so 403-ing the stop would strand a session forever
    // for anyone granted the Alumni role mid-session (graduation, semester
    // rollover), and leave them unable to ever start another one. Alumni can
    // always close a session; the award below is what's withheld.
    const isAlumni = await this.rbac.isAlumni(chapterId, userId);

    const session = await this.sessionRepo.findActiveByUserAndChapter(
      userId,
      chapterId,
    );
    if (!session) {
      throw new NotFoundException('No active study session found');
    }

    const geofence = await this.geofenceRepo.findById(
      session.geofence_id,
      chapterId,
    );
    if (!geofence) {
      throw new NotFoundException('Geofence not found');
    }

    const now = new Date();

    const expired = await this.expireIfGraceElapsed(
      session,
      geofence,
      now,
      isAlumni,
    );
    if (expired) return expired;

    // Stopping while paused but inside grace: credit up to the pause instant,
    // never to now. The stale-heartbeat rule is deliberately skipped on a
    // paused session — `paused_at` governs there, otherwise a chapter that
    // configures grace above the 10-minute stale window would have the stale
    // rule silently win and report the wrong status.
    const creditUpTo = session.paused_at ? new Date(session.paused_at) : now;

    if (!session.paused_at && this.isStale(session, now)) {
      return this.sessionRepo.update(session.id, {
        status: 'EXPIRED',
        end_time: now.toISOString(),
      });
    }

    const { totalMinutes, watermark } = this.accrue(session, creditUpTo);
    const points = await this.awardPoints(
      session,
      geofence,
      totalMinutes,
      isAlumni,
    );

    return this.sessionRepo.update(session.id, {
      status: 'COMPLETED',
      end_time: now.toISOString(),
      last_heartbeat_at: watermark,
      paused_at: null,
      total_foreground_minutes: totalMinutes,
      points_awarded: points > 0 || session.points_awarded,
    });
  }

  async listSessions(
    userId: string,
    chapterId: string,
  ): Promise<StudySession[]> {
    // Settle a grace-expired session before reading history, so the list never
    // shows a session as ACTIVE when its window has already lapsed. Expiry is
    // lazy and there is no sweeper, so this read is one of the few places a
    // stale row surfaces to a member.
    const active = await this.sessionRepo.findActiveByUserAndChapter(
      userId,
      chapterId,
    );
    if (active?.paused_at) {
      const geofence = await this.geofenceRepo.findById(
        active.geofence_id,
        chapterId,
      );
      if (geofence) {
        await this.expireIfGraceElapsed(
          active,
          geofence,
          new Date(),
          await this.rbac.isAlumni(chapterId, userId),
        );
      }
    }

    return this.sessionRepo.findByUserAndChapter(userId, chapterId);
  }
}
