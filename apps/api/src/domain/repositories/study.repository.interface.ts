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
  findById(id: string): Promise<StudySession | null>;
  findActiveByUserAndChapter(
    userId: string,
    chapterId: string,
  ): Promise<StudySession | null>;
  findByUserAndChapter(
    userId: string,
    chapterId: string,
  ): Promise<StudySession[]>;
  create(data: Partial<StudySession>): Promise<StudySession>;
  update(id: string, data: Partial<StudySession>): Promise<StudySession>;
}
