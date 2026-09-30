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
 * Anything else (`development`, `test`, unset) is a laptop, a CI runner or the
 * e2e suite. That default is the safe direction for CORS, which then admits
 * only the local dev ports.
 */
export type DeploymentEnvironment = 'production' | 'staging' | 'local';

export function deploymentEnvironment(
  nodeEnv: string | undefined = process.env.NODE_ENV,
): DeploymentEnvironment {
  const value = nodeEnv?.trim();
  if (value === 'production') return 'production';
  if (value === 'staging') return 'staging';
  return 'local';
}
