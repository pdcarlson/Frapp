import { StudyGeofence, StudySession } from '../entities/study.entity';

export const STUDY_REPOSITORY = 'STUDY_REPOSITORY';

export interface IStudyRepository {
  // Geofences
  findGeofencesByChapter(chapterId: string): Promise<StudyGeofence[]>;
  findGeofenceById(id: string): Promise<StudyGeofence | null>;
  createGeofence(
    geofence: Omit<StudyGeofence, 'id' | 'createdAt'>,
  ): Promise<StudyGeofence>;

  // Sessions
  createSession(
    session: Omit<StudySession, 'id' | 'createdAt'>,
  ): Promise<StudySession>;
  updateSession(
    id: string,
    updates: Partial<StudySession>,
  ): Promise<StudySession>;
  findActiveSession(userId: string): Promise<StudySession | null>;
  findSessionById(id: string): Promise<StudySession | null>;
}
