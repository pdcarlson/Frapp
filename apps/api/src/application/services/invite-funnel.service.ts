import { Inject, Injectable } from '@nestjs/common';
import {
  inviteFunnelEventName,
  inviteFunnelProperties,
  type InviteFunnelStepInput,
} from '@repo/validation';
import {
  INVITE_REPOSITORY,
  type IInviteRepository,
} from '#domain/repositories/invite.repository.interface';
import type { Invite } from '#domain/entities/invite.entity';
import { AnalyticsService, type TrackOptions } from './analytics.service';
import { DEAD_INVITE_DETAILS_DAYS } from './invite.service';

/** Which app sent the step and its build, as the request carries them. */
type RequestLabel = Pick<TrackOptions, 'app' | 'appVersion'>;

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Whether a card can still be showing this invite: the link works, or it
 * died but is still inside the window in which `POST /v1/invites/details`
 * answers for it (`DEAD_INVITE_DETAILS_DAYS` after it was made). Past that
 * the card 404s, so a step for it can only be made up.
 */
function cardCanShow(invite: Invite, now: Date): boolean {
  const works =
    !invite.revoked_at &&
    !(invite.used_at && !invite.reusable) &&
    new Date(invite.expires_at) > now;
  return (
    works ||
    now.getTime() - new Date(invite.created_at).getTime() <=
      DEAD_INVITE_DETAILS_DAYS * DAY_MS
  );
}

/**
 * The invite card funnel (#5663): card viewed, a way in tapped, the email
 * code sent and verified, the join or a join that failed, and a new link
 * asked for. `@repo/validation`'s `invite-funnel.ts` says why these go
 * through the invite rather than `POST /v1/analytics/events`.
 *
 * Every step is best-effort and silent: an unknown token, or one no card can
 * be showing any more, records nothing and answers the same as a known one,
 * and nothing here can fail the request that carried it.
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
    now = new Date(),
  ): Promise<void> {
    const invite = await this.inviteRepo.findByToken(token).catch(() => null);
    if (!invite || !cardCanShow(invite, now)) return;
    await this.analytics.trackInviteVisit(
      inviteFunnelEventName(input.step),
      invite.chapter_id,
      visitId,
      { properties: inviteFunnelProperties(input), ...label },
    );
  }
}
