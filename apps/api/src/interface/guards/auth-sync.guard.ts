import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { AuthService } from '../../application/services/auth.service';
import { syncAppUserFromRequest } from '../auth/sync-app-user-from-request';
import type { RequestContext } from '../types/request-context.types';

/**
 * Ensures the Supabase-authenticated user has a corresponding app `users` row
 * before guards that query that table (e.g. ChapterGuard) run. Guards execute
 * before interceptors, so this cannot live in AuthSyncInterceptor alone when
 * ChapterGuard is applied at controller level.
 */
@Injectable()
export class AuthSyncGuard implements CanActivate {
  constructor(private readonly authService: AuthService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<RequestContext>();
    await syncAppUserFromRequest(this.authService, request);
    return true;
  }
}
