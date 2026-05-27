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
} from '../decorators/subscription.decorator';
import type { SubscriptionStatus } from '../../domain/entities/chapter.entity';

const READ_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

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
      .select('subscription_status')
      .eq('id', chapterId)
      .single<{ subscription_status: SubscriptionStatus }>();

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
    );

    return true;
  }

  private enforceSubscription(
    context: ExecutionContext,
    method: string,
    status: SubscriptionStatus,
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
    if (isFreeTier) return;

    if (status === 'past_due') {
      throw new ForbiddenException({
        code: 'chapter.subscription.write_locked',
        message:
          'Chapter subscription is past due; write actions are blocked until payment is resolved.',
      });
    }

    if (status === 'incomplete') {
      throw new ForbiddenException({
        code: 'chapter.subscription.required',
        message:
          'Chapter subscription is not active; complete checkout to use this feature.',
      });
    }
  }
}
