import { Inject, Injectable } from '@nestjs/common';
import {
  canSeeChapterPhoneReach,
  phoneReachOf,
  type PhoneReach,
  type PhoneReachDevice,
} from '@repo/validation';
import {
  MEMBER_REPOSITORY,
  type IMemberRepository,
} from '#domain/repositories/member.repository.interface';
import {
  PUSH_TOKEN_REPOSITORY,
  type IPushTokenRepository,
} from '#domain/repositories/notification.repository.interface';
import { RbacService } from './rbac.service';

export interface PhoneReachResult {
  /**
   * `chapter` when the viewer may see every member's reach
   * (`PHONE_REACH_AUDIENCE`), `self` when they are served only their own.
   */
  scope: 'chapter' | 'self';
  members: PhoneReach[];
}

/**
 * Whether Frapp's notifications can reach each member's phone (the
 * Directory's "Phone app" filter). Officers who can invite members or manage
 * roles see the chapter; anyone else sees only themselves, so a member's
 * device state never reaches another member's screen. Only the platform,
 * on/off and the last-opened date leave the server, never a token or the
 * device label.
 */
@Injectable()
export class MemberPhoneReachService {
  constructor(
    @Inject(MEMBER_REPOSITORY) private readonly memberRepo: IMemberRepository,
    @Inject(PUSH_TOKEN_REPOSITORY)
    private readonly pushTokenRepo: IPushTokenRepository,
    private readonly rbacService: RbacService,
  ) {}

  async findForViewer(
    chapterId: string,
    viewerUserId: string,
  ): Promise<PhoneReachResult> {
    const permissions = await this.rbacService.getEffectivePermissions(
      chapterId,
      viewerUserId,
    );
    if (!canSeeChapterPhoneReach(permissions)) {
      return {
        scope: 'self',
        members: await this.reachOf([viewerUserId]),
      };
    }
    const members = await this.memberRepo.findByChapter(chapterId);
    const userIds = [...new Set(members.map((m) => m.user_id))];
    return { scope: 'chapter', members: await this.reachOf(userIds) };
  }

  private async reachOf(userIds: string[]): Promise<PhoneReach[]> {
    const tokens = await this.pushTokenRepo.findByUserIds(userIds);
    const byUser = new Map<string, PhoneReachDevice[]>();
    for (const token of tokens) {
      const list = byUser.get(token.user_id) ?? [];
      list.push(token);
      byUser.set(token.user_id, list);
    }
    return userIds.map((id) => phoneReachOf(id, byUser.get(id) ?? []));
  }
}
