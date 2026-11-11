import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import type { Request } from 'express';
import { DevLogService } from '../../application/services/dev-log.service';

/**
 * The Dev log route's only credential (#4145): a bearer token whose SHA-256
 * this deployment was configured with. It is not a Supabase JWT and names no
 * user; holding it allows one thing, a Dev log post into the configured
 * channel. 404 while the feature is off, 401 otherwise
 * (`DevLogService.assertToken`).
 */
@Injectable()
export class DevLogTokenGuard implements CanActivate {
  constructor(private readonly devLog: DevLogService) {}

  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<Request>();
    const header = request.headers.authorization;
    const match =
      typeof header === 'string' ? /^Bearer (\S+)$/.exec(header) : null;
    this.devLog.assertToken(match?.[1]);
    return true;
  }
}
