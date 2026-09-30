import { isProductionSupabaseUrl } from '@repo/validation';

/**
 * Which deployment this process is, for the request-edge settings that differ
 * per host: the browser origins CORS admits (`cors.options.ts`) and the proxy
 * hop count Express trusts (`bootstrap.ts`).
 *
 * Keyed on `NODE_ENV`, which each Render service sets: `production` on
 * `frapp-api-prod` and `staging` on `frapp-api-staging`. Those two values are
 * read back from the deployed processes, not only from `render.yaml`: the
 * `frapp-api` spans in Sentry carry exactly those two `environment` values, and
 * that field is `NODE_ENV` (`sentry-options.ts`), checked 2026-09-30 (#2507).
 *
 * A process whose `SUPABASE_URL` is the production project is production
 * whatever `NODE_ENV` says. That is the fence the API already uses for
 * production (`env.validation.ts`), and it keeps a misset `NODE_ENV` on
 * `frapp-api-prod` from quietly giving it a laptop's settings: the
 * over-trusting hop count that #2972 fixed, and no tripwire to report it.
 *
 * Anything else (`development`, `test`, unset) is a laptop, a CI runner or the
 * e2e suite. That default is the safe direction for CORS, which then admits
 * only the local dev ports.
 */
export type DeploymentEnvironment = 'production' | 'staging' | 'local';

export function deploymentEnvironment(
  env: { NODE_ENV?: string; SUPABASE_URL?: string } = process.env,
): DeploymentEnvironment {
  const nodeEnv = env.NODE_ENV?.trim();
  if (nodeEnv === 'production') return 'production';
  if (env.SUPABASE_URL && isProductionSupabaseUrl(env.SUPABASE_URL)) {
    return 'production';
  }
  if (nodeEnv === 'staging') return 'staging';
  return 'local';
}
