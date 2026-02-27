import type { SemesterArchive } from '../entities/semester-archive.entity';

export const SEMESTER_ARCHIVE_REPOSITORY = 'SEMESTER_ARCHIVE_REPOSITORY';

export interface ISemesterArchiveRepository {
  findByChapter(chapterId: string): Promise<SemesterArchive[]>;
  findLatestByChapter(chapterId: string): Promise<SemesterArchive | null>;
  create(data: Partial<SemesterArchive>): Promise<SemesterArchive>;
}
