import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Inject,
  Injectable,
} from '@nestjs/common';
import { SupabaseClient } from '@supabase/supabase-js';
import { SUPABASE_CLIENT } from '../../infrastructure/supabase/supabase.provider';
import { RequestContext, getHeaderValue } from '../types/request-context.types';

@Injectable()
export class ChapterGuard implements CanActivate {
  constructor(
    @Inject(SUPABASE_CLIENT) private readonly supabase: SupabaseClient,
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

    request.appUser = appUser;
    request.member = member;
    request.chapterId = chapterId;

    return true;
  }
}
