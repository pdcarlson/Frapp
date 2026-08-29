import { Inject, Injectable, ConflictException } from '@nestjs/common';
import { SEMESTER_ARCHIVE_REPOSITORY } from '../../domain/repositories/semester-archive.repository.interface';
import type { ISemesterArchiveRepository } from '../../domain/repositories/semester-archive.repository.interface';
import { ROLE_REPOSITORY } from '../../domain/repositories/role.repository.interface';
import type { IRoleRepository } from '../../domain/repositories/role.repository.interface';
import { SystemRoleKeys } from '../../domain/constants/permissions';
import type { SemesterArchive } from '../../domain/entities/semester-archive.entity';

export interface RolloverInput {
  chapterId: string;
  label: string;
  startDate: string;
  endDate: string;
  /**
   * Bulk-promote the chapter's New Members to Member as part of this rollover
   * (spec/behavior/semester-rollover.md step 3). Optional and off by default —
   * a rollover that does not ask for it behaves exactly as it did before.
   */
  promoteNewMembers?: boolean;
}

@Injectable()
export class SemesterRolloverService {
  constructor(
    @Inject(SEMESTER_ARCHIVE_REPOSITORY)
    private readonly archiveRepo: ISemesterArchiveRepository,
    @Inject(ROLE_REPOSITORY)
    private readonly roleRepo: IRoleRepository,
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

    if (!input.promoteNewMembers) {
      return this.archiveRepo.create({
        chapter_id: input.chapterId,
        label: input.label,
        start_date: input.startDate,
        end_date: input.endDate,
      });
    }

    // Resolve both roles by `system_key`, never by `name`. A chapter is free to
    // relabel its system roles (RbacService blocks deleting them, not renaming),
    // and 20260806220000_role_system_key.sql exists because name-keyed lookups
    // silently stopped matching after a rename.
    const [newMemberRole, memberRole] = await Promise.all([
      this.roleRepo.findByChapterAndSystemKey(
        input.chapterId,
        SystemRoleKeys.NEW_MEMBER,
      ),
      this.roleRepo.findByChapterAndSystemKey(
        input.chapterId,
        SystemRoleKeys.MEMBER,
      ),
    ]);

    // Refuse rather than archive-without-promoting. An officer who ticked the box
    // must not be told "Semester archived" while nobody was promoted. The
    // system_key backfill deliberately left already-renamed roles null, so this is
    // reachable on real chapters. Nothing has been written yet at this point, and
    // the rollover is retryable with the box unticked.
    if (!newMemberRole || !memberRole) {
      throw new ConflictException(
        "This chapter has no system 'New Member' or 'Member' role to promote between. " +
          'Roll over without promotion, or restore the roles first.',
      );
    }

    return this.archiveRepo.createWithPromotion({
      chapterId: input.chapterId,
      label: input.label,
      startDate: input.startDate,
      endDate: input.endDate,
      newMemberRoleId: newMemberRole.id,
      memberRoleId: memberRole.id,
    });
  }

  async listSemesters(chapterId: string): Promise<SemesterArchive[]> {
    return this.archiveRepo.findByChapter(chapterId);
  }
}
