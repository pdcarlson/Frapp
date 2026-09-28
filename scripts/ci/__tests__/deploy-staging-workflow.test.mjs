// Pins `deploy-staging.yml` (#2803): the one workflow that deploys staging's
// database, API, web and landing, in one ordered job.
//
// It replaced `deploy-api.yml` and `deploy-vercel-staging.yml`, and carries
// every assertion their tests made (`deploy-api-workflow.test.mjs`,
// `deploy-vercel-staging-workflow.test.mjs`, both deleted with them). The job
// runs only on `workflow_run` after a merge, so no PR check would notice any of
// these going wrong: deploying before CI has passed, deploying a moving ref,
// frontends going live before the migration or the API they call, a stale run
// replacing newer frontends, or the alert going quiet.
//
// Parsed by hand (`helpers/workflow-yaml.mjs`), not with a YAML library:
// `yaml` is present here only as a transitive override, not a declared
// dependency.

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { ALERT_CONFIGS } from "../deploy-alert.mjs";
import { workflowJobs, workflowKeys, workflowSteps } from "./helpers/workflow-yaml.mjs";

const WORKFLOW_DIR = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..", ".github", "workflows");
const WORKFLOW = join(WORKFLOW_DIR, "deploy-staging.yml");
const HEAD_SHA = "${{ github.event.workflow_run.head_sha }}";

const text = readFileSync(WORKFLOW, "utf8");
const uncommented = text
  .split("\n")
  .filter((line) => !/^\s*#/.test(line))
  .join("\n");

const job = (id) => {
  const found = workflowJobs(WORKFLOW).find((j) => j.jobId === id);
  assert.ok(found, `deploy-staging.yml has no job "${id}"`);
  return found;
};
const deploySteps = () => workflowSteps(WORKFLOW).filter((s) => s.jobId === "deploy");
const step = (name) => {
  const found = deploySteps().find((s) => s.name === name);
  assert.ok(found, `the deploy job has no step named "${name}"`);
  return found;
};
const indexOf = (predicate, what) => {
  const index = deploySteps().findIndex(predicate);
  assert.ok(index >= 0, `the deploy job has no step that ${what}`);
  return index;
};
const USES_INFISICAL = /uses:\s*\.\/\.github\/actions\/infisical-secrets/;
const runsVercel = (phase) => (s) => s.body.includes("scripts/ci/deploy-vercel.mjs") && s.env.get("DEPLOY_PHASE") === phase;

describe("deploy-staging.yml: the trigger", () => {
  it("reads the workflow at all, under the name other workflows key on", () => {
    // Guards the whole file: a path typo would make every text assertion pass
    // vacuously. The NAME is load-bearing too: `migration-snapshot.yml`
    // triggers on it (asserted below).
    assert.ok(text.length > 500, "expected the workflow file, got something too short");
    assert.equal(workflowKeys(WORKFLOW).get("name"), "Deploy staging");
  });

  it("is gated on CI success, not on a raw push", () => {
    // The one-word edit from `workflow_run` to `push` reads like a
    // simplification and silently starts deploying commits whose tests have
    // not finished. Nothing else checks for it.
    assert.match(uncommented, /workflow_run:/, "must trigger on workflow_run");
    assert.match(uncommented, /workflows: \["CI"\]/, "must chain off the CI workflow");
    assert.doesNotMatch(uncommented, /^ {2}push:/m, "a push trigger would deploy before CI has finished");
    assert.doesNotMatch(uncommented, /^ {2}pull_request/m, "staging is one shared database: never deploy an unmerged PR");
    assert.match(job("deploy").if, /github\.event\.workflow_run\.conclusion == 'success'/, "CI must have SUCCEEDED, not merely completed");
  });

  it("refuses to run for a fork's CI run, or off main", () => {
    // `workflow_run` fires in the BASE repo's context, with its secrets.
    assert.match(job("deploy").if, /head_repository\.full_name == github\.repository/);
    assert.match(job("deploy").if, /workflow_run\.event == 'push'/);
    assert.match(job("deploy").if, /workflow_run\.head_branch == 'main'/);
  });

  // The plan decides from what staging serves; a per-push path gate would skip
  // API commits whose own run never deployed (#2505).
  it("is not gated on a per-push path filter", () => {
    assert.doesNotMatch(job("deploy").if, /changed/);
    assert.doesNotMatch(uncommented, /^\s+paths(-ignore)?:/m);
  });
});

describe("deploy-staging.yml: the deploy job", () => {
  it("names the staging environment, literally", () => {
    assert.equal(job("deploy").keys.get("environment"), "staging");
  });

  it("queues rather than cancels, under the staging migration lock", () => {
    // Cancelling mid-`db push` half-migrates the database; cancelling between
    // the API and the upload splits the hosts across commits. The group keeps
    // the name DB_PROMOTION_RUNBOOK.md documents.
    const concurrency = job("deploy").keys.get("concurrency");
    assert.equal(concurrency.get("group"), "db-migrate-staging");
    assert.equal(concurrency.get("cancel-in-progress"), "false");
  });

  it("checks out full history at the CI-verified commit, for the plan's diff", () => {
    const checkout = deploySteps()[0];
    assert.match(checkout.body, /uses: actions\/checkout@/);
    assert.match(checkout.body, /ref: \$\{\{ github\.event\.workflow_run\.head_sha \}\}/);
    assert.match(checkout.body, /fetch-depth: 0/);
    assert.match(checkout.body, /persist-credentials: false/, "third-party actions run in this job, which holds staging secrets");
  });

  it("names the commit with DEPLOY_SHA, never a step-level GITHUB_SHA", () => {
    // `GITHUB_` is a reserved prefix: `env: GITHUB_SHA:` in a step is silently
    // ignored, and on a `workflow_run` event the ambient value is the default
    // branch's tip, not the commit CI verified.
    assert.doesNotMatch(uncommented, /^\s*GITHUB_SHA:/m, "use DEPLOY_SHA");
    for (const name of ["Build the Vercel preview bundles (web + landing)", "Plan the deploy", "Deploy the commit to Render", "Upload web + landing to staging"]) {
      assert.equal(step(name).env.get("DEPLOY_SHA"), HEAD_SHA, `${name} must name the CI-verified commit`);
    }
  });

  it("deploys to the preview channel, never production", () => {
    for (const phase of ["build", "upload"]) {
      assert.equal(deploySteps().find(runsVercel(phase)).env.get("DEPLOY_TARGET"), "preview");
    }
    assert.doesNotMatch(uncommented, /DEPLOY_TARGET: production/);
  });

  it("pins the Vercel CLI to an exact version", () => {
    const match = uncommented.match(/npm install --global vercel@(\S+)/);
    assert.ok(match, "must install a pinned Vercel CLI");
    assert.match(match[1], /^\d+\.\d+\.\d+$/, `expected an exact version, got ${match[1]}`);
  });

  it("publishes the plan as a job output, for deploy-alert.mjs", () => {
    // A stale run or a successful forward one leaves the alert alone, and a
    // current one isn't reported as an API deploy.
    assert.equal(job("deploy").keys.get("outputs").get("plan"), "${{ steps.plan.outputs.plan }}");
  });
});

// ── The order (#2803) ────────────────────────────────────────────────────────
// The whole point of merging the two workflows. Before, web and landing were a
// separate workflow fired by the same CI run as the migration and the API, so
// nothing ordered them.
describe("deploy-staging.yml: the order", () => {
  const order = () => ({
    npmCi: indexOf((s) => /\bnpm ci\b/.test(s.body), "runs npm ci"),
    cli: indexOf((s) => /npm install --global vercel@/.test(s.body), "installs the Vercel CLI"),
    supabase: indexOf((s) => /uses:\s*\.\/\.github\/actions\/supabase-cli/.test(s.body), "sets up the Supabase CLI"),
    baseline: indexOf((s) => s.body.includes("scripts/ci/record-env-baseline.mjs"), "records the env baseline"),
    inject: indexOf((s) => USES_INFISICAL.test(s.body), "injects Infisical"),
    build: indexOf(runsVercel("build"), "builds web + landing (DEPLOY_PHASE build)"),
    migrateDry: indexOf((s) => /run-migration\.mjs --env staging --dry-run/.test(s.body), "dry-runs the migrations"),
    migrate: indexOf((s) => /run-migration\.mjs --env staging\s*$/m.test(s.body), "applies the migrations"),
    plan: indexOf((s) => s.body.includes("scripts/ci/plan-staging-deploy.mjs"), "plans the deploy"),
    render: indexOf((s) => s.body.includes("scripts/ci/deploy-render-production.mjs"), "deploys to Render"),
    verify: indexOf((s) => s.body.includes("scripts/ci/verify-served-commit.mjs"), "verifies the served commit"),
    upload: indexOf(runsVercel("upload"), "uploads web + landing (DEPLOY_PHASE upload)"),
    alias: indexOf((s) => s.body.includes("scripts/ci/ensure-vercel-staging-alias.mjs"), "aliases the staging hosts"),
  });

  it("runs install → baseline → inject → plan → build → migrate → Render → verify → upload → alias", () => {
    // The plan is read-only and comes first so a run with nothing to upload
    // builds nothing; every step that changes anything keeps #2803's order.
    const o = order();
    const sequence = ["npmCi", "baseline", "inject", "plan", "build", "migrateDry", "migrate", "render", "verify", "upload", "alias"];
    for (let i = 1; i < sequence.length; i += 1) {
      assert.ok(
        o[sequence[i - 1]] < o[sequence[i]],
        `${sequence[i - 1]} must come before ${sequence[i]}: ${JSON.stringify(deploySteps().map((s) => s.name))}`,
      );
    }
  });

  it("injects Infisical staging after every install, and records the baseline immediately before", () => {
    // No package install script, and no third-party action, may run with the
    // staging store in its environment. A baseline recorded after the
    // injection holds the whole store; `infisicalBuildEnv` refuses one at
    // runtime, and this catches it in review.
    const o = order();
    assert.ok(o.npmCi < o.inject && o.cli < o.inject && o.supabase < o.inject);
    assert.equal(o.baseline, o.inject - 1);
    assert.match(deploySteps()[o.inject].body, /env-slug:\s*"staging"/);
  });

  it("reads the baseline, and the stash, from the same place in both Vercel phases", () => {
    const record = deploySteps().find((s) => s.body.includes("scripts/ci/record-env-baseline.mjs"));
    const written = record.env.get("VERCEL_BUILD_ENV_BASELINE");
    assert.ok(written, "the record step names no VERCEL_BUILD_ENV_BASELINE");
    assert.match(written, /^\$\{\{ runner\.temp \}\}\//, "outside the checkout, so nothing uploads it");
    const build = deploySteps().find(runsVercel("build"));
    const upload = deploySteps().find(runsVercel("upload"));
    for (const phase of [build, upload]) assert.equal(phase.env.get("VERCEL_BUILD_ENV_BASELINE"), written);
    assert.ok(build.env.get("VERCEL_BUILD_STASH_DIR"), "the build phase stashes each project's output");
    assert.equal(upload.env.get("VERCEL_BUILD_STASH_DIR"), build.env.get("VERCEL_BUILD_STASH_DIR"));
  });

  it("ships no frontend after a failed build, migration or API verification", () => {
    // Every step up to the upload runs unconditionally or on the plan, so a
    // failure in any of them fails the job before the upload. `always()`,
    // `failure()`, `!cancelled()` or `continue-on-error` on any of them would
    // let the job carry on past it.
    const o = order();
    for (const [i, s] of deploySteps().entries()) {
      assert.doesNotMatch(s.body, /continue-on-error/, `${s.name} must not swallow a failure`);
      if (i <= o.alias) {
        assert.doesNotMatch(s.if ?? "", /always\(\)|failure\(\)|cancelled\(\)/, `${s.name} must not run past a failure`);
      }
    }
    for (const name of ["Run migrations (dry-run)", "Run migrations (apply)", "Plan the deploy"]) {
      assert.equal(step(name).if, null, `${name} runs on every eligible push`);
    }
    // The build runs on the plan alone: a skipped build must mean nothing
    // uploads, never an upload with nothing built.
    assert.equal(step("Build the Vercel preview bundles (web + landing)").if, "steps.plan.outputs.upload == 'true'");
  });

  it("plans, deploys on the plan's say-so, and verifies what the plan named", () => {
    const deploy = step("Deploy the commit to Render");
    assert.equal(deploy.if, "steps.plan.outputs.deploy == 'true'");
    const verify = step("Verify staging serves the commit");
    // `verify_sha` is set whenever anything ships (a current plan, or a stale
    // one that uploads), and empty only when nothing does.
    assert.equal(verify.if, "steps.plan.outputs.verify_sha != ''");
    assert.equal(verify.env.get("DEPLOY_SHA"), "${{ steps.plan.outputs.verify_sha }}");
  });

  it("builds, uploads and aliases on the plan's upload verdict, never the API's", () => {
    // The API verdict reads only the paths its image is built from, so gating
    // the frontends on it skipped a non-tip web-only commit even when nothing
    // newer was live (#2803 review). `plan-staging-deploy.mjs` decides `upload`
    // against what the staging hostnames serve.
    for (const name of [
      "Build the Vercel preview bundles (web + landing)",
      "Upload web + landing to staging",
      "Point the staging hostnames at the new deployments",
    ]) {
      assert.equal(step(name).if, "steps.plan.outputs.upload == 'true'", name);
    }
  });

  it("gives the plan what it needs to read the staging hostnames", () => {
    const plan = step("Plan the deploy");
    assert.equal(plan.env.get("VERCEL_API_KEY"), "${{ secrets.VERCEL_API_KEY }}");
    assert.ok(plan.env.get("VERCEL_TEAM_ID"), "the plan names the Vercel team");
    // The same two hostnames the alias step points, so the plan reads what the
    // upload would replace.
    assert.deepEqual(plan.env.get("VERCEL_STAGING_HOSTS").split(/\s+/).sort(), ["app.staging.frapp.live", "staging.frapp.live"]);
  });
});

describe("deploy-staging.yml: the staging hosts", () => {
  it("aliases both staging hostnames", () => {
    assert.match(uncommented, /VERCEL_STAGING_ALIAS=app\.staging\.frapp\.live/);
    assert.match(uncommented, /VERCEL_STAGING_ALIAS=staging\.frapp\.live/);
  });

  it("aliases by DEPLOYMENT ID from the upload, never by a search for the commit SHA", () => {
    // The search path answers "no deployment for this SHA" by exiting 0, which
    // would leave the hostname on the previous build with the job green, and
    // it has no channel filter, so it can resolve a PRODUCTION deployment.
    const alias = step("Point the staging hostnames at the new deployments");
    assert.equal(alias.env.get("WEB_DEPLOYMENT_ID"), "${{ steps.upload.outputs.web_id }}");
    assert.equal(alias.env.get("LANDING_DEPLOYMENT_ID"), "${{ steps.upload.outputs.landing_id }}");
    assert.match(alias.body, /VERCEL_DEPLOYMENT_ID="\$WEB_DEPLOYMENT_ID"/);
    assert.match(alias.body, /VERCEL_DEPLOYMENT_ID="\$LANDING_DEPLOYMENT_ID"/);
    assert.doesNotMatch(
      alias.body,
      /VERCEL_PROJECT_ID="\$VERCEL_(WEB|LANDING)_PROJECT_ID"[\s\\]*\n\s*VERCEL_STAGING_ALIAS/,
      "the alias step must not fall back to the SHA search path",
    );
    assert.match(step("Upload web + landing to staging").body, /id: upload/);
  });

  it("refuses to alias when the upload reported no deployment id", () => {
    const alias = step("Point the staging hostnames at the new deployments").body;
    assert.match(alias, /if \[ -z "\$\{WEB_DEPLOYMENT_ID:-\}" \] \|\| \[ -z "\$\{LANDING_DEPLOYMENT_ID:-\}" \]/);
    assert.match(alias, /Refusing to alias a staging hostname/);
  });
});

// ── The alert (#763, #1674; P1 per the owner's decision on #2803) ────────────
describe("deploy-staging.yml: the deploy-outcome alert", () => {
  it("reports through the shared deploy-alert script, with its own config", () => {
    const outcome = job("deploy-outcome");
    assert.equal(outcome.keys.get("needs"), "[deploy]");
    const report = workflowSteps(WORKFLOW).find((s) => s.jobId === "deploy-outcome" && s.body.includes("deploy-alert.mjs"));
    assert.ok(report, "deploy-outcome must run scripts/ci/deploy-alert.mjs");
    assert.equal(report.env.get("ALERT_CONFIG"), "deploy-staging");
  });

  it("matches the alert config it selects: file, job names, plan output and P1", () => {
    const config = ALERT_CONFIGS["deploy-staging"];
    assert.equal(config.workflowFile, ".github/workflows/deploy-staging.yml");
    assert.equal(config.workflowLabel, workflowKeys(WORKFLOW).get("name"));
    for (const name of config.deployJobs) job(name);
    assert.equal(config.planOutput.job, "deploy");
    assert.ok(job("deploy").keys.get("outputs").has(config.planOutput.output));
    assert.ok(config.alertLabels.includes("P1"), "a failed staging deploy is P1 (owner decision on #2803)");
  });

  it("grants issues: write to the alert job only", () => {
    // The deploy job handles every staging credential; it stays read-only.
    assert.equal(workflowKeys(WORKFLOW).get("permissions").get("contents"), "read");
    assert.equal((uncommented.match(/issues: write/g) ?? []).length, 1, "exactly one job may hold issues: write");
    assert.equal(job("deploy-outcome").keys.get("permissions").get("issues"), "write");
  });

  it("keeps the alert job's trigger conditions exactly the deploy job's, plus always()", () => {
    // `needs: [deploy]` does NOT stop a job that uses `always()` when its
    // dependency is skipped, so this `if:` is the only thing keeping it from
    // reporting "deployed NOTHING" on every CI-failed run. And a condition
    // tightened on one job only would let the two disagree about when a deploy
    // was attempted. Compared as one normalised expression, not a set of
    // extracted conditions: a set drops boolean structure and ignores guards
    // outside the extraction pattern.
    const normalise = (expr) => expr.replace(/\s+/g, " ").trim();
    const deployIf = normalise(job("deploy").if);
    const outcomeIf = normalise(job("deploy-outcome").if);
    assert.ok(outcomeIf.startsWith("always() && "), `deploy-outcome's if: must lead with always() &&, got: ${outcomeIf}`);
    assert.doesNotMatch(deployIf, /always\(\)/);
    assert.equal(outcomeIf.slice("always() && ".length), deployIf);
    // Guards the comparison itself against two blocks read as the same
    // trivial string.
    assert.match(deployIf, /workflow_run\.conclusion == 'success'/);
    assert.ok(deployIf.split("&&").length >= 4, "expected the deploy job's four guards");
  });
});

describe("deploy-staging.yml: the rest of the repo keys on it", () => {
  it("is what migration-snapshot.yml triggers on, by name", () => {
    // `workflow_run.workflows` matches workflow NAMES. A rename here with no
    // matching edit there stops the snapshot refreshing after staging
    // migrates, and the drift gate then waits on a stale one.
    const snapshot = readFileSync(join(WORKFLOW_DIR, "migration-snapshot.yml"), "utf8");
    const list = snapshot.match(/^\s+workflows:\s*\[([^\]]*)\]/m);
    assert.ok(list, "migration-snapshot.yml has no workflow_run list");
    const names = list[1].split(",").map((n) => n.trim().replace(/^"|"$/g, ""));
    assert.ok(names.includes(workflowKeys(WORKFLOW).get("name")), `migration-snapshot.yml triggers on ${list[1]}`);
  });

  it("is the only workflow that migrates staging or ships its frontends", () => {
    // A second staging deployer is the race #2803 removed.
    for (const file of readdirSync(WORKFLOW_DIR).filter((f) => /\.ya?ml$/.test(f) && f !== "deploy-staging.yml")) {
      const other = readFileSync(join(WORKFLOW_DIR, file), "utf8")
        .split("\n")
        .filter((line) => !/^\s*#/.test(line))
        .join("\n");
      assert.doesNotMatch(other, /run-migration\.mjs --env staging/, `${file} migrates staging`);
      assert.doesNotMatch(other, /DEPLOY_TARGET: preview/, `${file} ships staging frontends`);
      assert.doesNotMatch(other, /ensure-vercel-staging-alias\.mjs/, `${file} moves the staging hosts`);
    }
  });
});
