import {
  Injectable,
  NestInterceptor,
  ExecutionContext,
  CallHandler,
} from '@nestjs/common';
import { Observable } from 'rxjs';
import { tap } from 'rxjs/operators';
import { AuthService } from '../../application/services/auth.service';
import { syncAppUserFromRequest } from '../auth/sync-app-user-from-request';
import type { RequestContext } from '../types/request-context.types';

@Injectable()
export class AuthSyncInterceptor implements NestInterceptor {
  constructor(private readonly authService: AuthService) {}

  async intercept(
    context: ExecutionContext,
    next: CallHandler,
  ): Promise<Observable<unknown>> {
    const request = context.switchToHttp().getRequest<RequestContext>();
    await syncAppUserFromRequest(this.authService, request);
    return next.handle().pipe(tap());
  }
}
