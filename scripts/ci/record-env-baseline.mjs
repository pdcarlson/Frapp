#!/usr/bin/env node

// Record the NAMES in this step's environment, and never a value, to the file
// `VERCEL_BUILD_ENV_BASELINE` names.
//
// `deploy-vercel-staging.yml` runs this immediately before the step that
// injects Infisical `staging`. That injection exports the whole store to every
// later step in the job, and `deploy-vercel.mjs` builds each Vercel CLI
// process's environment from these names plus the project's own app keys, so
// the rest of the store never reaches a CLI process. Why that matters, and why
// a baseline rather than a denylist: the header of `lib/vercel-build-env.mjs`.
//
// Run it after the injection instead and the baseline holds the whole store.
// `infisicalBuildEnv` refuses that baseline, because it then contains an app key.

import { writeFileSync } from "node:fs";
import { requireEnv } from "./lib/env.mjs";
import { isInvokedDirectly } from "./lib/invoked-directly.mjs";
import { formatEnvBaseline } from "./lib/vercel-build-env.mjs";

if (isInvokedDirectly(import.meta.url)) {
  const file = requireEnv("VERCEL_BUILD_ENV_BASELINE");
  writeFileSync(file, formatEnvBaseline(process.env));
  console.log(`Recorded ${Object.keys(process.env).length} environment variable names (names only) to ${file}.`);
}
