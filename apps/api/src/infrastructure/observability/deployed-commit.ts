/**
 * The git SHA Render injects on every deploy (`RENDER_GIT_COMMIT`).
 *
 * This is a platform env, not an Infisical secret — do not add a `GIT_SHA`
 * slug to invent a second home. Local and CI leave it unset, so `/health`
 * omits `commit` rather than guessing. Sentry `release` and source-map upload
 * use the same helper so classic map matching agrees with the event envelope.
 */
export const RENDER_GIT_COMMIT_ENV = 'RENDER_GIT_COMMIT';

const GIT_SHA_PATTERN = /^[0-9a-f]{7,40}$/i;

export function readDeployedCommit(
  env: NodeJS.Dict<string | undefined> = process.env,
): string | undefined {
  const raw = env[RENDER_GIT_COMMIT_ENV];
  if (typeof raw !== 'string') {
    return undefined;
  }
  const trimmed = raw.trim();
  return GIT_SHA_PATTERN.test(trimmed) ? trimmed : undefined;
}
