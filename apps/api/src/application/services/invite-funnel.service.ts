import { Inject, Injectable } from '@nestjs/common';
import {
  INVITE_JOINED_EVENT,
  inviteFunnelEventName,
  inviteFunnelProperties,
  type InviteFunnelStepInput,
} from '@repo/validation';
import {
  INVITE_REPOSITORY,
  type IInviteRepository,
} from '#domain/repositories/invite.repository.interface';
import { AnalyticsService, type TrackOptions } from './analytics.service';

/** Which app sent the step and its build, as the request carries them. */
type RequestLabel = Pick<TrackOptions, 'app' | 'appVersion'>;

/**
 * The invite card funnel (#5663): card viewed, a way in tapped, the email
 * code sent and verified, a join that failed, a new link asked for, and the
 * join itself. `@repo/validation`'s `invite-funnel.ts` says why these go
 * through the invite rather than `POST /v1/analytics/events`.
 *
 * Every step is best-effort and silent: an unknown token records nothing and
 * answers the same as a known one, and nothing here can fail the request
 * that carried it.
 */
@Injectable()
export class InviteFunnelService {
  constructor(
    @Inject(INVITE_REPOSITORY) private readonly inviteRepo: IInviteRepository,
    private readonly analytics: AnalyticsService,
  ) {}

  /**
   * A step the card reports. The token proves the chapter, so that
   * chapter's opt-out decides whether it is recorded; the properties are the
   * ones the step may carry (`inviteFunnelProperties`), whatever else came.
   */
  async recordStep(
    token: string,
    visitId: string,
    input: InviteFunnelStepInput,
    label: RequestLabel,
  ): Promise<void> {
    const invite = await this.inviteRepo.findByToken(token).catch(() => null);
    if (!invite) return;
    await this.analytics.trackInviteVisit(
      inviteFunnelEventName(input.step),
      invite.chapter_id,
      visitId,
      { properties: inviteFunnelProperties(input), ...label },
    );
  }

  /** The join, recorded by the redeem that made it, under the card's visit. */
  async recordJoined(
    chapterId: string,
    visitId: string,
    label: RequestLabel,
  ): Promise<void> {
    await this.analytics.trackInviteVisit(
      INVITE_JOINED_EVENT,
      chapterId,
      visitId,
      label,
    );
  }
}
