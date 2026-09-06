import { randomUUID } from 'node:crypto';
import {
  BadRequestException,
  ConflictException,
  GoneException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { INVITE_REPOSITORY } from '#domain/repositories/invite.repository.interface';
import type { IInviteRepository } from '#domain/repositories/invite.repository.interface';
import { MEMBER_REPOSITORY } from '#domain/repositories/member.repository.interface';
import type { IMemberRepository } from '#domain/repositories/member.repository.interface';
import { ROLE_REPOSITORY } from '#domain/repositories/role.repository.interface';
import type { IRoleRepository } from '#domain/repositories/role.repository.interface';
import { CHAPTER_REPOSITORY } from '#domain/repositories/chapter.repository.interface';
import type { IChapterRepository } from '#domain/repositories/chapter.repository.interface';
import { USER_REPOSITORY } from '#domain/repositories/user.repository.interface';
import type { IUserRepository } from '#domain/repositories/user.repository.interface';
import { Invite } from '#domain/entities/invite.entity';
import { SystemRoleKeys } from '#domain/constants/permissions';
import { NotificationService } from './notification.service';
import { ActivationService } from './activation.service';
import { ChatService } from './chat.service';
import { EMAIL_PROVIDER } from '#domain/adapters/email.interface';
import type { IEmailProvider } from '#domain/adapters/email.interface';
import { SUPABASE_CLIENT } from '../../infrastructure/supabase/supabase.provider';
import type {
  FrappSupabaseClient,
  TablesInsert,
} from '../../infrastructure/supabase/database.types';
import {
  resolveAppOrigin,
  buildJoinUrl,
} from '../../infrastructure/email/invite-link.util';
import { dedupeEmails } from '@repo/validation';
import { SYSTEM_SENDER_ID } from '#domain/constants/chat';

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
  private readonly logger = new Logger(InviteService.name);

  constructor(
    @Inject(INVITE_REPOSITORY) private readonly inviteRepo: IInviteRepository,
    @Inject(MEMBER_REPOSITORY) private readonly memberRepo: IMemberRepository,
    @Inject(ROLE_REPOSITORY) private readonly roleRepo: IRoleRepository,
    @Inject(CHAPTER_REPOSITORY)
    private readonly chapterRepo: IChapterRepository,
    @Inject(USER_REPOSITORY) private readonly userRepo: IUserRepository,
    private readonly notificationService: NotificationService,
    private readonly activation: ActivationService,
    private readonly chatService: ChatService,
    @Inject(EMAIL_PROVIDER) private readonly emailProvider: IEmailProvider,
    private readonly config: ConfigService,
    @Inject(SUPABASE_CLIENT) private readonly supabase: FrappSupabaseClient,
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

  /**
   * #422: resolve the role name an invite is issued with.
   *
   * Order: the caller's explicit role → the chapter's configured
   * `default_invite_role_id` → the seeded Member system role. Naming a role
   * always wins, so this changes nothing for callers that already pass one.
   *
   * Blank and whitespace-only are treated as "not named" rather than passed
   * through. `@IsString()` accepts `""`, and an empty role name matches no
   * row at redeem time, so letting it through would silently demote the
   * invite to the Member fallback — the exact failure this default exists to
   * remove, arrived at by a different route.
   *
   * The stored value stays the role NAME, not the id: `invites.role` is
   * matched by name at redeem (`unique (chapter_id, name)` on `roles`), and
   * this issue is about choosing the default, not re-keying that contract.
   */
  private async resolveInviteRole(
    chapterId: string,
    requested?: string,
  ): Promise<string> {
    const explicit = requested?.trim();
    if (explicit) return explicit;

    // Independent reads, so they overlap rather than stack: this path only
    // runs when the caller named no role, and it would otherwise add two
    // serial round-trips to an invite that previously issued none.
    const [roles, chapter] = await Promise.all([
      this.roleRepo.findByChapter(chapterId),
      this.chapterRepo.findById(chapterId),
    ]);

    const defaultRoleId = chapter?.default_invite_role_id ?? null;
    if (defaultRoleId) {
      const configured = roles.find((r) => r.id === defaultRoleId);
      // A configured id that no longer resolves should not be possible —
      // `on delete set null` clears it — but a stale read races a concurrent
      // role delete, and falling through to Member beats issuing an invite
      // whose role name is `undefined`.
      if (configured) return configured.name;
      this.logger.warn(
        `Chapter ${chapterId} has default_invite_role_id ${defaultRoleId} that resolves to no role; falling back to the Member role.`,
      );
    }

    const member = roles.find((r) => r.system_key === SystemRoleKeys.MEMBER);
    if (member) return member.name;

    throw new BadRequestException({
      code: 'invite.role_unresolved',
      message:
        'No role was named, this chapter has no default invite role configured, and it has no seeded Member role to fall back to.',
    });
  }

  async create(
    chapterId: string,
    createdBy: string,
    requestedRole?: string,
  ): Promise<Invite> {
    // No billing check here by design — subscription state is enforced at the
    // request boundary by ChapterGuard, not in this service. Do not read that
    // as "invites are ungated": the controller is @FreeTier() (so an
    // `incomplete` chapter may mint, per the Chunk 03 wedge) but this route is
    // also @GraceBlocked(), which blocks minting on `past_due` even inside the
    // 3-day grace window. `canceled` blocks it too.
    const role = await this.resolveInviteRole(chapterId, requestedRole);
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
    requestedRole: string | undefined,
    count: number,
  ): Promise<Invite[]> {
    const role = await this.resolveInviteRole(chapterId, requestedRole);
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
   * link. Same gating as `create`/`createBatch` — no billing check here; the
   * subscription rules live in the controller's decorators, which are
   * `@FreeTier()` *and* `@GraceBlocked()`. The latter is what blocks minting
   * on a `past_due` chapter, so these decorators gate this route rather than
   * exempting it.
   *
   * Email delivery is best-effort per address: a send failure never rolls
   * back the invite token (the token is still valid and can be shared
   * manually), it is only reported back in `failed` so the caller can retry
   * or fall back to the share link for those addresses.
   */
  async createWithEmails(
    chapterId: string,
    createdBy: string,
    requestedRole: string | undefined,
    emails: string[],
  ): Promise<BulkEmailInviteResult> {
    const role = await this.resolveInviteRole(chapterId, requestedRole);
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

    await this.notifyInviterOfAcceptance(invite, userId);

    return { chapterId: invite.chapter_id, memberId: member.id };
  }

  /**
   * Posts a `system_audit` DM to the inviter naming who accepted, per
   * spec/behavior/chat/README.md. Mirrors the raw-insert pattern
   * `chapter-onboarding.service.ts` uses for its welcome message —
   * `ChatService.sendMessage` would reject `SYSTEM_SENDER_ID` as a poster in a
   * DM it isn't one of the two members of, so this bypasses it the same way.
   * Never allowed to fail the redemption itself: an inviter who left the
   * chapter, a missing accepter profile, or any insert error is logged and
   * swallowed, not thrown.
   */
  private async notifyInviterOfAcceptance(
    invite: Invite,
    accepterUserId: string,
  ): Promise<void> {
    // A rejoin (the inviter left the chapter, then redeems their own
    // still-valid token) makes accepter === inviter — `getOrCreateDm` only
    // checks array length, so [x, x] would silently pass and produce a
    // degenerate self-DM. Nothing to announce to the accepter about
    // themselves, so skip it outright.
    if (invite.created_by === accepterUserId) return;

    try {
      const accepter = await this.userRepo.findById(accepterUserId);
      if (!accepter) return;

      const dm = await this.chatService.getOrCreateDm({
        chapter_id: invite.chapter_id,
        member_ids: [invite.created_by, accepterUserId],
      });

      const message: TablesInsert<'chat_messages'> = {
        channel_id: dm.id,
        sender_id: SYSTEM_SENDER_ID,
        content: `${accepter.display_name} accepted your invite.`,
        kind: 'system_audit',
      };
      const { error } = await this.supabase
        .from('chat_messages')
        .insert(message);
      if (error) {
        this.logger.warn(
          'Invite-accept system_audit message insert failed',
          error,
        );
      }
    } catch (error) {
      this.logger.warn('Failed to notify inviter of invite acceptance', error);
    }
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
