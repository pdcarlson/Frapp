import { Inject, Injectable } from '@nestjs/common';
import { isAuthApiError } from '@supabase/supabase-js';
import { SUPABASE_CLIENT } from './supabase.provider';
import type { IAuthAdminProvider } from '../../domain/adapters/auth-admin.interface';
import type { FrappSupabaseClient } from './database.types';

@Injectable()
export class SupabaseAuthAdminService implements IAuthAdminProvider {
  constructor(
    @Inject(SUPABASE_CLIENT) private readonly supabase: FrappSupabaseClient,
  ) {}

  async deleteAuthUser(supabaseAuthId: string): Promise<void> {
    const { error } = await this.supabase.auth.admin.deleteUser(supabaseAuthId);
    if (!error) return;

    // Idempotency: a retried account-deletion run reaches here after the auth
    // account was already removed. GoTrue reports that as user_not_found /
    // 404 — treat it as success so the retry can complete the rest of the
    // flow instead of failing forever.
    if (
      isAuthApiError(error) &&
      (error.status === 404 || error.code === 'user_not_found')
    ) {
      return;
    }

    throw error;
  }
}
