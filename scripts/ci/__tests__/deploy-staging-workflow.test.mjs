// Pins staging's deploy: `deploy-staging.yml` (#2803), which decides whether
// to deploy and reports the outcome, and the job it calls, `_deploy.yml`
// (#2804), which deploys staging's database, API, web and landing in one
// ordered job. Production calls the same job since #2805; its layers are
// pinned in `deploy-production-fence.test.mjs`, and this file pins that
// staging's path through the job is still staging's.
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
import { spawnSync } from "node:child_process";
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { ALERT_CONFIGS } from "../deploy-alert.mjs";
import { workflowJobs, workflowKeys, workflowSteps } from "./helpers/workflow-yaml.mjs";

const WORKFLOW_DIR = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..", ".github", "workflows");
const WORKFLOW = join(WORKFLOW_DIR, "deploy-staging.yml");
const SHARED = join(WORKFLOW_DIR, "_deploy.yml");
const HEAD_SHA = "${{ github.event.workflow_run.head_sha }}";
const INPUT_SHA = "${{ inputs.sha }}";

const withoutComments = (raw) =>
  raw
    .split("\n")
    .filter((line) => !/^\s*#/.test(line))
    .join("\n");
const text = readFileSync(WORKFLOW, "utf8");
const uncommented = withoutComments(text);
const sharedText = readFileSync(SHARED, "utf8");
const sharedUncommented = withoutComments(sharedText);

const jobIn = (file, id) => {
  const found = workflowJobs(file).find((j) => j.jobId === id);
  assert.ok(found, `${file.split("/").pop()} has no job "${id}"`);
  return found;
};
const job = (id) => jobIn(WORKFLOW, id);
const sharedJob = () => jobIn(SHARED, "deploy");
const deploySteps = () => workflowSteps(SHARED).filter((s) => s.jobId === "deploy");
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
/**
 * `_deploy.yml`'s `on.workflow_call` block as `{ triggers, inputs, outputs }`:
 * the trigger names under `on:`, and each input or output as a Map of its own
 * keys. `workflowKeys` reads one level of nesting only, and this block has
 * three.
 */
function workflowCall() {
  const lines = sharedUncommented.split("\n");
  const under = (start, indent) => {
    const body = [];
    for (const line of lines.slice(start + 1)) {
      if (line.trim() === "") continue;
      if (line.search(/\S/) <= indent) break;
      body.push(line);
    }
    return body;
  };
  const keyed = (body, indent) => {
    const out = new Map();
    let current = null;
    for (const line of body) {
      const depth = line.search(/\S/);
      const m = line.match(/^\s*([A-Za-z_-]+):\s*(.*)$/);
      if (!m) continue;
      if (depth === indent) out.set(m[1], (current = new Map()));
      else if (depth === indent + 2 && current) current.set(m[1], m[2].replace(/^["']|["']$/g, ""));
    }
    return out;
  };
  const on = lines.findIndex((l) => /^on:\s*$/.test(l));
  const triggers = under(on, 0).filter((l) => /^ {2}\S/.test(l)).map((l) => l.trim().replace(/:.*$/, ""));
  const call = lines.findIndex((l) => /^ {2}workflow_call:\s*$/.test(l));
  const section = (name) => {
    const at = lines.findIndex((l, i) => i > call && new RegExp(`^ {4}${name}:\\s*$`).test(l));
    return at === -1 ? new Map() : keyed(under(at, 4), 6);
  };
  return { triggers, inputs: section("inputs"), outputs: section("outputs") };
}
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

// ── The call (#2804) ─────────────────────────────────────────────────────────
describe("deploy-staging.yml: the call into _deploy.yml", () => {
  it("calls the shared job for staging, with the commit CI verified", () => {
    const deploy = job("deploy");
    assert.equal(deploy.keys.get("uses"), "./.github/workflows/_deploy.yml");
    const args = deploy.keys.get("with");
    assert.equal(args.get("environment"), "staging");
    // `github.sha` on a workflow_run event is main's tip, which may not have
    // passed CI yet.
    assert.equal(args.get("sha"), HEAD_SHA);
    // Staging has no dry run and no partial scope; the defaults stand.
    assert.equal(args.has("dry_run"), false);
    assert.equal(args.has("scope"), false);
  });

  // Run 36479856561: with no `secrets:` the called job's `staging` secrets all
  // read empty, `environment:` key or not (actions/runner#4453). `inherit` is
  // what releases them; a list would pass the caller's copies, of which none
  // exist (#2583), and hide a broken `environment:` key behind them.
  it("passes `secrets: inherit`, which GitHub needs to release staging's secrets to the called job", () => {
    assert.equal(job("deploy").keys.get("secrets"), "inherit");
    assert.equal((uncommented.match(/^\s+secrets:/gm) ?? []).length, 1, "one secrets: key, the call's");
  });

  it("keeps no deploy step in the caller", () => {
    // A step here would run outside the shared job's order and lock.
    assert.equal(workflowSteps(WORKFLOW).filter((s) => s.jobId === "deploy").length, 0);
    assert.doesNotMatch(uncommented, /run-migration\.mjs|deploy-vercel\.mjs|deploy-render-production\.mjs/);
  });
});

describe("_deploy.yml: the shared job's interface", () => {
  it("is callable only, with the four inputs #2805 needs", () => {
    const { triggers, inputs } = workflowCall();
    assert.deepEqual(triggers, ["workflow_call"], "no trigger but a caller in this repo");
    assert.deepEqual([...inputs.keys()].sort(), ["dry_run", "environment", "scope", "sha"]);
    assert.equal(inputs.get("environment").get("required"), "true");
    assert.equal(inputs.get("sha").get("required"), "true");
    assert.equal(inputs.get("dry_run").get("type"), "boolean");
    assert.equal(inputs.get("dry_run").get("default"), "false");
    assert.equal(inputs.get("scope").get("default"), "full");
  });

  it("exposes the plan as a workflow output, for deploy-alert.mjs", () => {
    // A stale run or a successful forward one leaves the alert alone, and a
    // current one isn't reported as an API deploy. The caller's
    // `needs.deploy.outputs.plan` reads this.
    assert.equal(workflowCall().outputs.get("plan").get("value"), "${{ jobs.deploy.outputs.plan }}");
    assert.equal(sharedJob().keys.get("outputs").get("plan"), "${{ steps.plan.outputs.plan }}");
  });

  it("names the caller's environment, so it gets that environment's secrets and rules", () => {
    // workflow-secrets-scope.test.mjs holds every caller to a literal
    // main-only environment (rule B), since this name is an expression.
    assert.equal(sharedJob().keys.get("environment"), "${{ inputs.environment }}");
  });

  it("refuses an unknown environment, and staging anything but its defaults, before it checks anything out", () => {
    const guard = deploySteps()[0];
    assert.match(guard.name, /^Check the inputs/);
    assert.equal(guard.if, null);
    assert.match(guard.body, /case "\$TARGET_ENVIRONMENT" in/);
    assert.match(guard.body, /^\s+staging\)\n\s+if \[ "\$DRY_RUN" != "false" \] \|\| \[ "\$SCOPE" != "full" \]; then/m);
    assert.match(guard.body, /\^\[0-9a-f\]\{40\}\$/, "the sha must be a full commit SHA");
    assert.equal(guard.env.get("TARGET_ENVIRONMENT"), "${{ inputs.environment }}");
    assert.equal(guard.env.get("DRY_RUN"), "${{ inputs.dry_run }}");
    assert.equal(guard.env.get("SCOPE"), "${{ inputs.scope }}");
    assert.ok(deploySteps().findIndex((s) => /uses: actions\/checkout@/.test(s.body)) > 0);
  });

  // Run the step's own bash, not a regex over it: a refusal that prints an
  // error and carries on would pass any text match (#2804 review).
  it("fails the job on every refusal, and prints the proof line only when all four secrets arrived", () => {
    const guard = deploySteps()[0];
    const script = guard.body
      .split("\n")
      .slice(guard.body.split("\n").findIndex((l) => /^\s*run: \|\s*$/.test(l)) + 1)
      .filter((l) => l.trim() !== "")
      .map((l) => l.replace(/^ {10}/, ""))
      .join("\n");
    assert.match(script, /^set -euo pipefail/, "the whole run block, from its first line");
    const ok = {
      TARGET_ENVIRONMENT: "staging",
      DEPLOY_SHA: "0123456789abcdef0123456789abcdef01234567",
      DRY_RUN: "false",
      SCOPE: "full",
      HAS_INFISICAL_MACHINE_IDENTITY_ID: "true",
      HAS_INFISICAL_CLIENT_SECRET: "true",
      HAS_RENDER_API_KEY: "true",
      HAS_VERCEL_API_KEY: "true",
    };
    const run = (overrides) =>
      spawnSync("bash", ["-c", script], {
        env: { PATH: process.env.PATH, ...ok, ...overrides },
        encoding: "utf8",
      });
    const PROOF = /secrets reached this called job \(its environment: key, and the caller's secrets: inherit\)/;

    for (const [label, overrides] of [
      ["staging", {}],
      ["production", { TARGET_ENVIRONMENT: "production" }],
      ["a production dry run", { TARGET_ENVIRONMENT: "production", DRY_RUN: "true" }],
      ["production, migrations only", { TARGET_ENVIRONMENT: "production", SCOPE: "migrations-only" }],
    ]) {
      const green = run(overrides);
      assert.equal(green.status, 0, `${label}: ${green.stdout}${green.stderr}`);
      assert.match(green.stdout, PROOF, label);
    }

    for (const [label, overrides] of [
      ["an unknown environment", { TARGET_ENVIRONMENT: "preview" }],
      ["no environment", { TARGET_ENVIRONMENT: "" }],
      ["empty sha", { DEPLOY_SHA: "" }],
      ["short sha", { DEPLOY_SHA: "0123456" }],
      ["uppercase sha", { DEPLOY_SHA: "0123456789ABCDEF0123456789ABCDEF01234567" }],
      ["sha with a trailing space", { DEPLOY_SHA: "0123456789abcdef0123456789abcdef01234567 " }],
      ["a staging dry run", { DRY_RUN: "true" }],
      ["a staging partial scope", { SCOPE: "migrations-only" }],
      ["a production scope it doesn't know", { TARGET_ENVIRONMENT: "production", SCOPE: "api-only" }],
      ["an empty production scope", { TARGET_ENVIRONMENT: "production", SCOPE: "" }],
      ["a production dry_run that isn't a boolean", { TARGET_ENVIRONMENT: "production", DRY_RUN: "yes" }],
      ["no Render key", { HAS_RENDER_API_KEY: "false" }],
      ["no Infisical id", { HAS_INFISICAL_MACHINE_IDENTITY_ID: "false" }],
      ["production without its Vercel key", { TARGET_ENVIRONMENT: "production", HAS_VERCEL_API_KEY: "false" }],
    ]) {
      const refused = run(overrides);
      assert.equal(refused.status, 1, `${label}: ${refused.stdout}`);
      assert.match(refused.stdout, /::error::/, label);
      assert.doesNotMatch(refused.stdout, PROOF, `${label}: no proof line on a refusal`);
    }
    assert.match(run({ HAS_VERCEL_API_KEY: "false" }).stdout, /did not reach this called job: VERCEL_API_KEY/);
  });

  it("checks that the environment's secrets reached it, by name and never by value", () => {
    const guard = deploySteps()[0];
    for (const name of ["INFISICAL_MACHINE_IDENTITY_ID", "INFISICAL_CLIENT_SECRET", "RENDER_API_KEY", "VERCEL_API_KEY"]) {
      assert.equal(guard.env.get(`HAS_${name}`), `\${{ secrets.${name} != '' }}`, name);
      assert.match(guard.body, new RegExp(`missing\\+=\\(${name}\\)`), name);
    }
    // No secret value in this step's environment: only the comparisons.
    assert.doesNotMatch(guard.body, /: \$\{\{ secrets\.[A-Z_]+ \}\}/);
  });
});

describe("_deploy.yml: the deploy job", () => {
  it("queues rather than cancels, under the environment's migration lock", () => {
    // Cancelling mid-`db push` half-migrates the database; cancelling between
    // the API and the upload splits the hosts across commits. For staging the
    // group is `db-migrate-staging`, the name DB_PROMOTION_RUNBOOK.md
    // documents; production's is `db-migrate-production`.
    const concurrency = sharedJob().keys.get("concurrency");
    assert.equal(concurrency.get("group"), "db-migrate-${{ inputs.environment }}");
    assert.equal(concurrency.get("cancel-in-progress"), "false");
    assert.equal(job("deploy").keys.get("with").get("environment"), "staging", "so the staging lock is db-migrate-staging");
  });

  it("checks out full history at the caller's commit, for the plan's diff", () => {
    const checkout = deploySteps().find((s) => /uses: actions\/checkout@/.test(s.body));
    assert.ok(checkout, "the deploy job checks out the commit");
    assert.match(checkout.body, /ref: \$\{\{ inputs\.sha \}\}/);
    assert.match(checkout.body, /fetch-depth: 0/);
    assert.match(checkout.body, /persist-credentials: false/, "third-party actions run in this job, which holds staging secrets");
  });

  it("names the commit with DEPLOY_SHA, never a step-level GITHUB_SHA or the event", () => {
    // `GITHUB_` is a reserved prefix: `env: GITHUB_SHA:` in a step is silently
    // ignored, and on a `workflow_run` event the ambient value is the default
    // branch's tip, not the commit CI verified. The shared job takes the
    // commit from its input only; the event is the caller's business.
    assert.doesNotMatch(sharedUncommented, /^\s*GITHUB_SHA:/m, "use DEPLOY_SHA");
    assert.doesNotMatch(sharedUncommented, /github\.event\./, "the shared job reads its inputs, not the caller's event");
    for (const name of ["Build the Vercel preview bundles (web + landing)", "Plan the deploy", "Deploy the commit to Render (staging)", "Upload web + landing to staging"]) {
      assert.equal(step(name).env.get("DEPLOY_SHA"), INPUT_SHA, `${name} must name the caller's commit`);
    }
  });

  // Staging's Vercel steps run on the plan, which runs only for staging; the
  // production ones only for production. A production target reachable on a
  // staging run would ship staging's build to app.frapp.live.
  it("ships staging to the preview channel, and the production channel only for production", () => {
    const vercel = deploySteps().filter((s) => s.body.includes("scripts/ci/deploy-vercel.mjs"));
    assert.equal(vercel.length, 4);
    for (const s of vercel) {
      if (s.env.get("DEPLOY_TARGET") === "preview") {
        assert.equal(s.if, "steps.plan.outputs.upload == 'true'", s.name);
      } else {
        assert.equal(s.env.get("DEPLOY_TARGET"), "production", s.name);
        assert.match(s.if ?? "", /^\$\{\{ inputs\.environment == 'production' && /, s.name);
      }
    }
    assert.equal(step("Plan the deploy").if, "inputs.environment == 'staging'");
  });

  it("pins the Vercel CLI to an exact version", () => {
    const match = sharedUncommented.match(/npm install --global vercel@(\S+)/);
    assert.ok(match, "must install a pinned Vercel CLI");
    assert.match(match[1], /^\d+\.\d+\.\d+$/, `expected an exact version, got ${match[1]}`);
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
    build: indexOf((s) => runsVercel("build")(s) && s.env.get("DEPLOY_TARGET") === "preview", "builds web + landing (DEPLOY_PHASE build)"),
    trusted: indexOf((s) => s.name === "Move the workspace to the trusted ref", "moves to the trusted ref"),
    detach: indexOf((s) => s.name === "Check out the commit being deployed", "checks the deployed commit back out"),
    migrateDry: indexOf((s) => /run-migration\.mjs --env "\$TARGET_ENVIRONMENT" --dry-run/.test(s.body), "dry-runs the migrations"),
    migrate: indexOf((s) => /run-migration\.mjs --env "\$TARGET_ENVIRONMENT"\s*$/m.test(s.body), "applies the migrations"),
    plan: indexOf((s) => s.body.includes("scripts/ci/plan-staging-deploy.mjs"), "plans the deploy"),
    render: indexOf((s) => s.name === "Deploy the commit to Render (staging)", "deploys staging's API to Render"),
    verify: indexOf((s) => s.name === "Verify staging serves the commit", "verifies the served commit"),
    upload: indexOf((s) => runsVercel("upload")(s) && s.env.get("DEPLOY_TARGET") === "preview", "uploads web + landing (DEPLOY_PHASE upload)"),
    alias: indexOf((s) => s.body.includes("scripts/ci/ensure-vercel-staging-alias.mjs"), "aliases the staging hosts"),
  });

  it("runs install → trusted ref → baseline → inject → deployed commit → plan → build → migrate → Render → verify → upload → alias", () => {
    // The plan is read-only and comes first so a run with nothing to upload
    // builds nothing; every step that changes anything keeps #2803's order.
    // The migration dry run lists what is pending ahead of the build, as
    // production's does (#2805): it writes nothing.
    const o = order();
    const sequence = ["npmCi", "cli", "trusted", "supabase", "baseline", "inject", "detach", "plan", "migrateDry", "build", "migrate", "render", "verify", "upload", "alias"];
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
    // Every staging run migrates: the dry run unconditionally, the apply on
    // everything but a dry run, which the guard refuses for staging.
    assert.equal(step("Run migrations (dry-run)").if, null, "the dry run runs on every eligible push");
    assert.equal(step("Run migrations (apply)").if, "${{ !inputs.dry_run }}");
    for (const name of ["Run migrations (dry-run)", "Run migrations (apply)"]) {
      assert.equal(step(name).env.get("TARGET_ENVIRONMENT"), "${{ inputs.environment }}", name);
    }
    // Staging's plan runs on every staging run; the input names it a staging layer (#2804).
    assert.equal(step("Plan the deploy").if, "inputs.environment == 'staging'");
    // The build runs on the plan alone: a skipped build must mean nothing
    // uploads, never an upload with nothing built.
    assert.equal(step("Build the Vercel preview bundles (web + landing)").if, "steps.plan.outputs.upload == 'true'");
  });

  it("plans, deploys on the plan's say-so, and verifies what the plan named", () => {
    const deploy = step("Deploy the commit to Render (staging)");
    assert.equal(deploy.if, "steps.plan.outputs.deploy == 'true'");
    assert.equal(deploy.env.get("RENDER_SERVICE_ID"), "srv-d6lqsq75r7bs73c2fdc0");
    assert.equal(deploy.env.get("SERVICE_LABEL"), "frapp-api-staging");
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
    for (const name of ["Build the Vercel preview bundles (web + landing)", "Upload web + landing to staging"]) {
      assert.equal(step(name).if, "steps.plan.outputs.upload == 'true'", name);
    }
    // The staging hostnames are a staging layer, named by the input (#2804).
    assert.equal(
      step("Point the staging hostnames at the new deployments").if,
      "inputs.environment == 'staging' && steps.plan.outputs.upload == 'true'",
    );
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
    assert.match(sharedUncommented, /VERCEL_STAGING_ALIAS=app\.staging\.frapp\.live/);
    assert.match(sharedUncommented, /VERCEL_STAGING_ALIAS=staging\.frapp\.live/);
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
    // The caller's `deploy` job is the call; its outputs are the called
    // workflow's.
    assert.equal(job(config.planOutput.job).keys.get("uses"), "./.github/workflows/_deploy.yml");
    assert.ok(workflowCall().outputs.has(config.planOutput.output));
    assert.ok(config.alertLabels.includes("P1"), "a failed staging deploy is P1 (owner decision on #2803)");
  });

  it("grants issues: write to the alert job only", () => {
    // The deploy job handles every staging credential; it stays read-only.
    assert.equal(workflowKeys(WORKFLOW).get("permissions").get("contents"), "read");
    assert.equal((uncommented.match(/issues: write/g) ?? []).length, 1, "exactly one job may hold issues: write");
    assert.equal(workflowKeys(SHARED).get("permissions").get("contents"), "read");
    assert.doesNotMatch(sharedUncommented, /: write/, "the shared deploy job writes nothing on GitHub");
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

  it("is the only workflow that calls the shared job for staging; production's caller is the other", () => {
    // A second caller with `environment: staging` would migrate staging and
    // ship its frontends with none of the step text the test below looks for,
    // outside the run the snapshot publisher and the migration gates watch
    // (#2804 review). The same holds for production: one dispatch, one caller.
    const callers = [];
    for (const file of readdirSync(WORKFLOW_DIR).filter((f) => /\.ya?ml$/.test(f) && f !== "_deploy.yml")) {
      for (const j of workflowJobs(join(WORKFLOW_DIR, file))) {
        const uses = String(j.keys.get("uses") ?? "").replace(/^["']|["']$/g, "");
        if (!/\.github\/workflows\/_deploy\.yml(@|$)/.test(uses)) continue;
        callers.push(`${file}/${j.jobId}:${j.keys.get("with")?.get("environment")}`);
      }
    }
    assert.deepEqual(callers.sort(), ["deploy-production.yml/deploy:production", "deploy-staging.yml/deploy:staging"]);
  });

  it("is the only workflow that migrates staging or ships its frontends", () => {
    // A second staging deployer is the race #2803 removed.
    for (const file of readdirSync(WORKFLOW_DIR).filter((f) => /\.ya?ml$/.test(f) && f !== "_deploy.yml")) {
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
