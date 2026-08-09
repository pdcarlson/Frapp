import {
  BadRequestException,
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Inject,
  Injectable,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { SupabaseClient } from '@supabase/supabase-js';
import { SUPABASE_CLIENT } from '../../infrastructure/supabase/supabase.provider';
import {
  MemberContext,
  RequestContext,
  getActiveChapterClaim,
  getHeaderValue,
} from '../types/request-context.types';
import {
  SUBSCRIPTION_EXEMPT_KEY,
  SUBSCRIPTION_FREE_TIER_KEY,
  SUBSCRIPTION_GRACE_BLOCKED_KEY,
} from '../decorators/subscription.decorator';
import { REQUIRED_MODULE_KEY } from '../decorators/module.decorator';
import { isModuleEnabled } from '@repo/validation';
import type { SubscriptionStatus } from '../../domain/entities/chapter.entity';

const READ_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

// FRA-109: a chapter that lapses to `past_due` gets a 3-day grace window
// (spec/behavior/billing.md, spec/product/onboarding.md) before the hard
// read-only lock applies.
const GRACE_PERIOD_MS = 3 * 24 * 60 * 60 * 1000;

@Injectable()
export class ChapterGuard implements CanActivate {
  constructor(
    @Inject(SUPABASE_CLIENT) private readonly supabase: SupabaseClient,
    private readonly reflector: Reflector,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<RequestContext>();

    const supabaseUser = request.supabaseUser;
    if (!supabaseUser) {
      throw new ForbiddenException(
        'Authentication required before chapter check',
      );
    }

    // Resolved before the chapter context, because auto-resolving a
    // single-chapter user requires knowing which memberships they hold.
    const { data: appUser } = await this.supabase
      .from('users')
      .select('id')
      .eq('supabase_auth_id', supabaseUser.id)
      .single<{ id: string }>();

    if (!appUser) {
      throw new ForbiddenException('User profile not found');
    }

    const resolved = await this.resolveChapterContext(request, appUser.id);
    const chapterId = resolved.chapterId;

    // The auto-resolve path already read the membership row it selected the
    // chapter from; only an explicitly supplied chapter needs verifying.
    const member =
      resolved.member ?? (await this.findMembership(appUser.id, chapterId));

    if (!member) {
      throw new ForbiddenException({
        code: 'chapter.context.invalid',
        message: 'You are not a member of the requested chapter.',
      });
    }

    const { data: chapter } = await this.supabase
      .from('chapters')
      .select('subscription_status, past_due_since, enabled_modules')
      .eq('id', chapterId)
      .single<{
        subscription_status: SubscriptionStatus;
        past_due_since: string | null;
        enabled_modules: Record<string, boolean> | null;
      }>();

    if (!chapter) {
      throw new ForbiddenException('Chapter not found');
    }

    request.appUser = appUser;
    request.member = member;
    request.chapterId = chapterId;
    request.subscriptionStatus = chapter.subscription_status;

    this.enforceSubscription(
      context,
      request.method,
      chapter.subscription_status,
      chapter.past_due_since,
    );

    // After the subscription check: a lapsed chapter's billing state is the
    // more actionable error, and a module toggle is meaningless while every
    // write is already locked.
    this.enforceModule(context, request.method, chapter.enabled_modules);

    return true;
  }

  /**
   * Resolves the active chapter per spec/behavior/multi-tenancy.md:
   *
   * 1. The JWT `active_chapter_id` claim is authoritative.
   * 2. `x-chapter-id` is a fallback for clients that have not refreshed their
   *    token since the claim was introduced.
   * 3. Both present and disagreeing is a hard `403 chapter.context.mismatch` —
   *    the header never overrides the JWT.
   * 4. Neither present: a single-chapter user is auto-resolved server-side;
   *    anyone else gets `400 chapter.context.required`.
   */
  private async resolveChapterContext(
    request: RequestContext,
    appUserId: string,
  ): Promise<{ chapterId: string; member?: MemberContext }> {
    const jwtChapterId = getActiveChapterClaim(request.jwtClaims);
    const headerChapterId = getHeaderValue(request.headers, 'x-chapter-id');

    if (jwtChapterId && headerChapterId && jwtChapterId !== headerChapterId) {
      throw new ForbiddenException({
        code: 'chapter.context.mismatch',
        message:
          'The x-chapter-id header disagrees with the active chapter in your token.',
      });
    }

    const explicit = jwtChapterId ?? headerChapterId;
    if (explicit) {
      return { chapterId: explicit };
    }

    // Two rows is all it takes to tell "exactly one" from "more than one".
    const { data: memberships } = await this.supabase
      .from('members')
      .select('id, role_ids, custom_role_ids, chapter_id')
      .eq('user_id', appUserId)
      .limit(2);

    if (memberships?.length === 1) {
      const sole = memberships[0] as MemberContext & { chapter_id: string };
      return { chapterId: sole.chapter_id, member: sole };
    }

    throw new BadRequestException({
      code: 'chapter.context.required',
      message:
        'Active chapter context is required. Send the x-chapter-id header or refresh your session after selecting a chapter.',
    });
  }

  private async findMembership(
    appUserId: string,
    chapterId: string,
  ): Promise<MemberContext | null> {
    const { data } = await this.supabase
      .from('members')
      .select('id, role_ids, custom_role_ids')
      .eq('user_id', appUserId)
      .eq('chapter_id', chapterId)
      .single();

    return data ?? null;
  }

  /** Overridable seam so tests can pin "now" without real clocks. */
  protected currentTime(): number {
    return Date.now();
  }

  /**
   * A `past_due` chapter is within its 3-day grace window when less than
   * GRACE_PERIOD_MS has elapsed since it lapsed. A null timestamp (legacy row,
   * or a missed webhook) is treated as within grace — the safer default that
   * preserves access rather than instantly hard-locking a lapsed-but-paying
   * chapter; the next webhook re-establishes the clock.
   */
  private isWithinGrace(pastDueSince: string | null): boolean {
    if (!pastDueSince) return true;
    const lapsedAt = Date.parse(pastDueSince);
    if (Number.isNaN(lapsedAt)) return true;
    return this.currentTime() - lapsedAt <= GRACE_PERIOD_MS;
  }

  private enforceSubscription(
    context: ExecutionContext,
    method: string,
    status: SubscriptionStatus,
    pastDueSince: string | null,
  ): void {
    const isExempt = this.reflector.getAllAndOverride<boolean>(
      SUBSCRIPTION_EXEMPT_KEY,
      [context.getHandler(), context.getClass()],
    );
    if (isExempt) return;

    if (READ_METHODS.has(method.toUpperCase())) return;

    if (status === 'canceled') {
      throw new ForbiddenException({
        code: 'chapter.subscription.canceled',
        message: 'Chapter subscription is canceled; this chapter is read-only.',
      });
    }

    if (status === 'active') return;

    const isFreeTier = this.reflector.getAllAndOverride<boolean>(
      SUBSCRIPTION_FREE_TIER_KEY,
      [context.getHandler(), context.getClass()],
    );

    // past_due: grace-aware. Evaluate the window before consulting free-tier so
    // invite/create stays blocked during grace and ALL writes stop after it.
    if (status === 'past_due') {
      if (this.isWithinGrace(pastDueSince)) {
        const isGraceBlocked = this.reflector.getAllAndOverride<boolean>(
          SUBSCRIPTION_GRACE_BLOCKED_KEY,
          [context.getHandler(), context.getClass()],
        );
        // @GraceBlocked only carves invite/create out of the free-tier wedge.
        // On a non-free-tier (paid-ops) route it is meaningless — that route is
        // already write_locked below — so only emit invite_blocked for a
        // free-tier route to avoid a misleading code on a misconfigured handler.
        if (isGraceBlocked && isFreeTier) {
          throw new ForbiddenException({
            code: 'chapter.subscription.invite_blocked',
            message:
              'Chapter subscription is past due; new invites are blocked until payment is resolved.',
          });
        }
        if (isFreeTier) return;
      }

      // Paid-ops writes during grace, and every write after grace, are blocked.
      throw new ForbiddenException({
        code: 'chapter.subscription.write_locked',
        message:
          'Chapter subscription is past due; write actions are blocked until payment is resolved.',
      });
    }

    if (isFreeTier) return;

    if (status === 'incomplete') {
      throw new ForbiddenException({
        code: 'chapter.subscription.required',
        message:
          'Chapter subscription is not active; complete checkout to use this feature.',
      });
    }
  }

  /**
   * Server-side half of the module gate (#264). The web client hides disabled
   * modules from the sidebar, the Cmd+K menu, and the slash-command palette,
   * but a direct API call bypasses all three — so the write is rejected here
   * regardless of client.
   *
   * Two deliberate asymmetries with `enforceSubscription`:
   *
   * - **Writes only.** `spec/product/modules.md` promises "Data is preserved —
   *   re-enabling restores access", so reads of a disabled module's data keep
   *   working; the toggle freezes a surface, it does not strand data.
   * - **Enabled unless explicitly `false`**, via the shared `isModuleEnabled`
   *   predicate in `@repo/validation` — the same one the web surfaces use, so
   *   the client's idea of "off" cannot drift from the server's.
   */
  private enforceModule(
    context: ExecutionContext,
    method: string,
    enabledModules: Record<string, boolean> | null,
  ): void {
    if (READ_METHODS.has(method.toUpperCase())) return;

    const moduleKey = this.reflector.getAllAndOverride<string | undefined>(
      REQUIRED_MODULE_KEY,
      [context.getHandler(), context.getClass()],
    );
    if (!moduleKey) return;

    if (!isModuleEnabled(enabledModules, moduleKey)) {
      throw new ForbiddenException({
        code: 'chapter.module.disabled',
        message: `The "${moduleKey}" module is disabled for this chapter. Re-enable it in Settings → Modules to make changes.`,
      });
    }
  }
}
