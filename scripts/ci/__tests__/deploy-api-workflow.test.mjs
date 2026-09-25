// Pins `deploy-api.yml`'s `deploy-staging` wiring (#2505). The job runs only on
// `workflow_run` after a merge, so no PR check would notice any of these going
// wrong: staging deploying before or without its migration, deploying a moving
// ref instead of the CI-verified commit, or dropping the served-commit check.

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { workflowJobs, workflowSteps } from "./helpers/workflow-yaml.mjs";

const WORKFLOW = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..", ".github", "workflows", "deploy-api.yml");
const HEAD_SHA = "${{ github.event.workflow_run.head_sha }}";

const job = () => workflowJobs(WORKFLOW).find((j) => j.jobId === "deploy-staging");
const steps = () => workflowSteps(WORKFLOW).filter((s) => s.jobId === "deploy-staging");
const step = (name) => {
  const found = steps().find((s) => s.name === name);
  assert.ok(found, `deploy-staging has no step named "${name}"`);
  return found;
};

describe("deploy-api.yml deploy-staging", () => {
  it("runs only after migrate-staging, and never after it failed", () => {
    const { keys, if: condition } = job();
    assert.match(keys.get("needs"), /\bmigrate-staging\b/);
    assert.match(condition, /needs\.migrate-staging\.result == 'success'/);
    assert.doesNotMatch(condition, /needs\.migrate-staging\.result == 'failure'/);
  });

  // The plan decides from what staging serves; a per-push path gate at job
  // level would skip API commits whose own run never deployed.
  it("is not gated on a per-push path filter", () => {
    assert.doesNotMatch(job().if, /api-changed/);
  });

  it("serializes staging deploys without cancelling one in flight", () => {
    const concurrency = job().keys.get("concurrency");
    assert.equal(concurrency.get("group"), "deploy-api-staging");
    assert.equal(concurrency.get("cancel-in-progress"), "false");
  });

  it("plans, then deploys only on the plan's say-so, then verifies what the plan named", () => {
    const names = steps().map((s) => s.name);
    const order = ["Plan the deploy", "Deploy the commit to Render", "Verify staging serves the commit"];
    const at = order.map((name) => names.indexOf(name));
    assert.ok(at.every((i) => i !== -1), `missing a step: ${JSON.stringify(names)}`);
    assert.deepEqual([...at].sort((a, b) => a - b), at, `out of order: ${JSON.stringify(names)}`);

    assert.equal(step("Plan the deploy").stepEnv.get("DEPLOY_SHA"), HEAD_SHA);
    assert.match(step("Plan the deploy").body, /node scripts\/ci\/plan-staging-deploy\.mjs/);

    const deploy = step("Deploy the commit to Render");
    assert.equal(deploy.if, "steps.plan.outputs.deploy == 'true'");
    assert.equal(deploy.stepEnv.get("DEPLOY_SHA"), HEAD_SHA, "deploys the CI-verified commit, not a ref");
    assert.match(deploy.body, /node scripts\/ci\/deploy-render-production\.mjs/);

    const verify = step("Verify staging serves the commit");
    assert.equal(verify.if, "steps.plan.outputs.plan != 'stale'", "verifies on a current plan too, never on a stale one");
    assert.equal(verify.stepEnv.get("DEPLOY_SHA"), "${{ steps.plan.outputs.verify_sha }}");
    assert.match(verify.body, /node scripts\/ci\/verify-served-commit\.mjs/);
  });

  // deploy-alert.mjs reads it (DEPLOY_API_CONFIG.planOutput): a stale run or a
  // successful forward one leaves the alert alone, a current one isn't
  // reported as DEPLOYED.
  it("publishes the plan as a job output", () => {
    assert.equal(job().keys.get("outputs").get("plan"), "${{ steps.plan.outputs.plan }}");
  });

  it("checks out full history at the CI-verified commit, for the plan's diff", () => {
    const checkout = step("Checkout").body;
    assert.match(checkout, /ref: \$\{\{ github\.event\.workflow_run\.head_sha \}\}/);
    assert.match(checkout, /fetch-depth: 0/);
  });
});
