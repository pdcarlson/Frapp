import type { User as SupabaseAuthUser } from '@supabase/supabase-js';

/**
 * How the caller signed in, as a closed set for analytics: the provider
 * Supabase Auth recorded for the session's user (`app_metadata.provider`).
 * A magic link and a password are both `email`. Anything else (a provider
 * added later) is `other`, and no user at all is `null`.
 */
export const SIGN_IN_METHODS = ['apple', 'google', 'email', 'other'] as const;
export type SignInMethod = (typeof SIGN_IN_METHODS)[number];

export function signInMethodOf(
  user: Pick<SupabaseAuthUser, 'app_metadata'> | undefined,
): SignInMethod | null {
  if (!user) return null;
  const provider: unknown = user.app_metadata?.provider;
  if (provider === 'apple' || provider === 'google' || provider === 'email') {
    return provider;
  }
  return 'other';
}
