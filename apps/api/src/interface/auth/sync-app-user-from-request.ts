import type { AuthService } from '../../application/services/auth.service';
import type { RequestContext } from '../types/request-context.types';

export async function syncAppUserFromRequest(
  authService: AuthService,
  request: RequestContext,
): Promise<void> {
  const supabaseUser = request.supabaseUser;
  if (!supabaseUser) {
    return;
  }
  const { id } = await authService.syncUser(
    supabaseUser.id,
    supabaseUser.email ?? '',
  );
  request.appUser = { id };
}
