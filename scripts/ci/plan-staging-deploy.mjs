#!/usr/bin/env node

// Decide whether `deploy-api.yml`'s `deploy-staging` deploys this run's commit,
// by comparing it with the commit `frapp-api-staging` is serving now (#2505).
//
// ── Why the served commit, not `HEAD~1` ─────────────────────────────────────
// Staging deploys by commit and Render no longer auto-deploys it, so a deploy
// that this job skips is one that never happens. A gate that asks "did THIS
// push change the API?" skips too much:
//   * an API commit whose own CI failed or was replaced gets no Deploy API run,
//     and the next push, if it touches no API path, diffs only itself;
//   * after a failed Render build, the next docs-only merge would skip, and the
//     Deploy API alert would close on a run that deployed nothing.
// Asking "has anything the image is built from changed since what staging
// serves?" covers all of these: the diff runs from the served commit, so it
// carries every change that has not reached staging yet.
//
// ── And why it never deploys an older commit ───────────────────────────────
// A re-run of an old run keeps its original `head_sha`. If staging already
// serves a commit that contains this one, deploying it would roll staging back
// (the deploy hook this replaced always built the tip, so re-runs were
// harmless). Such a run deploys nothing and verifies what is served instead.
//
// ── When it can't tell ─────────────────────────────────────────────────────
// It deploys. An unreadable `/health`, a commit with no `commit` field, or a
// served commit git doesn't know all mean "deploy": a redundant deploy is
// cheap, and a change that silently never ships is the #763 failure.
//
// Outputs (GITHUB_OUTPUT): `deploy` (true|false), `verify_sha` (the commit the
// next step must find served: this run's when deploying, else the served
// one), `reason`. Unit tests: `scripts/ci/__tests__/plan-staging-deploy.test.mjs`.

import { execFileSync } from "node:child_process";
import { appendFileSync } from "node:fs";

import { requireEnv } from "./lib/env.mjs";
import { resilientFetch } from "./lib/http.mjs";
import { isInvokedDirectly } from "./lib/invoked-directly.mjs";

/**
 * Everything the API image is built from: the sources `apps/api/Dockerfile`
 * COPYs, plus the root `.dockerignore` that decides what reaches it.
 * `plan-staging-deploy.test.mjs` reads the Dockerfile and fails when a COPY
 * source is not matched here, which is how four packages the image builds went
 * unmatched before #2505.
 */
export const API_IMAGE_PATHS =
  /^(apps\/api\/|packages\/(validation|org-archetypes|chapter-theme|color|formatting|observability|typescript-config)\/|package\.json$|package-lock\.json$|\.dockerignore$)/;

const SHA = /^[0-9a-f]{7,40}$/i;

/**
 * The pure decision. `isAncestor(a, b)` answers whether `a` is `b` or an
 * ancestor of it, and `changedPaths(base, head)` lists the files between two
 * commits; either may throw, which reads as "can't tell".
 */
export function planStagingDeploy({ head, served, isAncestor, changedPaths }) {
  const deploy = (reason) => ({ deploy: true, verifySha: head, reason });
  const keep = (reason) => ({ deploy: false, verifySha: served, reason });

  if (!served || !SHA.test(served)) {
    return deploy("staging's served commit could not be read, so deploying rather than guessing");
  }
  const short = (sha) => sha.slice(0, 12);
  if (served.toLowerCase() === head.toLowerCase()) {
    return keep(`staging already serves ${short(head)}`);
  }

  let headIsOlder;
  let servedIsOlder;
  try {
    headIsOlder = isAncestor(head, served);
    servedIsOlder = isAncestor(served, head);
  } catch {
    return deploy(`git could not relate ${short(served)} (served) to ${short(head)}, so deploying`);
  }

  if (headIsOlder) {
    return keep(
      `staging serves ${short(served)}, which already contains ${short(head)}; deploying ` +
        `${short(head)} would roll staging back`,
    );
  }
  if (!servedIsOlder) {
    return deploy(`staging serves ${short(served)}, which is not on this commit's history, so deploying`);
  }

  let paths;
  try {
    paths = changedPaths(served, head);
  } catch {
    return deploy(`could not diff ${short(served)}..${short(head)}, so deploying`);
  }
  const imagePaths = paths.filter((path) => API_IMAGE_PATHS.test(path));
  if (imagePaths.length > 0) {
    return deploy(
      `${imagePaths.length} file(s) the API image is built from changed since ${short(served)} ` +
        `(first: ${imagePaths[0]})`,
    );
  }
  return keep(`nothing the API image is built from changed since ${short(served)}`);
}

/** `a` is `b` or an ancestor of it. Throws when git can't answer (an unknown commit). */
export function gitIsAncestor(a, b, { exec = execFileSync } = {}) {
  try {
    exec("git", ["merge-base", "--is-ancestor", a, b], { stdio: "ignore" });
    return true;
  } catch (error) {
    if (error?.status === 1) return false;
    throw error;
  }
}

export function gitChangedPaths(base, head, { exec = execFileSync } = {}) {
  return exec("git", ["diff", "--name-only", base, head], { encoding: "utf8" })
    .split("\n")
    .filter(Boolean);
}

/** The commit `/health` reports, or null when it can't be read. `/health` answers even when degraded. */
export async function readServedCommit(healthUrl, { fetchImpl = resilientFetch } = {}) {
  try {
    const response = await fetchImpl(healthUrl, { headers: { Accept: "application/json" } });
    if (!response.ok) return null;
    const body = await response.json();
    return typeof body?.commit === "string" ? body.commit : null;
  } catch {
    return null;
  }
}

// ── CLI entry ───────────────────────────────────────────────────────────────

async function main() {
  const head = requireEnv("DEPLOY_SHA");
  const healthUrl = requireEnv("API_HEALTHCHECK_URL", {
    hint: "It comes from Infisical (docs/internal/environment/SECRETS_MANAGEMENT.md).",
  });
  const served = await readServedCommit(healthUrl);
  const plan = planStagingDeploy({
    head,
    served,
    isAncestor: (a, b) => gitIsAncestor(a, b),
    changedPaths: (base, tip) => gitChangedPaths(base, tip),
  });

  console.log(`${plan.deploy ? "Deploying" : "Not deploying"} ${head}: ${plan.reason}.`);
  if (process.env.GITHUB_OUTPUT) {
    appendFileSync(
      process.env.GITHUB_OUTPUT,
      `deploy=${plan.deploy}\nverify_sha=${plan.verifySha}\nreason=${plan.reason}\n`,
    );
  }
  if (process.env.GITHUB_STEP_SUMMARY) {
    appendFileSync(
      process.env.GITHUB_STEP_SUMMARY,
      `### Staging deploy plan\n\n${plan.deploy ? "**Deploy**" : "**No deploy**"} \`${head}\`: ${plan.reason}.\n`,
    );
  }
}

if (isInvokedDirectly(import.meta.url)) {
  main().catch((error) => {
    console.error(`Unhandled error: ${error.stack ?? error.message}`);
    process.exit(1);
  });
}
