import {
  Injectable,
  NestInterceptor,
  ExecutionContext,
  CallHandler,
} from '@nestjs/common';
import { Observable } from 'rxjs';
import { tap } from 'rxjs/operators';
import { AuthService } from '../../application/services/auth.service';

@Injectable()
export class AuthSyncInterceptor implements NestInterceptor {
  constructor(private readonly authService: AuthService) {}

  async intercept(
    context: ExecutionContext,
    next: CallHandler,
  ): Promise<Observable<unknown>> {
    const request = context.switchToHttp().getRequest();
    const supabaseUser = request.supabaseUser;

    if (supabaseUser) {
      const { id } = await this.authService.syncUser(
        supabaseUser.id,
        supabaseUser.email ?? '',
      );
      request.appUser = { id };
    }

    return next.handle().pipe(tap());
  }
}
