import { Inject, Injectable } from '@nestjs/common';
import { can, needsName } from '@repo/validation';
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
 * How long a new membership may still name itself before it counts as
 * settled, whether or not its welcome screen ever said it finished. The
 * welcome screen comes right after the join, so a day is far past it, and a
 * member who skips `PATCH /v1/members/me/onboarding` can't stay unlocked.
 */
export const WELCOME_NAME_WINDOW_MS = 24 * 60 * 60 * 1000;

/**
 * Whether a member may change their own name, and the record of each change
 * (#5801; `spec/behavior/members.md` § Profiles).
 *
 * The name is one `users.display_name` shared by every chapter the member is
 * in. A member of one chapter is locked when that chapter has
 * `members_can_change_name` off, they have settled in it (finished the
 * welcome screen, or joined over a day ago) and they don't hold
 * `roles:manage` there. A member of two or more chapters is never locked:
 * the officer correction refuses them, since one chapter's officer must not
 * rename someone in another, so the lock would leave a name nobody can fix.
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

  async isLocked(userId: string, now = new Date()): Promise<boolean> {
    const memberships = await this.memberRepo.findByUser(userId);
    if (memberships.length !== 1) return false;
    const [member] = memberships;
    if (!settled(member, now)) return false;
    const [chapter] = await this.chapterRepo.findByIds([member.chapter_id]);
    if (!chapter || chapter.members_can_change_name === true) return false;
    const permissions = await this.rbacService.getEffectivePermissions(
      chapter.id,
      userId,
    );
    return !can('roles:manage', permissions);
  }

  /**
   * Write `member_renamed` to the audit log of each of the member's chapters,
   * which `#chapter-audit` mirrors as "changed their name · Ethan Smith to
   * Paul". A first name replacing the sign-in stand-in (`needsName`: blank,
   * `Member`, or the email's local part) is the welcome screen naming a new
   * member, not a rename, and isn't written. Called before the name is
   * saved, so a failed write refuses the rename rather than leaving it
   * unrecorded.
   */
  async recordRename(
    user: { id: string; email?: string | null },
    from: string,
    to: string,
  ): Promise<void> {
    if (needsName(from, user.email ?? null)) return;
    const memberships = await this.memberRepo.findByUser(user.id);
    for (const member of memberships) {
      await this.auditLog.record({
        chapterId: member.chapter_id,
        actorUserId: user.id,
        action: 'member_renamed',
        targetType: 'member',
        targetId: member.id,
        diff: { display_name: { from, to } },
      });
    }
  }
}

function settled(member: Member, now: Date): boolean {
  if (member.has_completed_onboarding) return true;
  const joined = Date.parse(member.created_at);
  return (
    Number.isFinite(joined) && now.getTime() - joined > WELCOME_NAME_WINDOW_MS
  );
}
