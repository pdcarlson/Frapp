import type { StudyGeofence } from '../entities/study.entity';
import type { StudySession } from '../entities/study.entity';

export const STUDY_GEOFENCE_REPOSITORY = 'STUDY_GEOFENCE_REPOSITORY';

export interface IStudyGeofenceRepository {
  findById(id: string, chapterId: string): Promise<StudyGeofence | null>;
  findByChapter(chapterId: string): Promise<StudyGeofence[]>;
  create(data: Partial<StudyGeofence>): Promise<StudyGeofence>;
  update(
    id: string,
    chapterId: string,
    data: Partial<StudyGeofence>,
  ): Promise<StudyGeofence>;
  delete(id: string, chapterId: string): Promise<void>;
}

export const STUDY_SESSION_REPOSITORY = 'STUDY_SESSION_REPOSITORY';

export interface IStudySessionRepository {
  findActiveByUserAndChapter(
    userId: string,
    chapterId: string,
  ): Promise<StudySession | null>;
  findByUserAndChapter(
    userId: string,
    chapterId: string,
  ): Promise<StudySession[]>;
  create(data: Partial<StudySession>): Promise<StudySession>;
  /**
   * Update the session only while it is still the row the caller read: ACTIVE,
   * with the same `last_heartbeat_at` and `paused_at` (compare-and-set).
   * Returns the updated row, or `null` when another request changed or ended
   * the session first; the caller recomputes from a fresh read.
   */
  updateIfUnchanged(
    session: Pick<StudySession, 'id' | 'last_heartbeat_at' | 'paused_at'>,
    chapterId: string,
    data: Partial<StudySession>,
  ): Promise<StudySession | null>;
  /**
   * Finish the session as COMPLETED or PAUSED_EXPIRED and, when `points` is
   * above zero, write its STUDY ledger row, in one transaction behind the same
   * compare-and-set as {@link updateIfUnchanged} (`finish_study_session`).
   * Returns the finished row, or `null` when the compare-and-set lost; nothing
   * is awarded then.
   */
  finish(
    session: Pick<StudySession, 'id' | 'last_heartbeat_at' | 'paused_at'>,
    chapterId: string,
    finish: StudySessionFinish,
  ): Promise<StudySession | null>;
}

export interface StudySessionFinish {
  status: 'COMPLETED' | 'PAUSED_EXPIRED';
  end_time: string;
  last_heartbeat_at: string;
  total_foreground_minutes: number;
  points: number;
  description: string;
}
