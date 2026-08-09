// Jest `globalSetup` for the integration suite: decide once, before any worker
// starts, whether a live Supabase stack is reachable.
//
// Doing this here rather than in each spec is what makes a clean skip possible.
// `globalSetup` runs in the parent process before workers are forked, and the
// workers inherit `process.env`, so the answer travels to every spec as a plain
// env var that `describeIntegration` can read synchronously at module load.

import { loadLocalEnv, probeStack, STACK_ENV_FLAG } from './stack';

export default async function globalSetup(): Promise<void> {
  loadLocalEnv();
  const available = await probeStack();
  process.env[STACK_ENV_FLAG] = available ? 'up' : 'down';

  if (!available) {
    // Loud enough to explain an all-skipped run, quiet enough not to look like
    // a failure. A developer who expected these to run needs to know why they
    // didn't; CI without a stack should read as "not applicable", not "broken".
    console.warn(
      '\n[integration] No local Supabase stack reachable — report query ' +
        'integration specs will be SKIPPED.\n' +
        '[integration] Bring one up with `scripts/cloud-sandbox-up.sh` (cloud ' +
        'session) or `scripts/local-dev-setup.sh` (laptop), then re-run.\n' +
        '[integration] See docs/internal/environment/CLOUD_SANDBOX.md.\n',
    );
  }
}
