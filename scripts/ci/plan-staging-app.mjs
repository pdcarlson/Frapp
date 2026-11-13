#!/usr/bin/env node
// Decide which Frapp Staging binaries a "Staging app" run builds (#4917 step 3).
//
// The staging app's runtime version is `expo.version` plus a hash of its native inputs
// (`stagingRuntimeVersion` in scripts/eas-update.mjs). An update reaches only a binary of the same
// runtime, so a tree whose runtime no uploaded binary carries needs a new binary, and every other
// tree needs only the update. This script answers "does a binary of this runtime exist?" per
// platform.
//
// THE RECORD IS AN ACTIONS ARTIFACT. `eas build --local` leaves nothing on EAS's build list, and a
// commit to `main` per staging build would be a PR per native change. So the `confirm` job uploads
// a small marker artifact, `staging-app-<platform>-<runtime>`, once the store upload finished, and
// this script looks the name up. A marker lives 90 days, which is how long a TestFlight build
// does, so an expired marker means a rebuild about when the binary it stood for stops installing.
// A lost marker costs one extra build, never a wrong update: the runtime, not the marker, is what
// keeps an update away from a binary it would crash.
//
// Only a marker uploaded by a run of this repository on `main` counts. A pull request's run can
// upload an artifact of any name, and without that check one could stop staging builds.
//
// Env:
//   BUILD                — the dispatch's choice: auto, ios, android, all or none
//   RUNTIME              — `node scripts/staging-runtime.mjs`'s line for this tree
//   GITHUB_TOKEN         — reads the artifact list (`actions: read`)
//   GITHUB_REPOSITORY    — owner/name
//   GITHUB_REPOSITORY_ID — the numeric id a marker's run must carry
//   GITHUB_OUTPUT, GITHUB_STEP_SUMMARY

import { appendFileSync } from "node:fs";
import { fetchWithRetry } from "./lib/http.mjs";
import { isInvokedDirectly } from "./lib/invoked-directly.mjs";

export const PLATFORMS = ["ios", "android"];
export const CHOICES = ["auto", "ios", "android", "all", "none"];
export const RUNTIME = /^\d+\.\d+\.\d+-[0-9a-f]{12}$/;
export const MARKER_DAYS = 90;

/** The marker artifact's name for one platform's binary of one runtime. */
export const markerName = (platform, runtime) => `staging-app-${platform}-${runtime}`;

/** True when `artifact` is a live marker uploaded by this repository's own run on `main`. */
export function isTrustedMarker(artifact, repositoryId) {
  const run = artifact?.workflow_run;
  return (
    artifact?.expired === false &&
    run?.head_branch === "main" &&
    String(run?.repository_id) === String(repositoryId) &&
    String(run?.head_repository_id) === String(repositoryId)
  );
}

/** Whether a trusted marker named `name` exists. Throws when the list can't be read. */
export async function hasMarker({ name, repository, repositoryId, token, fetchImpl = fetch, sleep }) {
  const url = `https://api.github.com/repos/${repository}/actions/artifacts?name=${encodeURIComponent(name)}&per_page=100`;
  const res = await fetchWithRetry(
    url,
    { headers: { Authorization: `Bearer ${token}`, Accept: "application/vnd.github+json", "X-GitHub-Api-Version": "2022-11-28" } },
    { fetchImpl, sleep },
  );
  if (!res.ok) throw new Error(`GitHub answered ${res.status} for the artifact list`);
  const body = await res.json();
  return (body.artifacts ?? []).some((a) => a.name === name && isTrustedMarker(a, repositoryId));
}

/**
 * `{ ios, android, reasons }`: which platforms to build and why. `exists(platform)` answers
 * whether a binary of this runtime was uploaded; it is asked only under `auto`.
 */
export async function plan({ choice, exists }) {
  const out = { reasons: {} };
  for (const platform of PLATFORMS) {
    if (choice === "none") {
      out[platform] = false;
      out.reasons[platform] = "not built: the run asked for no build";
    } else if (choice === "all" || choice === platform) {
      out[platform] = true;
      out.reasons[platform] = "built: the run asked for it";
    } else if (choice === "auto") {
      const found = await exists(platform);
      out[platform] = !found;
      out.reasons[platform] = found
        ? "not built: a binary of this runtime is already uploaded, so the update reaches it"
        : "built: no uploaded binary carries this runtime";
    } else {
      out[platform] = false;
      out.reasons[platform] = "not built: the run asked for the other platform";
    }
  }
  return out;
}

export async function main({ env, fetchImpl = fetch, sleep, write = appendFileSync, log = console.log }) {
  const choice = env.BUILD ?? "";
  const runtime = (env.RUNTIME ?? "").trim();
  if (!CHOICES.includes(choice)) {
    log(`::error::build must be one of ${CHOICES.join(", ")}; got '${choice}'.`);
    return 1;
  }
  if (!RUNTIME.test(runtime)) {
    log(`::error::'${runtime}' is not a staging runtime (version, a dash, twelve hex digits).`);
    return 1;
  }
  let result;
  try {
    result = await plan({
      choice,
      exists: (platform) =>
        hasMarker({
          name: markerName(platform, runtime),
          repository: env.GITHUB_REPOSITORY,
          repositoryId: env.GITHUB_REPOSITORY_ID,
          token: env.GITHUB_TOKEN,
          fetchImpl,
          sleep,
        }),
    });
  } catch (error) {
    log(`::error::Couldn't tell whether a binary of ${runtime} exists: ${error.message}. Run it again, or choose the platform to build.`);
    return 1;
  }
  if (env.GITHUB_OUTPUT) {
    write(env.GITHUB_OUTPUT, `runtime=${runtime}\nios=${result.ios}\nandroid=${result.android}\n`);
  }
  const lines = [`### Frapp Staging, runtime \`${runtime}\``, ""];
  for (const platform of PLATFORMS) lines.push(`- ${platform === "ios" ? "iOS" : "Android"}: ${result.reasons[platform]}.`);
  lines.push("");
  if (env.GITHUB_STEP_SUMMARY) write(env.GITHUB_STEP_SUMMARY, `${lines.join("\n")}\n`);
  else log(lines.join("\n"));
  return 0;
}

if (isInvokedDirectly(import.meta.url)) {
  process.exitCode = await main({ env: process.env });
}
