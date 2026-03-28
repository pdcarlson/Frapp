import {
  Injectable,
  CanActivate,
  ExecutionContext,
} from '@nestjs/common';
import { AuthService } from '../../application/services/auth.service';
import type { RequestContext } from '../types/request-context.types';

@Injectable()
export class AuthSyncGuard implements CanActivate {
  constructor(private readonly authService: AuthService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<RequestContext>();
    const supabaseUser = request.supabaseUser;

    if (supabaseUser) {
      const { id } = await this.authService.syncUser(
        supabaseUser.id,
        supabaseUser.email ?? '',
      );
      request.appUser = { id };
    }

    return true;
  }
}
