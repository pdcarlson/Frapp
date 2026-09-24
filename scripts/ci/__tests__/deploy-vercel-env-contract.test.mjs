// Every workflow step that runs `scripts/ci/deploy-vercel.mjs` must supply the
// environment that script's phase requires.
//
// ── Why this file exists rather than one more assertion in the fence test ───
// `deploy-vercel.mjs` is invoked from TWO workflows — `deploy-production.yml`
// (twice: a `build` phase and an `upload` phase) and `deploy-vercel-staging.yml`
// (once, phase unset) — so the contract is not a property of either file. The
// guard that came out of #2265 lived in `deploy-production-fence.test.mjs` and
// was production-only and `DEPLOY_SHA`-only; the same class of bug in the
// staging caller had nothing looking at it at all.
//
// ── The bug class ──────────────────────────────────────────────────────────
// Run 34892839657: the Vercel BUILD step had never carried `DEPLOY_SHA`, and
// `requireEnv("DEPLOY_SHA")` killed the run AFTER the reviewer approval, the
// `npm ci` and the Vercel CLI install. Three things had to line up for that to
// stay invisible for the step's whole life, and this file closes all three:
//
//   1. The guard matched the token ANYWHERE in the workflow file, so the upload
//      step's copy kept it green. #2265 fixed that one by scoping to the call
//      site. Here every assertion is scoped to a call site by construction.
//   2. The guard named ONE variable. The other five were unguarded, and
//      `VERCEL_BUILD_STASH_DIR` — required by exactly the two phases that have
//      one — was never asserted anywhere. The required set is now read from
//      `requiredEnvFor`, the same table `main()` reads, so a `requireEnv`
//      added to the script tightens this guard in the same commit. It is keyed
//      on the target as well as the phase since #2672: a staging call site
//      also needs `VERCEL_BUILD_ENV_BASELINE`, and a production one does not.
//   3. No rehearsal reached the step, because the dry run skipped it by `if:`.
//      That half is fixed in the workflow, not here.
//
// ── Why the env lookup walks three scopes ──────────────────────────────────
// A per-step guard that only reads the step's own `env:` block would be wrong,
// not merely strict. `deploy-vercel-staging.yml` supplies
// `VERCEL_WEB_PROJECT_ID`, `VERCEL_LANDING_PROJECT_ID` and `VERCEL_TEAM_ID`
// from a JOB-level `env:`, and `deploy-production.yml` declares the same three
// at WORKFLOW level. Both are correct and both are how Actions resolves
// `env` — workflow, then job, then step, innermost winning. A guard that
// ignored the outer two would fail the staging caller for a bug it does not
// have, and the fix for a false failure is usually to delete the guard.

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { workflowSteps } from "./helpers/workflow-yaml.mjs";

import {
  DEPLOY_PHASE_ALL,
  DEPLOY_PHASE_BUILD,
  DEPLOY_PHASE_UPLOAD,
  REQUIRED_ENV_ALWAYS,
  parseDeployPhase,
  parseDeployTarget,
  requiredEnvFor,
} from "../deploy-vercel.mjs";
import { VERCEL_TARGET_PREVIEW, VERCEL_TARGET_PRODUCTION } from "../lib/vercel-cli.mjs";

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const WORKFLOW_DIR = join(REPO_ROOT, ".github", "workflows");
const SCRIPT = "scripts/ci/deploy-vercel.mjs";

/**
 * Every step across every workflow whose `run:` invokes `script`, with the env
 * Actions would give it and the DEPLOY_PHASE and DEPLOY_TARGET it runs with.
 */
function allCallSites(script) {
  return readdirSync(WORKFLOW_DIR)
    .filter((f) => f.endsWith(".yml") || f.endsWith(".yaml"))
    .flatMap((f) => workflowSteps(join(WORKFLOW_DIR, f)))
    .filter((step) => step.body.includes(script))
    .map((step) => ({
      ...step,
      phase: parseDeployPhase(step.env.get("DEPLOY_PHASE")),
      target: parseDeployTarget(step.env.get("DEPLOY_TARGET")),
    }));
}

describe("every deploy-vercel.mjs call site satisfies the script's env contract", () => {
  // Called inside each `it`, never in the describe body. `parseDeployPhase`
  // throws by design on an unrecognised DEPLOY_PHASE, and a throw during suite
  // CONSTRUCTION prints `not ok` but exits 0 on Node 22 — so the one edit this
  // file exists to catch would instead delete every assertion in it and leave
  // `ci-scripts-tests` green. Inside an `it`, the same throw fails the run.
  const sites = () => allCallSites(SCRIPT);

  // The negative control. Every assertion below is a loop over `sites`, and a
  // loop over an empty list passes — so a reader-side regression (a rename, an
  // indentation change this parser does not understand) would turn the whole
  // file green rather than red. That is the same fail-open shape #2265 was
  // about, one level up, so it gets an explicit floor.
  it("finds the call sites it is supposed to be guarding", () => {
    assert.ok(
      sites().length >= 3,
      `expected at least 3 deploy-vercel.mjs call sites (production build, production ` +
        `upload, staging), found ${sites().length}: ${sites().map((s) => s.name).join(", ") || "none"}`,
    );

    const production = sites().filter((s) => s.workflowFile === "deploy-production.yml");
    assert.equal(production.length, 2, "deploy-production.yml should have a build and an upload call site");
    assert.deepEqual(
      production.map((s) => s.phase).sort(),
      [DEPLOY_PHASE_BUILD, DEPLOY_PHASE_UPLOAD],
      "the two production call sites should be one build phase and one upload phase",
    );

    assert.ok(
      sites().some((s) => s.workflowFile === "deploy-vercel-staging.yml" && s.phase === DEPLOY_PHASE_ALL),
      "the staging caller should run the unphased (all) path",
    );
    // The target half of the contract only bites if the sites really differ in
    // target; a staging caller read as production would be held to the smaller
    // set and pass without its baseline.
    assert.deepEqual(
      [...new Set(sites().map((s) => `${s.workflowFile}:${s.target}`))].sort(),
      [`deploy-production.yml:${VERCEL_TARGET_PRODUCTION}`, `deploy-vercel-staging.yml:${VERCEL_TARGET_PREVIEW}`],
    );
  });

  // The generalisation of the #2265 guard: not `DEPLOY_SHA` alone, and not
  // production alone.
  it("supplies every variable the call site's phase requires", () => {
    for (const site of sites()) {
      for (const name of requiredEnvFor(site)) {
        assert.ok(
          site.env.has(name),
          `${site.workflowFile} step "${site.name}" (job ${site.jobId}) runs ${SCRIPT} in ` +
            `phase '${site.phase}' for '${site.target}' without ${name}. requireEnv("${name}") would kill the run.`,
        );
      }
    }
  });

  // `requireEnv` returns the value only `if (value)`, so an empty string is
  // missing. A step that declares `DEPLOY_SHA:` with nothing after it reads as
  // present to the assertion above and fails identically at runtime.
  it("declares no required variable as an empty value", () => {
    for (const site of sites()) {
      for (const name of requiredEnvFor(site)) {
        assert.notEqual(
          site.env.get(name),
          "",
          `${site.workflowFile} step "${site.name}" sets ${name} to an empty value; ` +
            `requireEnv treats that as missing.`,
        );
      }
    }
  });

  // The specific regression #2265 fixed, pinned by name so a future refactor of
  // the loops above cannot quietly stop covering it.
  it("still covers the exact #2265 case: the production build step passes DEPLOY_SHA", () => {
    const build = sites().find(
      (s) => s.workflowFile === "deploy-production.yml" && s.phase === DEPLOY_PHASE_BUILD,
    );
    assert.ok(build, "no production build-phase call site found");
    assert.equal(build.env.get("DEPLOY_SHA"), "${{ steps.sha.outputs.sha }}");
  });

  // `DEPLOY_SHA` is `${{ steps.sha.outputs.sha }}`, and the `steps` context does
  // NOT exist in a job-level `env:`. So this value is only correct at STEP
  // level — and because the reader merges three scopes, a well-meant "stop
  // repeating it five times" refactor that hoists it to the job would satisfy
  // every other assertion here while making the workflow fail at dispatch, on
  // the only path to production. The merged map is right for everything else;
  // this is the exception it cannot express.
  it("declares steps.* values on the step itself, where that context exists", () => {
    for (const site of sites()) {
      for (const [name, value] of site.env) {
        if (!/\bsteps\./.test(value)) continue;
        assert.ok(
          site.stepEnv.has(name),
          `${site.workflowFile} step "${site.name}" inherits ${name}="${value}" from a job- or ` +
            `workflow-level env:, but the \`steps\` context is not available there. GitHub would ` +
            `refuse the workflow at dispatch.`,
        );
      }
    }
  });
});


describe("the env contract table", () => {
  const forPhase = (phase) => requiredEnvFor({ phase, target: VERCEL_TARGET_PRODUCTION });

  it("covers every phase parseDeployPhase can return", () => {
    for (const phase of [DEPLOY_PHASE_BUILD, DEPLOY_PHASE_UPLOAD, DEPLOY_PHASE_ALL]) {
      for (const target of [VERCEL_TARGET_PRODUCTION, VERCEL_TARGET_PREVIEW]) {
        assert.doesNotThrow(() => requiredEnvFor({ phase, target }));
      }
    }
  });

  it("refuses an unrecorded phase rather than requiring nothing", () => {
    assert.throws(() => forPhase("rehearse"), /No environment contract recorded/);
  });

  it("refuses an unrecognised target rather than holding it to production's set", () => {
    assert.throws(() => requiredEnvFor({ phase: DEPLOY_PHASE_ALL, target: "staging" }), /DEPLOY_TARGET/);
  });

  it("requires the stash directory in exactly the two phases that have one", () => {
    assert.ok(forPhase(DEPLOY_PHASE_BUILD).includes("VERCEL_BUILD_STASH_DIR"));
    assert.ok(forPhase(DEPLOY_PHASE_UPLOAD).includes("VERCEL_BUILD_STASH_DIR"));
    assert.ok(!forPhase(DEPLOY_PHASE_ALL).includes("VERCEL_BUILD_STASH_DIR"));
  });

  it("requires DEPLOY_SHA in every phase, the build included", () => {
    assert.ok(REQUIRED_ENV_ALWAYS.includes("DEPLOY_SHA"));
    for (const phase of [DEPLOY_PHASE_BUILD, DEPLOY_PHASE_UPLOAD, DEPLOY_PHASE_ALL]) {
      assert.ok(forPhase(phase).includes("DEPLOY_SHA"));
    }
  });

  // Without the baseline a staging run would have no way to keep the rest of
  // the injected Infisical store out of the CLI processes, so its absence must
  // stop the run, not fall back to the ambient environment (#2672).
  it("requires the env baseline for preview in every phase, and never for production", () => {
    for (const phase of [DEPLOY_PHASE_BUILD, DEPLOY_PHASE_UPLOAD, DEPLOY_PHASE_ALL]) {
      assert.ok(
        requiredEnvFor({ phase, target: VERCEL_TARGET_PREVIEW }).includes("VERCEL_BUILD_ENV_BASELINE"),
      );
      assert.ok(!forPhase(phase).includes("VERCEL_BUILD_ENV_BASELINE"));
    }
  });
});
