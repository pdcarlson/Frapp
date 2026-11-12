import { randomUUID } from 'node:crypto';
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
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
import {
  SystemPermissions,
  SystemRoleKeys,
  WILDCARD,
} from '#domain/constants/permissions';
import { isSubscriptionHardLocked } from '#domain/constants/subscription-grace';
import { NotificationService } from './notification.service';
import { RbacService } from './rbac.service';
import {
  permissionsNotHeld,
  ranksAtOrAbove,
  roleRank,
} from '#domain/utils/role-rank';
import { ActivationService } from './activation.service';
import { ChatService } from './chat.service';
import { LegalAcceptanceService } from './legal-acceptance.service';
import { EMAIL_PROVIDER } from '#domain/adapters/email.interface';
import type { IEmailProvider } from '#domain/adapters/email.interface';
import { CHAT_MESSAGE_REPOSITORY } from '#domain/repositories/chat.repository.interface';
import type { IChatMessageRepository } from '#domain/repositories/chat.repository.interface';
import type { ChatMessage } from '#domain/entities/chat.entity';
import { logThrowable } from '../../infrastructure/observability/log-throwable';
import { reportCaughtFailure } from '../../infrastructure/observability/report-caught-failure';
import {
  resolveAppOrigin,
  buildJoinUrl,
} from '../../infrastructure/email/invite-link.util';
import {
  assertHttpsJoinOrigin,
  chapterTextMark,
  dedupeEmails,
  MEMBER_JOINED_AUDIENCE,
} from '@repo/validation';
import { orgHidingGreekLettersIn } from '@repo/org-archetypes';
import { SYSTEM_SENDER_ID } from '#domain/constants/chat';

/**
 * What an invite is for, read without using it up (#3352). Only what the
 * person holding the token is about to see anyway once they join.
 */
export interface InvitePreview {
  chapter_name: string;
  university: string;
  /**
   * The chapter's text mark, resolved by `chapterTextMark` after the org
   * override in `preview`. The rule clients read is the `mark_text`
   * description on `InvitePreviewResponseDto` (invite.dto.ts).
   */
  mark_text: string | null;
  accent_color: string | null;
  /** The inviter's display name, or null when their profile is gone. */
  invited_by: string | null;
  /**
   * The invite's own role, which the redeem grants (`resolveRedeemRole`);
   * the redeem may add Everyone beside it (`resolveRedeemRoles`). Null when
   * it would grant none (the invite's role is gone and the chapter has no
   * Everyone role to fall back to), or only Everyone, which no card names.
   */
  role: string | null;
  expires_at: string;
}

/**
 * One invite waiting for the caller's verified address
 * (`GET /v1/invites/mine`, #3776): the preview card's facts plus the token the
 * join screen redeems.
 */
export interface PendingInvite extends InvitePreview {
  token: string;
}

/**
 * The address Supabase Auth has verified for this account, or null.
 * `email_confirmed_at` is set by a confirmed sign-up or magic link, or by an
 * OAuth provider that reports the address verified. Hosted projects require
 * confirmation (docs/ops/deployment/supabase.md#auth-settings-hosted-dashboard-or-management-api),
 * and `auth-email-confirm` in scripts/ci/staging-conformance.mjs asserts it
 * daily on both, because with autoconfirm on anyone could claim an invitee's
 * address. A pending
 * email change sits in `new_email`, not `email`, until it is confirmed too.
 */
export function verifiedEmailOf(
  user:
    | { email?: string | null; email_confirmed_at?: string | null }
    | null
    | undefined,
): string | null {
  if (!user?.email || !user.email_confirmed_at) return null;
  return user.email;
}

/**
 * Where an invite stands, for the inviter's list (`GET /v1/invites`).
 * `revoked` before `joined` because a revoke also sets `used_at`; `expired`
 * only for one nobody used.
 */
export type InviteStatus = 'pending' | 'joined' | 'expired' | 'revoked';

export function inviteStatus(invite: Invite, now = new Date()): InviteStatus {
  if (invite.revoked_at) return 'revoked';
  if (invite.used_at) return 'joined';
  if (new Date(invite.expires_at) <= now) return 'expired';
  return 'pending';
}

/** One row of `GET /v1/invites`: the stored invite plus its status. */
function toListItem(invite: Invite, now: Date): InviteListItem {
  return {
    id: invite.id,
    token: invite.token,
    role: invite.role,
    email: invite.email ?? null,
    status: inviteStatus(invite, now),
    expires_at: invite.expires_at,
    used_at: invite.used_at,
    revoked_at: invite.revoked_at ?? null,
    created_at: invite.created_at,
  };
}

export interface InviteListItem {
  id: string;
  token: string;
  role: string;
  email: string | null;
  status: InviteStatus;
  expires_at: string;
  used_at: string | null;
  revoked_at: string | null;
  created_at: string;
}

export interface BulkEmailInviteResult {
  /** The new invites, as `GET /v1/invites` lists them. */
  invites: InviteListItem[];
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
    @Inject(CHAT_MESSAGE_REPOSITORY)
    private readonly chatMessages: IChatMessageRepository,
    private readonly legalAcceptance: LegalAcceptanceService,
    private readonly rbac: RbacService,
  ) {}

  private prepareInviteData(
    chapterId: string,
    createdBy: string,
    role: string,
    email: string | null = null,
  ): Partial<Invite> {
    const expiresAt = new Date();
    expiresAt.setHours(expiresAt.getHours() + 24);

    return {
      token: randomUUID(),
      chapter_id: chapterId,
      role,
      expires_at: expiresAt.toISOString(),
      created_by: createdBy,
      email,
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
    requested: string | undefined,
    inviterUserId: string,
  ): Promise<string> {
    const role = await this.resolveInviteRoleName(chapterId, requested);
    await this.assertInviteRoleWithinReach(chapterId, inviterUserId, role);
    return role;
  }

  /**
   * The rank rule for invites (#4071): an invite may grant a role ranked at
   * or below the inviter, so a member brings in a peer or someone junior and
   * never a superior. A chair holding `members:invite` cannot mint a
   * Vice President's invite and redeem it on a second account. The rule
   * applies to the default role too, which a `chapter-config:manage` holder
   * may have set above the inviter.
   *
   * A role carrying `*` is never granted by an invite, the President's
   * included: the President role moves only through Transfer presidency, and
   * the redeem refuses it as well ({@link resolveRedeemRoles}).
   *
   * The inviter must also hold every permission the role carries, so an
   * invite into a peer's role cannot bring in what the inviter lacks (a Vice
   * President inviting a second account as Treasurer for `billing:manage`).
   * What the chapter's Member role carries is exempt: every member gets it.
   *
   * The role checked is the one the redeem grants: a name no role carries is
   * checked as the Member role it falls back to.
   */
  private async assertInviteRoleWithinReach(
    chapterId: string,
    inviterUserId: string,
    roleName: string,
  ): Promise<void> {
    const { reach, roles, positions } = await this.rbac.getRankContext(
      chapterId,
      inviterUserId,
    );
    const member = roles.find((r) => r.system_key === SystemRoleKeys.MEMBER);
    const role =
      roles.find((candidate) => candidate.name === roleName) ?? member;
    if (!role) return;
    if (role.permissions.includes(WILDCARD)) {
      throw new ForbiddenException(
        'An invite cannot grant the President role; use Transfer presidency',
      );
    }
    if (
      !reach.wildcard &&
      !ranksAtOrAbove(reach.rank, roleRank(role, positions))
    ) {
      throw new ForbiddenException(
        'You can only invite people into a role ranked at or below your own.',
      );
    }
    const base = new Set(member?.permissions ?? []);
    const missing = permissionsNotHeld(reach, role.permissions).filter(
      (permission) => !base.has(permission),
    );
    if (missing.length > 0) {
      throw new ForbiddenException(
        `You can only invite people into a role whose permissions you hold: ${missing.join(', ')}.`,
      );
    }
  }

  private async resolveInviteRoleName(
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
  ): Promise<InviteListItem> {
    // No billing check here by design — subscription state is enforced at the
    // request boundary by ChapterGuard, not in this service. Do not read that
    // as "invites are ungated": the controller is @FreeTier() (so an
    // `incomplete` chapter may mint, per the Chunk 03 wedge) but this route is
    // also @GraceBlocked(), which blocks minting on `past_due` even inside the
    // 3-day grace window. `canceled` blocks it too.
    const role = await this.resolveInviteRole(
      chapterId,
      requestedRole,
      createdBy,
    );
    const data = this.prepareInviteData(chapterId, createdBy, role);
    const invite = await this.inviteRepo.create(data);
    // Funnel step 2 (#267). Recorded after the write so an invite that failed
    // to persist never counts as one the chapter created.
    await this.activation.record(chapterId, 'activation-first-invite-created', {
      batch_size: 1,
    });
    return toListItem(invite, new Date());
  }

  async createBatch(
    chapterId: string,
    createdBy: string,
    requestedRole: string | undefined,
    count: number,
  ): Promise<Invite[]> {
    const role = await this.resolveInviteRole(
      chapterId,
      requestedRole,
      createdBy,
    );
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
    const role = await this.resolveInviteRole(
      chapterId,
      requestedRole,
      createdBy,
    );
    const uniqueEmails = dedupeEmails(emails);

    // The address rides on the row so the inviter's list can name who each
    // invite went to (`GET /v1/invites`), not show a token.
    const inviteData = uniqueEmails.map((email) =>
      this.prepareInviteData(chapterId, createdBy, role, email),
    );
    const origin = resolveAppOrigin(this.config);
    // Refuse a public http: APP_URL before inserting tokens. mintJoinUrl
    // would otherwise throw inside the send loop, after createMany, and
    // bypass the per-address `.catch` on sendInviteEmail.
    assertHttpsJoinOrigin(new URL(origin));
    const [invites, chapter, inviter] = await Promise.all([
      this.inviteRepo.createMany(inviteData),
      // The email names the chapter and who sent it, so the recipient knows
      // what they are joining before they open the link. Read alongside the
      // insert; a missing row, or a failed read, only drops that line from the
      // email, because the tokens are already in by then.
      this.chapterRepo.findById(chapterId).catch(() => null),
      this.userRepo.findById(createdBy).catch(() => null),
    ]);

    // Correlate by token rather than by array position: each token was
    // generated here, before the insert, so it is a stable key regardless of
    // what order the repository happens to return rows in — `createMany`'s
    // interface makes no ordering guarantee, and a positional zip would
    // silently mis-attribute which address gets which join link if that ever
    // changed.
    const emailByToken = new Map(
      inviteData.map((data, i) => [data.token as string, uniqueEmails[i]]),
    );

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
            chapterName: chapter?.name ?? null,
            inviterName: inviter?.display_name ?? null,
          })
          .catch(() => false);
        return { to, sent };
      },
    );
    const failed = deliveries.filter((d) => !d.sent).map((d) => d.to);
    await this.replaceOlderInvites(
      chapterId,
      deliveries.filter((d) => d.sent).map((d) => d.to),
      new Set(invites.map((invite) => invite.id)),
    );

    await this.activation.record(chapterId, 'activation-first-invite-created', {
      batch_size: invites.length,
    });

    const now = new Date();
    return {
      invites: invites.map((invite) => toListItem(invite, now)),
      failed,
    };
  }

  /**
   * A new invite that reached an address replaces that address's older
   * pending ones, so resending never leaves two live links for one person
   * (spec/behavior/members.md § Invite Flow). An address whose new email
   * failed keeps its older invite, which may be the one that arrived. Best
   * effort: the new invites are already out, so a failure here is logged, not
   * thrown.
   */
  private async replaceOlderInvites(
    chapterId: string,
    delivered: string[],
    newIds: Set<string>,
  ): Promise<void> {
    if (delivered.length === 0) return;
    const addresses = new Set(delivered.map((email) => email.toLowerCase()));
    try {
      const older = (await this.inviteRepo.findByChapter(chapterId)).filter(
        (invite) =>
          !newIds.has(invite.id) &&
          !invite.used_at &&
          !!invite.email &&
          addresses.has(invite.email.toLowerCase()),
      );
      await this.inviteRepo.revokePending(older.map((invite) => invite.id));
    } catch (error) {
      logThrowable(
        this.logger,
        'warn',
        'Failed to revoke older invites after a resend',
        error,
      );
    }
  }

  /**
   * The invite behind `token`, if it can still be redeemed. Gone (410) for a
   * token that never existed, was used, or expired: the join screens treat
   * all three as a dead link (`joinErrorCopy`).
   */
  private async findLiveInvite(token: string): Promise<Invite> {
    const invite = await this.inviteRepo.findByToken(token);
    if (!invite) throw new GoneException('Invite not found');
    if (invite.used_at) throw new GoneException('Invite already used');
    if (new Date(invite.expires_at) < new Date())
      throw new GoneException('Invite expired');
    return invite;
  }

  /**
   * The invite's own role, as the redeem resolves it. `invite.role` is the display name chosen when
   * the invite was issued, so it is matched by name by design. The fallback is
   * the seeded Member role, which resolves by `system_key`: a chapter that
   * relabelled it would otherwise leave redeemers with no role at all.
   */
  private async resolveRedeemRole(invite: Invite) {
    const { role } = await this.resolveRedeemRoles(invite);
    return role;
  }

  /**
   * The role a redeem grants, plus every role id the new membership starts
   * with. A role a chapter made itself, or one a Discord import brought over,
   * often carries nothing but a `channels:read:<slug>` permission. Granted
   * alone it leaves the new member refused on every screen, because the
   * access every member needs (`members:view`) lives on the seeded roles
   * (2026-11-07: two testers invited as "Cabinet"). So a role that is not
   * seeded (`is_system` false, which also covers seeded roles renamed before
   * `system_key` existed) and grants neither `members:view` nor `*` comes with
   * the chapter's Member role. Member goes after the invited role, because
   * web's Members list labels a member by their first role. Every other role
   * is granted alone, as before.
   */
  private async resolveRedeemRoles(invite: Invite) {
    const roles = await this.roleRepo.findByChapter(invite.chapter_id);
    const member = roles.find((r) => r.system_key === SystemRoleKeys.MEMBER);
    // A role carrying `*` is never granted by a redeem, even by an invite
    // minted before invites refused it (#4071): presidency moves only through
    // Transfer presidency. The redeem grants the Member role instead.
    const named = roles.find((r) => r.name === invite.role);
    const role =
      named && !named.permissions.includes(WILDCARD) ? named : member;
    if (!role) return { role, roleIds: [] as string[] };
    const roleIds = [role.id];
    if (member && member.id !== role.id && lacksBaseAccess(role)) {
      roleIds.push(member.id);
    }
    return { role, roleIds };
  }

  /**
   * What an invite is for, without using it up (#3352): the chapter, who sent
   * it and the role it grants, for the join screen's confirm card. It checks
   * only what makes a token dead (410, as redeem does); the subscription lock,
   * the Terms and an existing membership are the redeem's to answer, with the
   * errors the join screens already handle.
   *
   * Signed-in only, like redeem: the token is the secret, and the caller is
   * about to redeem it, so it learns nothing it wouldn't on joining. A POST
   * so the token rides in the body, not in a URL that access logs keep.
   */
  async preview(token: string): Promise<InvitePreview> {
    const invite = await this.findLiveInvite(token);
    const preview = await this.describe(invite);
    // A chapter deleted under a live invite: as dead as the link gets.
    if (!preview) throw new GoneException('Invite not found');
    return preview;
  }

  /**
   * The confirm card's facts for one live invite, or null when its chapter is
   * gone. Shared by `preview` and `findPendingForVerifiedEmail`.
   */
  private async describe(invite: Invite): Promise<InvitePreview | null> {
    const [chapter, inviter, role] = await Promise.all([
      this.chapterRepo.findById(invite.chapter_id),
      this.userRepo.findById(invite.created_by),
      this.resolveRedeemRole(invite),
    ]);
    if (!chapter) return null;
    // An organization that never displays its letters (FIJI) keeps them off
    // the card even when the chapter's stored switch was never turned off, as
    // for one created before its org profile knew to (#3421). The match reads
    // the organization's name inside the chapter's ("Phi Gamma Delta Tau
    // Nu"), the override web's nav crest and mobile's Chat home also apply.
    // Done here rather than on the card so every client gets it.
    const branding = orgHidingGreekLettersIn(chapter.name)
      ? { ...chapter.branding, show_greek_letters: false }
      : chapter.branding;
    return {
      chapter_name: chapter.name,
      university: chapter.university,
      mark_text: chapterTextMark(branding)?.text ?? null,
      accent_color: chapter.accent_color,
      invited_by: inviter?.display_name ?? null,
      // Joining with only the Everyone role (#4191) joins as nobody in
      // particular: the card says no role, as it does for none.
      role:
        role && role.system_key !== SystemRoleKeys.MEMBER ? role.name : null,
      expires_at: invite.expires_at,
    };
  }

  /**
   * The invites waiting for the caller, found by their address rather than by
   * a link (#3776): every pending invite (not used, revoked or expired) that
   * was emailed to `verifiedEmail`, minus chapters the caller already belongs
   * to, newest first, each with its token so the join screen can redeem it.
   *
   * `verifiedEmail` must be the address Supabase Auth has verified for the
   * caller (`verifiedEmailOf`), never one the client names: the token is the
   * whole credential at redeem, so handing it out is safe only to whoever
   * already proved they read that inbox, the one place the invite email went.
   * With no verified address the answer is empty.
   */
  async findPendingForVerifiedEmail(
    verifiedEmail: string | null,
    userId: string,
  ): Promise<PendingInvite[]> {
    const email = verifiedEmail?.trim();
    if (!email) return [];
    const invites = await this.inviteRepo.findPendingByEmail(email, new Date());
    if (invites.length === 0) return [];
    const memberships = await this.memberRepo.findByUser(userId);
    const joined = new Set(memberships.map((m) => m.chapter_id));
    // One card per chapter: the newest invite wins. Sending again revokes the
    // older one (`replaceOlderInvites`), but two officers can each send one.
    const seen = new Set<string>();
    const live = invites.filter((invite) => {
      if (joined.has(invite.chapter_id) || seen.has(invite.chapter_id)) {
        return false;
      }
      seen.add(invite.chapter_id);
      return true;
    });
    const described = await Promise.all(
      live.map(async (invite) => {
        const preview = await this.describe(invite);
        return preview ? { ...preview, token: invite.token } : null;
      }),
    );
    return described.filter((row): row is PendingInvite => row !== null);
  }

  /**
   * Bind the *current* user to this token. Invite email is not matched against
   * `users.email`, so Apple Hide My Email / `privaterelay.appleid.com` still
   * joins when the member opens the invite after signing in.
   *
   * `acceptTerms` is the join screen's Terms checkbox (#2302). A user who has
   * not accepted the current Terms must tick it, or the join is refused with
   * `legal.acceptance_required` and the token is left unconsumed. A user who
   * already accepted this version joins without it.
   */
  async redeem(
    token: string,
    userId: string,
    acceptTerms = false,
  ): Promise<{ chapterId: string; memberId: string }> {
    const invite = await this.findLiveInvite(token);

    const existingMember = await this.memberRepo.findByUserAndChapter(
      userId,
      invite.chapter_id,
    );
    if (existingMember)
      throw new ConflictException('Already a member of this chapter');

    // The chapter that matters here is the INVITE's, which `ChapterGuard`
    // never sees — it resolves the caller's active chapter, and a brand-new
    // user has none — so the subscription lock is evaluated here (#1546).
    // `spec/behavior/data-retention.md`: a canceled chapter cannot gain
    // members. Minting already stops the moment a chapter lapses; this closes
    // the 24h window in which a token minted before the lapse could still add
    // one. Checked BEFORE the atomic claim so the token is not consumed: the
    // chapter may recover inside the token's lifetime, and the same link then
    // works. 403 rather than the token-terminal 410 for the same reason —
    // nothing is wrong with the invite, and the copy should say what is. And
    // AFTER the duplicate-membership check: a member of a locked chapter who
    // opens a still-valid link needs the 409 the join screens special-case
    // ("open it from your chapter list"), not advice to wait for a restore.
    const chapter = await this.chapterRepo.findById(invite.chapter_id);
    if (chapter && isSubscriptionHardLocked(chapter)) {
      throw new ForbiddenException({
        code:
          chapter.subscription_status === 'canceled'
            ? 'chapter.subscription.canceled'
            : 'chapter.subscription.write_locked',
        message:
          "This chapter isn't accepting new members right now: its subscription is inactive. Ask a chapter officer to restore it, then use this invite again.",
      });
    }

    // Every member agrees to the Terms before they can post (#2302, Guideline
    // 1.2). After the token and lock checks, so a dead link or a locked
    // chapter answers with what is actually wrong rather than asking for a
    // checkbox; before the claim, so a refusal leaves the token usable.
    await this.legalAcceptance.requireOrAccept(userId, acceptTerms);

    // Before the claim, so a roles outage does not consume the token (#1863).
    const { roleIds } = await this.resolveRedeemRoles(invite);

    const claimedAt = await this.inviteRepo.markUsedAtomically(invite.id);
    if (!claimedAt) throw new GoneException('Invite already used');

    let member: Awaited<ReturnType<IMemberRepository['create']>>;
    try {
      member = await this.memberRepo.create({
        user_id: userId,
        chapter_id: invite.chapter_id,
        role_ids: roleIds,
      });
    } catch (error) {
      // The claim is not redemption yet: spec/behavior/onboarding.md sets
      // used_at on a successful redeem. Release so a failed insert does not
      // 410 the same token (#1863). Skip the release if a membership row is
      // already there — create() can throw after the insert committed, and
      // releasing then would let a second redeemer join on the same token.
      // Match this claim's used_at, so a revoke that landed inside this window
      // (it overwrites used_at) stays revoked. A lookup or release failure
      // must not hide `error`.
      let membershipLanded = false;
      try {
        membershipLanded = Boolean(
          await this.memberRepo.findByUserAndChapter(userId, invite.chapter_id),
        );
      } catch (lookupError) {
        logThrowable(
          this.logger,
          'warn',
          'Failed to check membership after invite redeem insert error; leaving claim in place',
          lookupError,
        );
        membershipLanded = true;
      }
      if (!membershipLanded) {
        try {
          await this.inviteRepo.releaseClaim(invite.id, claimedAt);
        } catch (releaseError) {
          reportCaughtFailure(this.logger, {
            level: 'error',
            site: 'invite-redeem-claim-release-failed',
            message: 'Failed to release invite after membership insert failed',
            error: releaseError,
          });
        }
      }
      throw error;
    }

    // Funnel step 3 (#267) — the chapter's first *successful* redemption, which
    // is the point where it stops being one founder and starts being a chapter.
    // Placed after `markUsedAtomically` and the member insert so an expired,
    // already-claimed, or duplicate-membership attempt never counts.
    await this.activation.record(
      invite.chapter_id,
      'activation-first-invite-redeemed',
    );

    try {
      // Named, and not sent to the member who just joined: "A new member has
      // joined the chapter" told everyone nothing, the joiner included
      // (notifications.md § What a push says). Sent only to the members who
      // can act on a join (#3656), on the `members` category, whose switch
      // `@repo/validation` shows to exactly this audience (#4008).
      const [holders, joiner] = await Promise.all([
        this.rbac.findUserIdsWithAnyPermissions(
          invite.chapter_id,
          MEMBER_JOINED_AUDIENCE,
        ),
        // The name is a nicety: a failed read costs the name, not the push.
        this.userRepo
          .findByIds([userId])
          .then(([user]) => user)
          .catch(() => undefined),
      ]);
      const recipients = holders.filter((id) => id !== userId);
      if (recipients.length > 0) {
        const name = joiner?.display_name?.trim();
        await this.notificationService.notifyMembers(
          invite.chapter_id,
          recipients,
          {
            title: name ? `${name} joined` : 'A new member joined',
            body: 'New member of the chapter',
            priority: 'NORMAL',
            category: 'members',
            // `memberUserId` is who joined, a `users.id`, so the in-app list
            // draws their picture and their name's colour (#4346). Not
            // `senderId`: that key means a chat sender, and a block withholds
            // rows by it. Not `memberId`, which means a `members.id`.
            data: { target: { screen: 'members' }, memberUserId: userId },
          },
        );
      }
    } catch (error) {
      reportCaughtFailure(this.logger, {
        level: 'error',
        site: 'invite-redeem-new-member-notify-failed',
        message: `Failed to send the member-joined notification (chapter ${invite.chapter_id})`,
        error,
      });
    }

    await this.notifyInviterOfAcceptance(invite, userId);

    return { chapterId: invite.chapter_id, memberId: member.id };
  }

  /**
   * Posts a `system_audit` DM to the inviter naming who accepted, per
   * spec/behavior/chat/README.md. Writes through the message repository, as
   * `PollService` does for its closing notice — `ChatService.sendMessage` would
   * reject `SYSTEM_SENDER_ID` as a poster in a DM it isn't one of the two
   * members of, so this bypasses it.
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

      const message: Partial<ChatMessage> = {
        channel_id: dm.id,
        sender_id: SYSTEM_SENDER_ID,
        content: `${accepter.display_name} accepted your invite.`,
        kind: 'system_audit',
      };
      try {
        await this.chatMessages.create(message);
      } catch (error) {
        logThrowable(
          this.logger,
          'warn',
          'Invite-accept system_audit message insert failed',
          error,
        );
      }
    } catch (error) {
      logThrowable(
        this.logger,
        'warn',
        'Failed to notify inviter of invite acceptance',
        error,
      );
    }
  }

  /**
   * The chapter's invites, newest first, each with its status (#3607), so
   * clients read one field rather than inferring revoked from `used_at`.
   * `created_by` and `chapter_id` stay server-side: the list is the inviter's
   * view of who was asked, not an audit of who asked.
   */
  async findByChapter(chapterId: string): Promise<InviteListItem[]> {
    const now = new Date();
    const invites = await this.inviteRepo.findByChapter(chapterId);
    return invites.map((invite) => toListItem(invite, now));
  }

  async revoke(id: string, chapterId: string): Promise<void> {
    const invite = await this.inviteRepo.findById(id);

    if (!invite || invite.chapter_id !== chapterId) {
      throw new NotFoundException('Invite not found');
    }

    if (invite.used_at) {
      throw new BadRequestException('Invite has already been used');
    }

    // A redeem racing this write may still land its membership; the revoke
    // wins the token either way, so a failed redeem can't reopen it.
    await this.inviteRepo.markRevoked(id);
  }
}

/**
 * A role that is not seeded and gives none of the access every member needs.
 * See `InviteService.resolveRedeemRoles`.
 */
function lacksBaseAccess(role: {
  is_system: boolean;
  permissions: string[] | null;
}): boolean {
  if (role.is_system) return false;
  const permissions = role.permissions ?? [];
  return (
    !permissions.includes(WILDCARD) &&
    !permissions.includes(SystemPermissions.MEMBERS_VIEW)
  );
}
