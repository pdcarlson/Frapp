import {
  Inject,
  Injectable,
  ConflictException,
} from '@nestjs/common';
import { SEMESTER_ARCHIVE_REPOSITORY } from '../../domain/repositories/semester-archive.repository.interface';
import type { ISemesterArchiveRepository } from '../../domain/repositories/semester-archive.repository.interface';
import type { SemesterArchive } from '../../domain/entities/semester-archive.entity';

export interface RolloverInput {
  chapterId: string;
  label: string;
  startDate: string;
  endDate: string;
}

@Injectable()
export class SemesterRolloverService {
  constructor(
    @Inject(SEMESTER_ARCHIVE_REPOSITORY)
    private readonly archiveRepo: ISemesterArchiveRepository,
  ) {}

  async rollover(input: RolloverInput): Promise<SemesterArchive> {
    const latest = await this.archiveRepo.findLatestByChapter(input.chapterId);

    const now = new Date();
    const currentMonth = now.getUTCFullYear() * 12 + now.getUTCMonth();

    if (latest) {
      const latestCreated = new Date(latest.created_at);
      const latestMonth =
        latestCreated.getUTCFullYear() * 12 + latestCreated.getUTCMonth();

      if (latestMonth === currentMonth) {
        throw new ConflictException(
          'A rollover has already been performed this calendar month',
        );
      }
    }

    return this.archiveRepo.create({
      chapter_id: input.chapterId,
      label: input.label,
      start_date: input.startDate,
      end_date: input.endDate,
    });
  }

  async listSemesters(chapterId: string): Promise<SemesterArchive[]> {
    return this.archiveRepo.findByChapter(chapterId);
  }
}
