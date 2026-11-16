#!/usr/bin/env node

// Write a one-hour access token for the project's deployer account to a file,
// for `docker login` to Google's registry (#5228). The token is masked in the
// job's log first, and goes to a file (mode 600) rather than stdout, so the
// only thing printed is the mask command.
//
// Env inputs: CLOUD_RUN_PROVIDER, CLOUD_RUN_DEPLOYER, TOKEN_FILE.

import { writeFileSync } from "node:fs";

import { requireEnv } from "./lib/env.mjs";
import { deployerAccessToken } from "./lib/gcp.mjs";
import { isInvokedDirectly } from "./lib/invoked-directly.mjs";

async function main() {
  const token = await deployerAccessToken({
    provider: requireEnv("CLOUD_RUN_PROVIDER"),
    serviceAccount: requireEnv("CLOUD_RUN_DEPLOYER"),
  });
  console.log(`::add-mask::${token}`);
  writeFileSync(requireEnv("TOKEN_FILE"), token, { mode: 0o600 });
}

if (isInvokedDirectly(import.meta.url)) {
  main().catch((error) => {
    console.error(`::error::${error.message}`);
    process.exit(1);
  });
}
