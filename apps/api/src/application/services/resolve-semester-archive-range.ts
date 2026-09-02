import { NotFoundException } from '@nestjs/common';
import type { ISemesterArchiveRepository } from '../../domain/repositories/semester-archive.repository.interface';
import { resolveArchiveRange } from '../../domain/utils/points-window';

/**
 * Resolve one specific archived period by id, chapter-scoped so an id from
 * another chapter 404s exactly like an unknown one — never distinguishing
 * "wrong chapter" from "doesn't exist" for a caller probing ids. Shared by
 * `PointsService` (leaderboard/summary) and `ReportService` (points report)
 * so the lookup-then-range-or-404 sequence is defined once.
 */
export async function resolveSemesterArchiveRangeOrThrow(
  semesterArchiveRepo: ISemesterArchiveRepository,
  semesterArchiveId: string,
  chapterId: string,
): Promise<{ since: Date; until: Date }> {
  const archive = await semesterArchiveRepo.findById(
    semesterArchiveId,
    chapterId,
  );
  const range = archive ? resolveArchiveRange(archive) : null;
  if (!range) {
    throw new NotFoundException('Semester archive not found');
  }
  return range;
}
