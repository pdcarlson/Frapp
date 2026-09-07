import { Inject, Injectable } from '@nestjs/common';
import { USER_REPOSITORY } from '#domain/repositories/user.repository.interface';
import type { IUserRepository } from '#domain/repositories/user.repository.interface';

/** Postgres `unique_violation`, as surfaced by PostgREST. */
const UNIQUE_VIOLATION = '23505';

function isUniqueViolation(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    (error as { code?: unknown }).code === UNIQUE_VIOLATION
  );
}

@Injectable()
export class AuthService {
  constructor(
    @Inject(USER_REPOSITORY) private readonly userRepo: IUserRepository,
  ) {}

  /**
   * Ensure a `users` row exists for this Supabase Auth id.
   *
   * The interceptor that calls this runs on every authenticated request.
   * A first session therefore races: the client fires several GETs at once,
   * each `find` misses, and the losing insert raises `users_supabase_auth_id_key`
   * (production Sentry FRAPP-API-3 on GET /v1/chapters + GET /v1/analytics/identity).
   * Treat that unique violation as "the other request won" and return the row.
   */
  async syncUser(
    supabaseAuthId: string,
    email: string,
  ): Promise<{ id: string }> {
    const existing = await this.userRepo.findBySupabaseAuthId(supabaseAuthId);
    if (existing) return { id: existing.id };

    try {
      const user = await this.userRepo.create({
        supabase_auth_id: supabaseAuthId,
        email,
        display_name: email.split('@')[0],
      });
      return { id: user.id };
    } catch (error) {
      if (!isUniqueViolation(error)) throw error;
      const raced = await this.userRepo.findBySupabaseAuthId(supabaseAuthId);
      if (raced) return { id: raced.id };
      throw error;
    }
  }
}
