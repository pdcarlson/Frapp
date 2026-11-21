import { Inject, Injectable } from '@nestjs/common';
import { can } from '@repo/validation';
import {
  MEMBER_REPOSITORY,
  type IMemberRepository,
} from '#domain/repositories/member.repository.interface';
import {
  CHAPTER_REPOSITORY,
  type IChapterRepository,
} from '#domain/repositories/chapter.repository.interface';
import type { Member } from '#domain/entities/member.entity';
import { RbacService } from './rbac.service';
import { ChapterAuditLogService } from './chapter-audit-log.service';

/**
 * Whether a member may change their own name, and the record of each change
 * (#5801; `spec/behavior/members.md` § Profiles).
 *
 * The name is one `users.display_name` shared by every chapter the member is
 * in, so a chapter's lock holds wherever they edit it: the name is locked
 * when any chapter they have finished joining has
 * `members_can_change_name` off and they don't hold `roles:manage` there.
 * A membership still on its welcome screen (`has_completed_onboarding`
 * false) never locks it, so a new member names themselves once.
 */
@Injectable()
export class DisplayNameLockService {
  constructor(
    @Inject(MEMBER_REPOSITORY) private readonly memberRepo: IMemberRepository,
    @Inject(CHAPTER_REPOSITORY)
    private readonly chapterRepo: IChapterRepository,
    private readonly rbacService: RbacService,
    private readonly auditLog: ChapterAuditLogService,
  ) {}

  async isLocked(userId: string): Promise<boolean> {
    const joined = await this.joinedMemberships(userId);
    if (joined.length === 0) return false;
    const chapters = await this.chapterRepo.findByIds(
      joined.map((m) => m.chapter_id),
    );
    for (const chapter of chapters) {
      if (chapter.members_can_change_name === true) continue;
      const permissions = await this.rbacService.getEffectivePermissions(
        chapter.id,
        userId,
      );
      if (!can('roles:manage', permissions)) return true;
    }
    return false;
  }

  /**
   * Write `member_renamed` to the audit log of each chapter the member has
   * finished joining, which `#chapter-audit` mirrors as "changed their name ·
   * Ethan Smith to Paul". The welcome screen's first name is not a rename and
   * isn't written for the chapter being joined.
   */
  async recordRename(userId: string, from: string, to: string): Promise<void> {
    const joined = await this.joinedMemberships(userId);
    for (const member of joined) {
      await this.auditLog.record({
        chapterId: member.chapter_id,
        actorUserId: userId,
        action: 'member_renamed',
        targetType: 'member',
        targetId: member.id,
        diff: { display_name: { from, to } },
      });
    }
  }

  private async joinedMemberships(userId: string): Promise<Member[]> {
    const memberships = await this.memberRepo.findByUser(userId);
    return memberships.filter((m) => m.has_completed_onboarding);
  }
}
