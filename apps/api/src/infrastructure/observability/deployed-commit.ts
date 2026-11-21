/**
 * The deployed git SHA, `RENDER_GIT_COMMIT`: the deploy job's image build
 * stamps it into the image (`apps/api/Dockerfile`'s runner stage, #2506), and
 * the Cloud Run deploy sets it on each revision too (#5228). The name is
 * Render's, which injected it until the API left Render.
 *
 * This is a platform env, not an Infisical secret — do not add a `GIT_SHA`
 * slug to invent a second home. Local and CI leave it unset, so `/health`
 * omits `commit` rather than guessing. Sentry `release` and source-map upload
 * use the same helper so classic map matching agrees with the event envelope.
 */
const RENDER_GIT_COMMIT_ENV = 'RENDER_GIT_COMMIT';

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
