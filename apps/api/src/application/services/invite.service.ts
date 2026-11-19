import { randomUUID } from 'node:crypto';
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  GoneException,
  HttpException,
  HttpStatus,
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
import type { Role } from '#domain/entities/role.entity';
import {
  SystemPermissions,
  SystemRoleKeys,
  WILDCARD,
} from '#domain/constants/permissions';
import { isSubscriptionHardLocked } from '#domain/constants/subscription-grace';
import { isUniqueViolation } from '#domain/constants/postgres-error-codes';
import { NotificationService } from './notification.service';
import { RbacService } from './rbac.service';
import type { RankContext } from '#domain/utils/rank-context';
import { inviteRefusal, memberRoleOf } from '#domain/utils/invite-reach';
import {
  DAILY_LIMIT_WINDOW_MS,
  INVITE_EMAILS_PER_CHAPTER_PER_DAY,
  INVITE_EMAILS_PER_INVITER_PER_DAY,
} from '#domain/constants/daily-send-limits';
import {
  rollingWindowRoom,
  waitPhrase,
  type RollingWindowRoom,
} from '#domain/utils/rolling-window';
import { ActivationService } from './activation.service';
import { LegalAcceptanceService } from './legal-acceptance.service';
import { EMAIL_PROVIDER } from '#domain/adapters/email.interface';
import type { IEmailProvider } from '#domain/adapters/email.interface';
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
  EVERYONE_ROLE_NAME,
  MEMBER_JOINED_AUDIENCE,
} from '@repo/validation';
import { orgHidingGreekLettersIn } from '@repo/org-archetypes';

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
   * An invite the redeem would refuse (#1830) gets no preview: `preview`
   * answers 403 and `/mine` leaves it out.
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

/**
 * What the invite's sender is told when someone joins with it (#5625): their
 * own invite, so it says so, rather than the officers' "<name> joined".
 */
function inviterNoticeTitle(
  name: string | undefined,
  chapterLink: boolean,
): string {
  const who = name || 'Someone';
  return chapterLink
    ? `${who} joined with your chapter link`
    : `${who} accepted your invite`;
}

/**
 * An invite's state as its link tells it (#5625). A chapter link is never
 * `used`: any number of people join with it until it expires or is turned off.
 * A link that would otherwise work, into a chapter whose subscription locks it
 * (`isSubscriptionHardLocked`, the redeem's own 403), reads `locked`: nothing
 * is wrong with the link, and it works again once the chapter is restored.
 */
function linkState(
  invite: Invite,
  described: { refused: boolean; locked: boolean },
  now: Date,
): InviteLinkState {
  if (invite.revoked_at || described.refused) return 'off';
  if (invite.used_at && !invite.reusable) return 'used';
  if (new Date(invite.expires_at) <= now) return 'expired';
  if (described.locked) return 'locked';
  return 'live';
}

/**
 * How long after it was made a dead link still names its chapter and sender
 * (#5625). Long enough to find a link in last month's texts and ask for a new
 * one; past it, an old token tells its holder nothing, as one that never
 * existed doesn't.
 */
export const DEAD_INVITE_DETAILS_DAYS = 30;
const DAY_MS = 24 * 60 * 60 * 1000;

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
    reusable: invite.reusable === true,
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
  /** The chapter link (#3353), which many people join with. */
  reusable: boolean;
}

/**
 * How long a chapter link works (#3353, Paul 2026-11-19: "One chapter link,
 * 7 days"): long enough for a Discord post to reach everyone, short enough
 * that a link someone forwards doesn't work forever.
 */
export const CHAPTER_LINK_DAYS = 7;

/**
 * How long a personal invite works (Paul 2026-11-19, #5625: "7 days", up from
 * 24 hours). A link texted on a Friday night was dead by Sunday; a week
 * matches the chapter link and Discord's default, and an officer can still
 * revoke one sooner.
 */
export const INVITE_DAYS = 7;

/**
 * Whether an invite link can still be used, as the invite screen tells it
 * before anyone signs in (`POST /v1/invites/details`, #5625). `off` covers a
 * revoked invite and one its sender can no longer grant: neither can be
 * joined, and both are answered the same way, by asking the sender for a new
 * link. `locked` is a working link into a chapter whose subscription is
 * inactive ({@link linkState}).
 */
export type InviteLinkState = 'live' | 'expired' | 'used' | 'off' | 'locked';

/** What the invite screen shows for a link, dead or alive (#5625). */
export interface InviteDetails extends InvitePreview {
  state: InviteLinkState;
  /** The chapter, so a signed-in visitor already in it is told so before Join. */
  chapter_id: string;
  /** How many members the chapter has: "41 members" on the card. 0 on a link that doesn't work. */
  member_count: number;
  /** When the invite was made: "sent it on Friday, November 14" on a dead card. */
  sent_at: string;
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

/** The emailed-invite ceiling's refusal (429), on top of its sentence. */
export const INVITE_EMAIL_LIMIT_CODE = 'invite.email_daily_limit';

/**
 * What the sender reads at the emailed-invite ceiling: which ceiling, how many
 * are left, when this batch would fit, and that a share link works now. The
 * clients show it as written (`SERVER_MESSAGE_PATTERNS` in
 * `@repo/validation`), so it is in the sender's words.
 */
export function emailInviteLimitMessage(
  ceiling: RollingWindowRoom & {
    who: 'chapter' | 'inviter';
    limit: number;
    roomAt: Date;
  },
  needed: number,
  now: Date,
): string {
  const left = ceiling.remaining === 0 ? 'none' : String(ceiling.remaining);
  const first =
    ceiling.who === 'chapter'
      ? `Your chapter can email up to ${ceiling.limit} invites in 24 hours and has ${left} left.`
      : `You can email up to ${ceiling.limit} invites in 24 hours and have ${left} left.`;
  const these = needed === 1 ? 'this one' : `these ${needed}`;
  return `${first} You can send ${these} in ${waitPhrase(ceiling.roomAt, now)}, or share an invite link now.`;
}

/** The seeded Everyone role's name before #4191, which older builds send. */
const LEGACY_MEMBER_ROLE_NAME = 'Member';

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
    @Inject(EMAIL_PROVIDER) private readonly emailProvider: IEmailProvider,
    private readonly config: ConfigService,
    private readonly legalAcceptance: LegalAcceptanceService,
    private readonly rbac: RbacService,
  ) {}

  private prepareInviteData(
    chapterId: string,
    createdBy: string,
    role: string,
    email: string | null = null,
    reusable = false,
  ): Partial<Invite> {
    const expiresAt = new Date();
    expiresAt.setHours(
      expiresAt.getHours() + (reusable ? CHAPTER_LINK_DAYS : INVITE_DAYS) * 24,
    );

    return {
      token: randomUUID(),
      chapter_id: chapterId,
      role,
      expires_at: expiresAt.toISOString(),
      created_by: createdBy,
      email,
      reusable,
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
   *
   * A chapter default the sender couldn't invite into themselves gives way to
   * the Everyone role (#4546), as web's picker falls back to it: a chair on
   * the phone, which names no role, still sends a working invite rather than
   * a 403. A role the sender names is never swapped.
   */
  private async resolveInviteRole(
    chapterId: string,
    requested: string | undefined,
    inviterUserId: string,
  ): Promise<{ role: string; context: RankContext }> {
    const [resolved, context] = await Promise.all([
      this.resolveInviteRoleName(chapterId, requested),
      this.rbac.getRankContext(chapterId, inviterUserId),
    ]);
    let role = resolved;
    const member = memberRoleOf(context);
    if (
      !requested?.trim() &&
      member &&
      inviteRefusal(context, namedRole(context, role)) !== null &&
      inviteRefusal(context, member) === null
    ) {
      role = member.name;
    }
    assertInviteRoleExists(context, role);
    assertInviteRoleWithinReach(context, role);
    return { role, context };
  }

  /**
   * Which of the chapter's invites `userId` may see, copy and revoke (#4546):
   * those granting a role they could invite someone into now
   * (`assertInviteRoleWithinReach`), judged by what the redeem grants
   * ({@link redeemedRole}). The rest still work, and whoever ranks high
   * enough still sees them, but a lower officer neither gets their link nor
   * stops them. Paul, 2026-11-13: officers cannot hand out an invite ranked
   * above their own, minted or reused. A `*` holder sees every invite.
   */
  private async inviteVisibility(
    chapterId: string,
    userId: string,
  ): Promise<(invite: Invite) => boolean> {
    return visibilityIn(await this.rbac.getRankContext(chapterId, userId));
  }

  /**
   * The ids of the roles `userId` may invite someone into
   * (`GET /v1/invites/roles`), so the invite dialog offers only those. The
   * Everyone role is among them whenever the caller may invite at all.
   */
  async findInvitableRoleIds(
    chapterId: string,
    userId: string,
  ): Promise<string[]> {
    const context = await this.rbac.getRankContext(chapterId, userId);
    return context.roles
      .filter((role) => inviteRefusal(context, role) === null)
      .map((role) => role.id);
  }

  private async resolveInviteRoleName(
    chapterId: string,
    requested?: string,
  ): Promise<string> {
    const explicit = requested?.trim();
    if (
      explicit === LEGACY_MEMBER_ROLE_NAME ||
      explicit === EVERYONE_ROLE_NAME
    ) {
      // Mobile builds already in the stores send "Member", the seeded role's
      // name before it became Everyone (#4191), and the founding wizard sends
      // "Everyone" by name; both mean the chapter's Everyone role, whatever
      // it is called, so neither meets the unknown-role 400 (#1830). Stored as sent, a role
      // created later under that freed name would capture the invite at
      // redeem, unchecked against the inviter's rank, so it names the
      // Everyone role instead, unless a role still carries that name.
      const roles = await this.roleRepo.findByChapter(chapterId);
      if (roles.some((r) => r.name === explicit)) return explicit;
      const everyone = roles.find(
        (r) => r.system_key === SystemRoleKeys.MEMBER,
      );
      return everyone?.name ?? explicit;
    }
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
      // role delete, and falling through to Everyone beats issuing an invite
      // whose role name is `undefined`.
      if (configured) return configured.name;
      this.logger.warn(
        `Chapter ${chapterId} has default_invite_role_id ${defaultRoleId} that resolves to no role; falling back to the Everyone role.`,
      );
    }

    const member = roles.find((r) => r.system_key === SystemRoleKeys.MEMBER);
    if (member) return member.name;

    throw new BadRequestException({
      code: 'invite.role_unresolved',
      message:
        'No role was named, this chapter has no default invite role configured, and it has no seeded Everyone role to fall back to.',
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
    const { role } = await this.resolveInviteRole(
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

  /**
   * The chapter link (#3353): one link an officer posts where the whole
   * chapter will see it, such as its Discord. Anyone who opens it joins at the
   * chapter's default invite role (`resolveInviteRole` with no role named)
   * until it expires after {@link CHAPTER_LINK_DAYS} days or an officer turns
   * it off. Null when there is none, or when the one there grants a role the
   * caller couldn't invite someone into ({@link inviteVisibility}): its link
   * is not theirs to copy. An expired one is returned, so the screen can say
   * it expired.
   */
  async findChapterLink(
    chapterId: string,
    userId: string,
  ): Promise<InviteListItem | null> {
    const [link, visible] = await Promise.all([
      this.inviteRepo.findChapterLink(chapterId),
      this.inviteVisibility(chapterId, userId),
    ]);
    if (!link || !visible(link)) return null;
    return toListItem(link, new Date());
  }

  /**
   * A new chapter link, replacing the current one: the old link stops working
   * the moment the new one exists, so an officer who thinks a link spread too
   * far makes a new one. A link granting a role above the caller's reach is
   * not theirs to replace (403), as it is not theirs to revoke.
   */
  async createChapterLink(
    chapterId: string,
    createdBy: string,
  ): Promise<InviteListItem> {
    const [{ role }, current, visible] = await Promise.all([
      this.resolveInviteRole(chapterId, undefined, createdBy),
      this.inviteRepo.findChapterLink(chapterId),
      this.inviteVisibility(chapterId, createdBy),
    ]);
    if (current && !visible(current)) {
      throw new ForbiddenException({
        code: 'invite.chapter_link_out_of_reach',
        message:
          "An officer above you made this chapter's link, so only they can replace it.",
      });
    }
    if (current) await this.inviteRepo.markRevoked(current.id);
    let invite: Invite;
    try {
      invite = await this.inviteRepo.create(
        this.prepareInviteData(chapterId, createdBy, role, null, true),
      );
    } catch (error) {
      // Another officer made one at the same moment (`invites_one_chapter_link`).
      if (isUniqueViolation(error)) {
        throw new ConflictException({
          code: 'invite.chapter_link_conflict',
          message:
            'Another officer just made a chapter link. Reload to see it.',
        });
      }
      throw error;
    }
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
    const { role } = await this.resolveInviteRole(
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
   * or fall back to the share link for those addresses. A failed send is
   * marked on its invite, so it doesn't count toward the daily ceilings
   * ({@link insertWithinDailyCeilings}).
   */
  async createWithEmails(
    chapterId: string,
    createdBy: string,
    requestedRole: string | undefined,
    emails: string[],
  ): Promise<BulkEmailInviteResult> {
    const { role, context } = await this.resolveInviteRole(
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
    // would otherwise throw inside the send loop, after the insert, and
    // bypass the per-address `.catch` on sendInviteEmail.
    assertHttpsJoinOrigin(new URL(origin));
    const [invites, chapter, inviter] = await Promise.all([
      this.insertWithinDailyCeilings(chapterId, createdBy, inviteData),
      // The email names the chapter and who sent it, so the recipient knows
      // what they are joining before they open the link. Read alongside the
      // insert; a missing row, or a failed read, only drops that line from the
      // email, because the tokens are already in by then.
      this.chapterRepo.findById(chapterId).catch(() => null),
      this.userRepo.findById(createdBy).catch(() => null),
    ]);

    // Correlate by token rather than by array position: each token was
    // generated here, before the insert, so it is a stable key regardless of
    // what order the repository happens to return rows in — `createEmailed`'s
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
        return { id: invite.id, to, sent };
      },
    );
    const failed = deliveries.filter((d) => !d.sent).map((d) => d.to);
    await this.inviteRepo
      .markEmailFailed(
        chapterId,
        deliveries.filter((d) => !d.sent).map((d) => d.id),
      )
      .catch((error: unknown) =>
        // The invites keep counting toward the daily ceilings, which errs on
        // the side of sending less.
        logThrowable(
          this.logger,
          'warn',
          'Failed to mark invites whose email was not sent',
          error,
        ),
      );
    await this.replaceOlderInvites(
      chapterId,
      visibilityIn(context),
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
   * Inserts the batch only when it fits under the daily emailed-invite
   * ceilings (`daily-send-limits.ts`): the chapter's, and the sender's across
   * all their chapters, each counting the emailed invites of the last 24
   * hours whose send didn't fail. The repository counts and inserts in one
   * step, one batch per chapter and sender at a time, so batches sent
   * together can't pass a ceiling between them. A batch that doesn't fit is
   * refused (429) whole, before any token is made or email sent, saying how
   * many are left and when this batch would fit; share links send no email
   * and stay open meanwhile.
   */
  private async insertWithinDailyCeilings(
    chapterId: string,
    createdBy: string,
    inviteData: Partial<Invite>[],
  ): Promise<Invite[]> {
    const now = new Date();
    const result = await this.inviteRepo.createEmailed({
      chapterId,
      createdBy,
      invites: inviteData.map((data) => ({
        token: data.token as string,
        role: data.role as string,
        expires_at: data.expires_at as string,
        email: data.email as string,
      })),
      since: new Date(now.getTime() - DAILY_LIMIT_WINDOW_MS),
      chapterLimit: INVITE_EMAILS_PER_CHAPTER_PER_DAY,
      inviterLimit: INVITE_EMAILS_PER_INVITER_PER_DAY,
    });
    if (result.outcome === 'ok') return result.invites;

    const needed = inviteData.length;
    const room = (times: string[], limit: number) =>
      rollingWindowRoom(times, limit, needed, now, DAILY_LIMIT_WINDOW_MS);
    const ceilings = [
      {
        who: 'chapter' as const,
        limit: INVITE_EMAILS_PER_CHAPTER_PER_DAY,
        ...room(result.chapter, INVITE_EMAILS_PER_CHAPTER_PER_DAY),
      },
      {
        who: 'inviter' as const,
        limit: INVITE_EMAILS_PER_INVITER_PER_DAY,
        ...room(result.inviter, INVITE_EMAILS_PER_INVITER_PER_DAY),
      },
    ];
    // The ceiling that frees up last is the one the sender waits on. Neither
    // is over by this clock only when the database's count landed a moment
    // apart from it; a minute is then the honest wait.
    const binding = ceilings
      .filter((c): c is typeof c & { roomAt: Date } => c.roomAt !== null)
      .sort((a, b) => b.roomAt.getTime() - a.roomAt.getTime())[0] ?? {
      ...ceilings[0],
      roomAt: new Date(now.getTime() + 60_000),
    };
    throw new HttpException(
      {
        code: INVITE_EMAIL_LIMIT_CODE,
        message: emailInviteLimitMessage(binding, needed, now),
      },
      HttpStatus.TOO_MANY_REQUESTS,
    );
  }

  /**
   * A new invite that reached an address replaces that address's older
   * pending ones, so resending never leaves two live links for one person
   * (spec/behavior/members.md § Invite Flow). An address whose new email
   * failed keeps its older invite, which may be the one that arrived. Only
   * an invite the sender could revoke is replaced (#4546): a chair's resend
   * never retires the President's Treasurer invite to the same address. Best
   * effort: the new invites are already out, so a failure here is logged, not
   * thrown.
   */
  private async replaceOlderInvites(
    chapterId: string,
    visible: (invite: Invite) => boolean,
    delivered: string[],
    newIds: Set<string>,
  ): Promise<void> {
    if (delivered.length === 0) return;
    const addresses = new Set(delivered.map((email) => email.toLowerCase()));
    try {
      const older = (await this.inviteRepo.findByChapter(chapterId)).filter(
        (invite) =>
          visible(invite) &&
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
    const { role, refusal } = await this.resolveRedeemRoles(invite);
    return { role, refused: refusal !== null };
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
    // The inviter's reach as it stands now, not when they sent the invite
    // (Paul, 2026-11-16, #1830): an officer demoted since can't bring someone
    // in at the rank they lost. One read of the chapter's roles serves both.
    const context = await this.rbac.getRankContext(
      invite.chapter_id,
      invite.created_by,
    );
    const member = memberRoleOf(context);
    // A role deleted since the invite was sent grants the Everyone role.
    const role = context.roles.find((r) => r.name === invite.role) ?? member;
    // Fails closed: an invite for a role carrying `*`, or one its sender can
    // no longer grant, joins nobody, rather than quietly joining as Everyone.
    // A sender who has since left the chapter or lost `members:invite` can no
    // longer invite anyone, the Everyone role included.
    const senderCanInvite =
      context.reach.wildcard ||
      context.reach.permissions.has(SystemPermissions.MEMBERS_INVITE);
    const refusal = senderCanInvite
      ? inviteRefusal(context, role)
      : 'The sender of this invite can no longer invite members.';
    if (!role) return { role, roleIds: [] as string[], refusal };
    const roleIds = [role.id];
    if (member && member.id !== role.id && lacksBaseAccess(role)) {
      roleIds.push(member.id);
    }
    return { role, roleIds, refusal };
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
    const described = await this.describe(invite);
    // A chapter deleted under a live invite: as dead as the link gets.
    if (!described) throw new GoneException('Invite not found');
    // One the redeem would refuse (#1830) says so now, with the redeem's own
    // refusal, rather than offering a Join that can't work.
    if (described.refused) throw inviteRoleOutOfReach();
    return described.preview;
  }

  /**
   * What an invite link shows before anyone signs in (#5625): the chapter, who
   * sent it, the role, and whether it still works. Unlike {@link preview} it
   * needs no account: the token is an unguessable secret, and whoever holds a
   * live one could join with it, so the card tells them nothing joining
   * wouldn't.
   *
   * A dead link answers too, so the screen can still name the chapter and the
   * sender to ask for a new one, but with less: no member count and no role,
   * which only a working link earns, and nothing at all once the invite is
   * more than {@link DEAD_INVITE_DETAILS_DAYS} days old. Not found (404) for
   * that, for a token that never existed, and for one whose chapter is gone.
   * The member count is cosmetic, so a failed count reads as none rather than
   * failing the card.
   */
  async details(token: string, now = new Date()): Promise<InviteDetails> {
    const invite = await this.inviteRepo.findByToken(token);
    if (!invite) throw new NotFoundException('Invite not found');
    const described = await this.describe(invite);
    if (!described) throw new NotFoundException('Invite not found');
    const state = linkState(invite, described, now);
    const live = state === 'live';
    // A locked link still works once the chapter is restored, so it is not
    // dead and keeps answering.
    if (
      !live &&
      state !== 'locked' &&
      now.getTime() - new Date(invite.created_at).getTime() >
        DEAD_INVITE_DETAILS_DAYS * DAY_MS
    ) {
      throw new NotFoundException('Invite not found');
    }
    let memberCount = 0;
    if (live) {
      try {
        memberCount = await this.memberRepo.countByChapter(invite.chapter_id);
      } catch {
        // Cosmetic: the card reads without a count rather than not at all.
      }
    }
    return {
      ...described.preview,
      role: live ? described.preview.role : null,
      state,
      chapter_id: invite.chapter_id,
      member_count: memberCount,
      sent_at: invite.created_at,
    };
  }

  /**
   * "Ask for a new link" from a dead invite (#5625): tells the invite's sender,
   * by push and in the app, who is asking and for which chapter, so they can
   * send a fresh one. Signed-in only, so the sender sees a real name. A live
   * invite needs no asking (409, use it), and neither does someone already in
   * the chapter (409). A sender who has since left the chapter is not told:
   * `notifyMembers` trusts its caller on membership, so it is checked here, and
   * the caller hears it as sent either way. The route allows a few asks an
   * hour per account (`ThrottlePersonalNudge`), because each one pushes a
   * person who never asked to hear from the caller.
   */
  async askForNewLink(token: string, userId: string): Promise<void> {
    const invite = await this.inviteRepo.findByToken(token);
    if (!invite) throw new NotFoundException('Invite not found');
    const [described, membership, asker, senderMembership] = await Promise.all([
      this.describe(invite),
      this.memberRepo.findByUserAndChapter(userId, invite.chapter_id),
      this.userRepo.findById(userId),
      this.memberRepo.findByUserAndChapter(
        invite.created_by,
        invite.chapter_id,
      ),
    ]);
    if (!described) throw new NotFoundException('Invite not found');
    if (membership) {
      throw new ConflictException({
        code: 'invite.already_member',
        message: "You're already in this chapter.",
      });
    }
    const state = linkState(invite, described, new Date());
    if (state === 'live') {
      throw new ConflictException({
        code: 'invite.still_live',
        message: 'This invite still works. Use it to join.',
      });
    }
    if (!senderMembership) return;
    const name = asker?.display_name?.trim() || 'Someone';
    const chapter = described.preview.chapter_name;
    const locked = state === 'locked';
    await this.notificationService.notifyMembers(
      invite.chapter_id,
      [invite.created_by],
      locked
        ? {
            title: `${name} tried to join with your invite`,
            body: `${chapter} isn't taking new members while its subscription is inactive. Once it's restored, the same link works.`,
            priority: 'NORMAL',
            category: 'members',
            data: { target: { screen: 'members' }, memberUserId: userId },
          }
        : {
            title: `${name} asked for a new invite`,
            body: `The link you sent them to ${chapter} no longer works. Send a new one from Invite members.`,
            priority: 'NORMAL',
            category: 'members',
            data: { target: { screen: 'members' }, memberUserId: userId },
          },
    );
  }

  /**
   * The confirm card's facts for one live invite, or null when its chapter is
   * gone. Shared by `preview` and `findPendingForVerifiedEmail`.
   */
  private async describe(invite: Invite): Promise<{
    preview: InvitePreview;
    refused: boolean;
    locked: boolean;
  } | null> {
    const [chapter, inviter, { role, refused }] = await Promise.all([
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
    const preview: InvitePreview = {
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
    return { preview, refused, locked: isSubscriptionHardLocked(chapter) };
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
    const candidates = invites.filter(
      (invite) => !joined.has(invite.chapter_id),
    );
    const described = await Promise.all(
      candidates.map(async (invite) => ({
        invite,
        described: await this.describe(invite),
      })),
    );
    // One card per chapter: the newest invite the redeem would honour wins.
    // Sending again revokes the older one (`replaceOlderInvites`), but two
    // officers can each send one, and a newer one the redeem would refuse
    // (#1830) must not hide an older one that works.
    const seen = new Set<string>();
    const rows: PendingInvite[] = [];
    for (const { invite, described: row } of described) {
      if (!row || row.refused || seen.has(invite.chapter_id)) continue;
      seen.add(invite.chapter_id);
      rows.push({ ...row.preview, token: invite.token });
    }
    return rows;
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

    // Before the claim, so a roles outage does not consume the token (#1863),
    // and a refusal leaves it for an officer to revoke.
    const { roleIds, refusal } = await this.resolveRedeemRoles(invite);
    if (refusal) throw inviteRoleOutOfReach();

    // A chapter link (#3353) is never claimed: the next person joins with it
    // too. Turning it off sets `used_at`, which `findLiveInvite` refuses.
    let claimedAt: string | null = null;
    if (!invite.reusable) {
      claimedAt = await this.inviteRepo.markUsedAtomically(invite.id);
      if (!claimedAt) throw new GoneException('Invite already used');
    }

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
      if (!membershipLanded && claimedAt) {
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

    // The name is a nicety: a failed read costs the name, not the push.
    const joiner = await this.userRepo
      .findByIds([userId])
      .then(([user]) => user)
      .catch(() => undefined);
    const name = joiner?.display_name?.trim();
    // `memberUserId` is who joined, a `users.id`, so the in-app list draws
    // their picture and their name's colour (#4346). Not `senderId`: that key
    // means a chat sender, and a block withholds rows by it. Not `memberId`,
    // which means a `members.id`.
    const data = { target: { screen: 'members' }, memberUserId: userId };
    // Whoever sent the invite hears it as theirs (#5625, Paul 2026-11-19: "not
    // the biggest fan of these DMs"). It used to arrive as a Frapp message
    // inside a DM with the new member, a conversation neither had started,
    // which the new member also found waiting as their first DM. A
    // notification is where "your invite was used" belongs; saying hi is the
    // inviter's own choice, from the member's profile.
    const inviterId = invite.created_by !== userId ? invite.created_by : null;
    const sends: Promise<void>[] = [];
    if (inviterId) {
      sends.push(
        this.notificationService.notifyMembers(invite.chapter_id, [inviterId], {
          title: inviterNoticeTitle(name, invite.reusable),
          body: 'Say hi from their profile in Members.',
          priority: 'NORMAL',
          category: 'members',
          data,
        }),
      );
    }
    // Named, and not sent to the member who just joined: "A new member has
    // joined the chapter" told everyone nothing, the joiner included
    // (notifications.md § What a push says). Sent only to the members who can
    // act on a join (#3656), on the `members` category, whose switch
    // `@repo/validation` shows to exactly this audience (#4008). Its own
    // promise, so a failed roster read never costs the inviter their notice.
    sends.push(
      (async () => {
        const holders = await this.rbac.findUserIdsWithAnyPermissions(
          invite.chapter_id,
          MEMBER_JOINED_AUDIENCE,
        );
        const recipients = holders.filter(
          (id) => id !== userId && id !== inviterId,
        );
        if (recipients.length === 0) return;
        await this.notificationService.notifyMembers(
          invite.chapter_id,
          recipients,
          {
            title: name ? `${name} joined` : 'A new member joined',
            body: 'New member of the chapter',
            priority: 'NORMAL',
            category: 'members',
            data,
          },
        );
      })(),
    );
    // Settled, not raced: each failure is reported on its own, and one never
    // hides another.
    for (const result of await Promise.allSettled(sends)) {
      if (result.status === 'rejected') {
        reportCaughtFailure(this.logger, {
          level: 'error',
          site: 'invite-redeem-new-member-notify-failed',
          message: `Failed to send the member-joined notification (chapter ${invite.chapter_id})`,
          error: result.reason,
        });
      }
    }

    return { chapterId: invite.chapter_id, memberId: member.id };
  }

  /**
   * The chapter's invites, newest first, each with its status (#3607), so
   * clients read one field rather than inferring revoked from `used_at`.
   * `created_by` and `chapter_id` stay server-side: the list is the inviter's
   * view of who was asked, not an audit of who asked. Only the invites the
   * caller could have sent are listed ({@link inviteVisibility}): each row
   * carries its link, and a lower officer never gets a higher one's.
   */
  async findByChapter(
    chapterId: string,
    viewerUserId: string,
  ): Promise<InviteListItem[]> {
    const now = new Date();
    const [invites, visible] = await Promise.all([
      this.inviteRepo.findByChapter(chapterId),
      this.inviteVisibility(chapterId, viewerUserId),
    ]);
    // The chapter link has its own place on the screen
    // (`GET /v1/invites/chapter-link`): this list is who was asked.
    return invites
      .filter((invite) => !invite.reusable && visible(invite))
      .map((invite) => toListItem(invite, now));
  }

  async revoke(id: string, chapterId: string, userId: string): Promise<void> {
    const [invite, visible] = await Promise.all([
      this.inviteRepo.findById(id),
      this.inviteVisibility(chapterId, userId),
    ]);

    // An invite ranked above the caller is not listed for them, so it is not
    // found here either (#4546).
    if (!invite || invite.chapter_id !== chapterId || !visible(invite)) {
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
 * What a joiner reads when the invite's role is out of its sender's reach
 * (#1830): the President's, or one ranked at or above the sender's roles now.
 */
const INVITE_REDEEM_REFUSAL =
  "This invite is for a role its sender can't give. Ask an officer for a new invite.";

/** The 403 preview and redeem answer for such an invite. */
function inviteRoleOutOfReach(): ForbiddenException {
  return new ForbiddenException({
    code: 'invite.role_out_of_reach',
    message: INVITE_REDEEM_REFUSAL,
  });
}

/**
 * The invite rule (`inviteRefusal`, #4071, #1830) at create: the President's
 * role never, and otherwise only a role ranked below the inviter whose
 * permissions they hold. A chapter default the inviter can't reach gives way
 * to the Everyone role before this check (`InviteService.resolveInviteRole`).
 */
function assertInviteRoleWithinReach(
  context: RankContext,
  roleName: string,
): void {
  const refusal = inviteRefusal(context, namedRole(context, roleName));
  if (refusal) throw new ForbiddenException(refusal);
}

/**
 * Refuses (400) a role name the chapter has no role for (#1830). Stored as
 * typed, it would be matched by name at redeem, so a role created later under
 * that name would capture the invite.
 */
function assertInviteRoleExists(context: RankContext, roleName: string): void {
  if (context.roles.some((candidate) => candidate.name === roleName)) return;
  throw new BadRequestException({
    code: 'invite.role_unknown',
    message: `This chapter has no role named "${roleName}".`,
  });
}

/**
 * The role an invite naming `roleName` is checked as when it is minted: the
 * role of that name, or the Everyone role when none carries it. Only a chapter
 * default can reach the fallback (`resolveInviteRole`), since a named role
 * must exist (`assertInviteRoleExists`).
 */
function namedRole(context: RankContext, roleName: string): Role | undefined {
  return (
    context.roles.find((candidate) => candidate.name === roleName) ??
    memberRoleOf(context)
  );
}

/**
 * The role an invite naming `roleName` is judged as for who may see and
 * revoke it: the role of that name, or the Everyone role when none carries
 * it or the one that does carries `*` (an invite minted before #4071). The
 * redeem refuses that last kind (`InviteService.resolveRedeemRoles`), so any
 * inviter may see and revoke it as a dead link.
 */
function redeemedRole(
  context: RankContext,
  roleName: string,
): Role | undefined {
  const named = context.roles.find((candidate) => candidate.name === roleName);
  return named && !named.permissions.includes(WILDCARD)
    ? named
    : memberRoleOf(context);
}

/**
 * Whether the caller in `context` may see, copy and revoke an invite
 * (`InviteService.inviteVisibility`): a `*` holder any, anyone else one whose
 * redeem grants a role they could invite someone into.
 */
function visibilityIn(context: RankContext): (invite: Invite) => boolean {
  if (context.reach.wildcard) return () => true;
  const visibleByRole = new Map<string, boolean>();
  return (invite) => {
    let visible = visibleByRole.get(invite.role);
    if (visible === undefined) {
      visible =
        inviteRefusal(context, redeemedRole(context, invite.role)) === null;
      visibleByRole.set(invite.role, visible);
    }
    return visible;
  };
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
