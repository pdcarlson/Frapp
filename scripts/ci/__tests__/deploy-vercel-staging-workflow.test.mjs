import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

// Pins the properties of `deploy-vercel-staging.yml` that are load-bearing and
// invisible in a diff (#1578).
//
// The one that matters most is the CI gate. `deploy-api.yml`'s header states
// the invariant for the whole repo — "Triggered ONLY after CI workflow
// completes successfully. This ensures broken code never deploys." — and the
// obvious-looking edit that breaks it is a one-word change from `workflow_run`
// to `push`, which reads like a simplification and silently starts deploying
// commits whose tests have not finished. There is no other check for that.
//
// Parsed by hand rather than with a YAML library, matching
// `workflow-concurrency.test.mjs`: `yaml` is present here as a transitive
// override rather than a declared dependency.

const WORKFLOW = join(
  dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
  "..",
  ".github",
  "workflows",
  "deploy-vercel-staging.yml",
);

const text = readFileSync(WORKFLOW, "utf8");
const uncommented = text
  .split("\n")
  .filter((line) => !/^\s*#/.test(line))
  .join("\n");

describe("deploy-vercel-staging.yml", () => {
  it("reads the workflow at all", () => {
    // Guards the whole file: a path typo would make every assertion below pass
    // vacuously against an empty string.
    assert.ok(text.length > 500, "expected the workflow file, got something too short");
    assert.match(uncommented, /^name: Deploy Vercel staging$/m);
  });

  it("is gated on CI success, not on a raw push", () => {
    assert.match(uncommented, /workflow_run:/, "must trigger on workflow_run");
    assert.match(uncommented, /workflows: \["CI"\]/, "must chain off the CI workflow");
    assert.doesNotMatch(
      uncommented,
      /^ {2}push:/m,
      "a push trigger would deploy before CI has finished",
    );
    assert.match(
      uncommented,
      /github\.event\.workflow_run\.conclusion == 'success'/,
      "must require CI to have SUCCEEDED, not merely completed",
    );
  });

  it("refuses to run for a fork's CI run", () => {
    // `workflow_run` fires in the BASE repo's context, with its secrets. Without
    // this guard a fork could trigger a deploy carrying them.
    assert.match(uncommented, /head_repository\.full_name == github\.repository/);
  });

  it("deploys the commit CI verified, not the tip of main", () => {
    // On a busy branch those differ, and deploying the tip ships a commit whose
    // CI has not finished — the exact gap the trigger exists to close.
    assert.match(uncommented, /ref: \$\{\{ github\.event\.workflow_run\.head_sha \}\}/);
    assert.match(uncommented, /DEPLOY_SHA: \$\{\{ github\.event\.workflow_run\.head_sha \}\}/);
  });

  it("names the commit with DEPLOY_SHA, never a step-level GITHUB_SHA", () => {
    // `GITHUB_` is a reserved prefix, so `env: GITHUB_SHA:` in a step is
    // SILENTLY IGNORED — it reads correct and the script gets the ambient
    // value. On a `workflow_run` event that ambient value is the default
    // branch's tip, not `workflow_run.head_sha`, so the alias would be pointed
    // at a deployment for the wrong commit (or none). The same trap is
    // documented at the CLI entry of verify-vercel-deploy.mjs.
    assert.doesNotMatch(
      uncommented,
      /^\s*GITHUB_SHA:/m,
      "a step-level GITHUB_SHA is silently ignored by Actions — use DEPLOY_SHA",
    );
    assert.match(uncommented, /DEPLOY_SHA: \$\{\{ github\.event\.workflow_run\.head_sha \}\}/);
  });

  it("deploys to the preview channel, never production", () => {
    assert.match(uncommented, /DEPLOY_TARGET: preview/);
    assert.doesNotMatch(uncommented, /DEPLOY_TARGET: production/);
  });

  it("pins the Vercel CLI to an exact version", () => {
    // An unpinned `@latest` makes the deploy path depend on whatever Vercel
    // published this morning.
    const match = uncommented.match(/npm install --global vercel@(\S+)/);
    assert.ok(match, "must install a pinned Vercel CLI");
    assert.match(match[1], /^\d+\.\d+\.\d+$/, `expected an exact version, got ${match[1]}`);
  });

  it("queues rather than cancels, so the two hosts cannot split across commits", () => {
    // Web and landing deploy sequentially in one job; cancelling between them
    // leaves web on the newer commit and landing on the older.
    assert.match(uncommented, /group: deploy-vercel-staging/);
    assert.match(uncommented, /cancel-in-progress: false/);
  });

  it("aliases both staging hostnames after a successful deploy", () => {
    assert.match(uncommented, /VERCEL_STAGING_ALIAS=app\.staging\.frapp\.live/);
    assert.match(uncommented, /VERCEL_STAGING_ALIAS=staging\.frapp\.live/);
  });

  it("aliases by DEPLOYMENT ID, never by a search for the commit SHA", () => {
    // The alias script's search path answers "no deployment for this SHA" by
    // exiting 0 — safe only while verify-vercel-deploy.mjs gated it, and #1579
    // removed those jobs. A search that comes up empty for an unrelated reason
    // (a lagging list index, a lost --meta flag) would leave the hostname on
    // the previous build with this job green: the exact symptom #1578 exists to
    // end. The search also has no channel filter, so it can resolve the
    // PRODUCTION deployment of a commit released earlier.
    assert.match(uncommented, /VERCEL_DEPLOYMENT_ID="\$WEB_DEPLOYMENT_ID"/);
    assert.match(uncommented, /VERCEL_DEPLOYMENT_ID="\$LANDING_DEPLOYMENT_ID"/);
    assert.doesNotMatch(
      uncommented,
      /VERCEL_PROJECT_ID="\$VERCEL_(WEB|LANDING)_PROJECT_ID"[\s\\]*\n\s*VERCEL_STAGING_ALIAS/,
      "the alias step must not fall back to the SHA search path",
    );
  });

  it("refuses to alias when the deploy step reported no deployment id", () => {
    // An empty id must be a failure, not a silently skipped alias.
    assert.match(uncommented, /if \[ -z "\$\{WEB_DEPLOYMENT_ID:-\}" \]/);
    assert.match(uncommented, /Refusing to alias a staging hostname/);
  });

  it("installs workspace dependencies before building", () => {
    // Both apps import from `packages/`, so `vercel build` needs the workspace
    // installed; without this the build fails on a missing module.
    const npmCi = uncommented.indexOf("npm ci");
    const deploy = uncommented.indexOf("deploy-vercel.mjs");
    assert.ok(npmCi > 0, "must run npm ci");
    assert.ok(npmCi < deploy, "npm ci must come before the deploy step");
  });
});
