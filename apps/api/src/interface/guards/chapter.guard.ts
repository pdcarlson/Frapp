import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Inject,
  Injectable,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { SupabaseClient } from '@supabase/supabase-js';
import { SUPABASE_CLIENT } from '../../infrastructure/supabase/supabase.provider';
import { RequestContext, getHeaderValue } from '../types/request-context.types';
import {
  SUBSCRIPTION_EXEMPT_KEY,
  SUBSCRIPTION_FREE_TIER_KEY,
  SUBSCRIPTION_GRACE_BLOCKED_KEY,
} from '../decorators/subscription.decorator';
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
    const chapterId = getHeaderValue(request.headers, 'x-chapter-id');

    if (!chapterId) {
      throw new ForbiddenException('Missing x-chapter-id header');
    }

    const supabaseUser = request.supabaseUser;
    if (!supabaseUser) {
      throw new ForbiddenException(
        'Authentication required before chapter check',
      );
    }

    const { data: appUser } = await this.supabase
      .from('users')
      .select('id')
      .eq('supabase_auth_id', supabaseUser.id)
      .single();

    if (!appUser) {
      throw new ForbiddenException('User profile not found');
    }

    const { data: member } = await this.supabase
      .from('members')
      .select('id, role_ids')
      .eq('user_id', appUser.id)
      .eq('chapter_id', chapterId)
      .single();

    if (!member) {
      throw new ForbiddenException('Not a member of this chapter');
    }

    const { data: chapter } = await this.supabase
      .from('chapters')
      .select('subscription_status, past_due_since')
      .eq('id', chapterId)
      .single<{
        subscription_status: SubscriptionStatus;
        past_due_since: string | null;
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

    return true;
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
}
