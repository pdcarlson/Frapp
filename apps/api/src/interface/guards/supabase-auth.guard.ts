import {
  CanActivate,
  ExecutionContext,
  Inject,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import type { JwtPayload, UserResponse } from '@supabase/supabase-js';
import { SUPABASE_CLIENT } from '../../infrastructure/supabase/supabase.provider';
import { RequestContext, getHeaderValue } from '../types/request-context.types';
import type { FrappSupabaseClient } from '../../infrastructure/supabase/database.types';
import {
  InFlightLookups,
  isAuthOutage,
  lookupUnavailable,
} from './guard-lookup';

/**
 * One process-wide map, not one per guard instance: Nest builds a guard per
 * module, and a resume burst spans several modules' routes (#3728).
 */
const userLookups = new InFlightLookups<UserResponse>();

@Injectable()
export class SupabaseAuthGuard implements CanActivate {
  constructor(
    @Inject(SUPABASE_CLIENT) private readonly supabase: FrappSupabaseClient,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<RequestContext>();
    const authHeader = getHeaderValue(request.headers, 'authorization');

    if (!authHeader?.startsWith('Bearer ')) {
      throw new UnauthorizedException(
        'Missing or invalid authorization header',
      );
    }

    const token = authHeader.slice(7);

    // Requests sharing a token in the same instant share one Auth round
    // trip (`InFlightLookups`); nothing outlives the call, so a revoked
    // session is still refused by the next request that starts after it.
    const { data, error } = await userLookups.run(token, () =>
      this.supabase.auth.getUser(token),
    );

    // An Auth outage is not a verdict on the token (#3143): `isAuthOutage`.
    if (error && isAuthOutage(error)) {
      throw lookupUnavailable('Could not verify your session right now', error);
    }
    if (error || !data.user) {
      throw new UnauthorizedException('Invalid or expired token');
    }

    request.supabaseUser = structuredClone(data.user);
    request.jwtClaims = await this.readClaims(token);
    return true;
  }

  /**
   * `getUser()` returns the *database* user record, so it never carries claims
   * added by `custom_access_token_hook` — the active chapter has to be read off
   * the token itself. `getClaims()` verifies locally against the project JWKS
   * (cached), which also covers the asymmetric ES256 keys Supabase now issues by
   * default; `SUPABASE_JWT_SECRET` would not verify those.
   *
   * Failure is deliberately non-fatal: `getUser()` above has already
   * authenticated the request, so a JWKS hiccup or a token predating the hook
   * should degrade to the `x-chapter-id` fallback that
   * spec/behavior/multi-tenancy.md sanctions, not reject a valid caller.
   */
  private async readClaims(token: string): Promise<JwtPayload | undefined> {
    try {
      const { data, error } = await this.supabase.auth.getClaims(token);
      return error ? undefined : (data?.claims ?? undefined);
    } catch {
      return undefined;
    }
  }
}
