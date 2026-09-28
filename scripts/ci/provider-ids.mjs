#!/usr/bin/env node

// Write one environment's provider ids to `$GITHUB_OUTPUT`, for the workflow
// steps that deploy to or assert against Render and Vercel (#2806).
//
// The ids live in `.github/environments.json`, next to the Supabase project
// refs, and nowhere else: workflows used to carry them as literals in several
// files, with comments asking humans to keep the copies in step. A step runs
// this with `TARGET_ENVIRONMENT` (`staging` or `production`) and the steps
// after it read `${{ steps.<id>.outputs.render_service_id }}` and the rest.
// `_deploy.yml` runs it at the trusted ref, so a rollback to an older commit
// still deploys to the services the config names today.
//
// Not secrets: an id grants nothing without RENDER_API_KEY or VERCEL_API_KEY.
// The values are printed so a run log says which services it touched.
//
// Env inputs:
//   TARGET_ENVIRONMENT — required; staging or production
//   GITHUB_OUTPUT      — required; the step's output file
//
// Unit tests: `scripts/ci/__tests__/provider-ids.test.mjs`.

import { appendFileSync } from "node:fs";

import { providerIdsFor } from "./lib/environments.mjs";
import { requireEnv } from "./lib/env.mjs";
import { isInvokedDirectly } from "./lib/invoked-directly.mjs";

/** Step output name for each id, in the order they are written. */
export const PROVIDER_ID_OUTPUTS = [
  ["renderServiceId", "render_service_id"],
  ["vercelTeamId", "vercel_team_id"],
  ["vercelWebProjectId", "vercel_web_project_id"],
  ["vercelLandingProjectId", "vercel_landing_project_id"],
];

/** `name=value` lines for `$GITHUB_OUTPUT`. */
export function formatProviderOutputs(ids) {
  return PROVIDER_ID_OUTPUTS.map(([key, output]) => `${output}=${ids[key]}\n`).join("");
}

function main() {
  const environment = requireEnv("TARGET_ENVIRONMENT");
  const outputFile = requireEnv("GITHUB_OUTPUT");
  const ids = providerIdsFor(environment);
  const lines = formatProviderOutputs(ids);
  console.log(`Provider ids for ${environment}, from .github/environments.json:\n${lines.trimEnd()}`);
  appendFileSync(outputFile, lines);
}

if (isInvokedDirectly(import.meta.url)) {
  try {
    main();
  } catch (error) {
    console.error(`::error::${error.message}`);
    process.exit(1);
  }
}
