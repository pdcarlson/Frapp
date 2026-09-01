import { randomUUID } from 'node:crypto';
import {
  BadRequestException,
  ConflictException,
  GoneException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { INVITE_REPOSITORY } from '../../domain/repositories/invite.repository.interface';
import type { IInviteRepository } from '../../domain/repositories/invite.repository.interface';
import { MEMBER_REPOSITORY } from '../../domain/repositories/member.repository.interface';
import type { IMemberRepository } from '../../domain/repositories/member.repository.interface';
import { ROLE_REPOSITORY } from '../../domain/repositories/role.repository.interface';
import type { IRoleRepository } from '../../domain/repositories/role.repository.interface';
import { Invite } from '../../domain/entities/invite.entity';
import { SystemRoleKeys } from '../../domain/constants/permissions';
import { NotificationService } from './notification.service';
import { ActivationService } from './activation.service';
import { EMAIL_PROVIDER } from '../../domain/adapters/email.interface';
import type { IEmailProvider } from '../../domain/adapters/email.interface';
import {
  resolveAppOrigin,
  buildJoinUrl,
} from '../../infrastructure/email/invite-link.util';
import { dedupeEmails } from '@repo/validation';

export interface BulkEmailInviteResult {
  invites: Invite[];
  /** Addresses whose invite token was created but the email failed to send. */
  failed: string[];
}

/**
 * Resend's default rate limit is low (2 requests/second on the standard
 * tier), and a bulk invite can carry up to 50 addresses (`BulkEmailInviteDto`).
 * Firing all of them as one `Promise.all` would send up to 50 concurrent
 * requests and turn a healthy provider into a wall of spurious 429s reported
 * back as address failures. A small worker pool keeps genuine delivery
 * failures distinguishable from self-inflicted rate-limiting.
 */
const EMAIL_SEND_CONCURRENCY = 2;

async function mapWithConcurrency<T, R>(
  items: T[],
  limit: number,
  fn: (item: T) => Promise<R>,
): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let cursor = 0;
  async function worker(): Promise<void> {
    while (cursor < items.length) {
      const index = cursor++;
      results[index] = await fn(items[index]);
    }
  }
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, worker),
  );
  return results;
}

@Injectable()
export class InviteService {
  constructor(
    @Inject(INVITE_REPOSITORY) private readonly inviteRepo: IInviteRepository,
    @Inject(MEMBER_REPOSITORY) private readonly memberRepo: IMemberRepository,
    @Inject(ROLE_REPOSITORY) private readonly roleRepo: IRoleRepository,
    private readonly notificationService: NotificationService,
    private readonly activation: ActivationService,
    @Inject(EMAIL_PROVIDER) private readonly emailProvider: IEmailProvider,
    private readonly config: ConfigService,
  ) {}

  private prepareInviteData(
    chapterId: string,
    createdBy: string,
    role: string,
  ): Partial<Invite> {
    const expiresAt = new Date();
    expiresAt.setHours(expiresAt.getHours() + 24);

    return {
      token: randomUUID(),
      chapter_id: chapterId,
      role,
      expires_at: expiresAt.toISOString(),
      created_by: createdBy,
    };
  }

  async create(
    chapterId: string,
    createdBy: string,
    role: string,
  ): Promise<Invite> {
    // Free tier: inviting members is not billing-gated (Chunk 03). The chat +
    // members wedge is available to every chapter regardless of subscription.
    const data = this.prepareInviteData(chapterId, createdBy, role);
    const invite = await this.inviteRepo.create(data);
    // Funnel step 2 (#267). Recorded after the write so an invite that failed
    // to persist never counts as one the chapter created.
    await this.activation.record(chapterId, 'activation-first-invite-created', {
      batch_size: 1,
    });
    return invite;
  }

  async createBatch(
    chapterId: string,
    createdBy: string,
    role: string,
    count: number,
  ): Promise<Invite[]> {
    const inviteData: Partial<Invite>[] = Array.from({ length: count }, () =>
      this.prepareInviteData(chapterId, createdBy, role),
    );

    const invites = await this.inviteRepo.createMany(inviteData);
    await this.activation.record(chapterId, 'activation-first-invite-created', {
      batch_size: invites.length,
    });
    return invites;
  }

  /**
   * Create one invite token per email address and send each an emailed join
   * link. Free-tier, same as `create`/`createBatch` — no billing check here;
   * the not-billing-gated guarantee lives in the controller's decorators.
   *
   * Email delivery is best-effort per address: a send failure never rolls
   * back the invite token (the token is still valid and can be shared
   * manually), it is only reported back in `failed` so the caller can retry
   * or fall back to the share link for those addresses.
   */
  async createWithEmails(
    chapterId: string,
    createdBy: string,
    role: string,
    emails: string[],
  ): Promise<BulkEmailInviteResult> {
    const uniqueEmails = dedupeEmails(emails);

    const inviteData = uniqueEmails.map(() =>
      this.prepareInviteData(chapterId, createdBy, role),
    );
    const invites = await this.inviteRepo.createMany(inviteData);

    // Correlate by token rather than by array position: each token was
    // generated here, before the insert, so it is a stable key regardless of
    // what order the repository happens to return rows in — `createMany`'s
    // interface makes no ordering guarantee, and a positional zip would
    // silently mis-attribute which address gets which join link if that ever
    // changed.
    const emailByToken = new Map(
      inviteData.map((data, i) => [data.token as string, uniqueEmails[i]]),
    );

    const origin = resolveAppOrigin(this.config);
    const deliveries = await mapWithConcurrency(
      invites,
      EMAIL_SEND_CONCURRENCY,
      async (invite) => {
        const to = emailByToken.get(invite.token)!;
        // `sendInviteEmail` is documented to never throw, but that guarantee
        // is convention rather than something the type system enforces —
        // the `.catch` keeps one misbehaving provider implementation from
        // rejecting the whole batch and losing every already-created token.
        const sent = await this.emailProvider
          .sendInviteEmail({
            to,
            joinUrl: buildJoinUrl(invite.token, origin),
            role,
          })
          .catch(() => false);
        return { to, sent };
      },
    );
    const failed = deliveries.filter((d) => !d.sent).map((d) => d.to);

    await this.activation.record(chapterId, 'activation-first-invite-created', {
      batch_size: invites.length,
    });

    return { invites, failed };
  }

  async redeem(
    token: string,
    userId: string,
  ): Promise<{ chapterId: string; memberId: string }> {
    const invite = await this.inviteRepo.findByToken(token);

    if (!invite) throw new GoneException('Invite not found');
    if (invite.used_at) throw new GoneException('Invite already used');
    if (new Date(invite.expires_at) < new Date())
      throw new GoneException('Invite expired');

    const existingMember = await this.memberRepo.findByUserAndChapter(
      userId,
      invite.chapter_id,
    );
    if (existingMember)
      throw new ConflictException('Already a member of this chapter');

    const claimed = await this.inviteRepo.markUsedAtomically(invite.id);
    if (!claimed) throw new GoneException('Invite already used');

    const roles = await this.roleRepo.findByChapter(invite.chapter_id);
    // `invite.role` is the display name chosen when the invite was issued, so
    // it is matched by name by design. The fallback is the seeded Member role,
    // which resolves by `system_key` — a chapter that relabelled it would
    // otherwise leave redeemers with no role at all.
    let targetRole = roles.find((r) => r.name === invite.role);
    if (!targetRole) {
      targetRole = roles.find((r) => r.system_key === SystemRoleKeys.MEMBER);
    }

    const member = await this.memberRepo.create({
      user_id: userId,
      chapter_id: invite.chapter_id,
      role_ids: targetRole ? [targetRole.id] : [],
    });

    // Funnel step 3 (#267) — the chapter's first *successful* redemption, which
    // is the point where it stops being one founder and starts being a chapter.
    // Placed after `markUsedAtomically` and the member insert so an expired,
    // already-claimed, or duplicate-membership attempt never counts.
    await this.activation.record(
      invite.chapter_id,
      'activation-first-invite-redeemed',
    );

    try {
      await this.notificationService.notifyChapter(invite.chapter_id, {
        title: 'New Member Joined',
        body: 'A new member has joined the chapter',
        priority: 'NORMAL',
        category: 'admin',
        data: { target: { screen: 'members' } },
      });
    } catch {}

    return { chapterId: invite.chapter_id, memberId: member.id };
  }

  async findByChapter(chapterId: string): Promise<Invite[]> {
    return this.inviteRepo.findByChapter(chapterId);
  }

  async revoke(id: string, chapterId: string): Promise<void> {
    const invite = await this.inviteRepo.findById(id);

    if (!invite || invite.chapter_id !== chapterId) {
      throw new NotFoundException('Invite not found');
    }

    if (invite.used_at) {
      throw new BadRequestException('Invite has already been used');
    }

    await this.inviteRepo.markUsed(id);
  }
}
