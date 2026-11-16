/**
 * The image's entry point (`apps/api/Dockerfile` `CMD`). It fills the env from
 * Infisical when the service holds an Infisical machine identity, then loads
 * `main`. A separate file because `main.ts`'s imports run before its body:
 * Sentry reads its DSN when `instrument.ts` loads, so the values have to be
 * in `process.env` before `main` is even imported. Without the identity
 * (local, CI, a git-backed service) it goes straight to `main`.
 * Why and how: infrastructure/secrets/infisical-boot-secrets.ts.
 */
import { toReportableError } from './infrastructure/observability/reportable-error';
import { loadBootSecrets } from './infrastructure/secrets/infisical-boot-secrets';

async function boot(): Promise<void> {
  try {
    await loadBootSecrets(process.env);
  } catch (error) {
    // caught-failure-exempt: Sentry isn't loaded yet (main.ts loads it) and the process exits; Nest's Logger would load @nestjs/common ahead of Sentry
    console.error(
      `API not started: could not load its config from Infisical: ${toReportableError(error).message}`,
    );
    process.exit(1);
  }
  // Outside the catch: a failure inside `main` is its own, and `main` reports it.
  await import('./main.js');
}

void boot();
