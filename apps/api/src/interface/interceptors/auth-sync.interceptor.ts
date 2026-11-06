import {
  Injectable,
  NestInterceptor,
  ExecutionContext,
  CallHandler,
} from '@nestjs/common';
import { Observable } from 'rxjs';
import { tap } from 'rxjs/operators';
import { AuthService } from '../../application/services/auth.service';
import { TimeZoneSyncService } from '../../application/services/time-zone-sync.service';
import { TIME_ZONE_HEADER } from '#domain/constants/time-zone-header';
import type { RequestContext } from '../types/request-context.types';

@Injectable()
export class AuthSyncInterceptor implements NestInterceptor {
  constructor(
    private readonly authService: AuthService,
    private readonly timeZones: TimeZoneSyncService,
  ) {}

  async intercept(
    context: ExecutionContext,
    next: CallHandler,
  ): Promise<Observable<unknown>> {
    const request = context.switchToHttp().getRequest<RequestContext>();
    const supabaseUser = request.supabaseUser;

    if (supabaseUser) {
      const { id } = await this.authService.syncUser(
        supabaseUser.id,
        supabaseUser.email ?? '',
        supabaseUser.user_metadata,
      );
      request.appUser = { id };
      // Fire-and-forget: pushes name times in this zone, and the request
      // never waits on recording it.
      this.timeZones.record(id, request.headers?.[TIME_ZONE_HEADER]);
    }

    return next.handle().pipe(tap());
  }
}
