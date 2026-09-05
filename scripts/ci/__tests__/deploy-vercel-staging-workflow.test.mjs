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

  // ── The deploy-outcome alert job (#1674) ────────────────────────────────
  // Before this, a failed staging deploy produced no commit status, no PR
  // check and no notification — a `workflow_run` failure lands on nothing a
  // human looks at.

  it("reports its outcome through the shared deploy-alert script", () => {
    assert.match(uncommented, /^ {2}deploy-outcome:$/m, "must have a deploy-outcome job");
    assert.match(uncommented, /run: node scripts\/ci\/deploy-alert\.mjs/);
    assert.match(uncommented, /needs: \[deploy\]/);
  });

  it("selects the Vercel alert configuration, not the Deploy API one", () => {
    // Without ALERT_CONFIG the script defaults to `deploy-api`, which would
    // read job names this workflow does not emit (reporting them all as
    // "skipped" → a permanent no-op) and, worse, write its findings into the
    // DEPLOY API alert issue. Wrong watchdog, wrong incident thread.
    assert.match(uncommented, /ALERT_CONFIG: deploy-vercel-staging/);
  });

  it("grants issues: write to the alert job only", () => {
    // The workflow-level default is `contents: read`. The alert job is the only
    // one that needs to write, and scoping it to that job is what keeps the
    // deploy job — the one handling Vercel credentials — read-only.
    assert.match(uncommented, /issues: write/);
    assert.equal(
      (uncommented.match(/issues: write/g) ?? []).length,
      1,
      "exactly one job may hold issues: write",
    );
  });

  it("keeps the alert job's trigger conditions in sync with the deploy job's", () => {
    // The real hazard, and the reason this is a test. `needs: [deploy]` does
    // NOT stop a job that uses `always()` when its dependency is skipped, so
    // the alert job's `if:` is the ONLY thing keeping it from running on every
    // CI-failed run and reporting "deployed NOTHING" — true, but noise, since
    // CI is already red where a human looks.
    //
    // Worse in the other direction: if someone tightens the deploy job's
    // conditions and not the alert job's, the two silently disagree about when
    // a deploy was attempted. Comparing the condition SETS catches both.
    //
    // Compared as one NORMALISED EXPRESSION STRING, not as a set of extracted
    // conditions. A set comparison is blind in two directions that both matter:
    // it drops boolean structure (`A && B && C` and `A || B || C` compare
    // equal), and it silently ignores any guard that does not match the
    // extraction pattern — so adding `&& vars.STAGING_DEPLOYS_ENABLED == 'true'`
    // to one job only would pass a set check while genuinely drifting the jobs.

    /** The `if: |` block of a job, as one whitespace-normalised expression. */
    const jobIf = (jobKey) => {
      const lines = uncommented.split("\n");
      const start = lines.findIndex((line) => line === `  ${jobKey}:`);
      assert.notEqual(start, -1, `job ${jobKey} not found`);
      const ifLine = lines.findIndex(
        (line, i) => i > start && /^ {4}if: \|/.test(line),
      );
      assert.notEqual(ifLine, -1, `job ${jobKey} has no block-scalar if:`);
      const body = [];
      for (let i = ifLine + 1; i < lines.length; i += 1) {
        if (!/^ {6}\S/.test(lines[i])) break;
        body.push(lines[i].trim());
      }
      assert.ok(body.length > 0, `job ${jobKey}'s if: block is empty`);
      return body.join(" ").replace(/\s+/g, " ").trim();
    };

    const deployIf = jobIf("deploy");
    const outcomeIf = jobIf("deploy-outcome");

    // always() is what makes the alert job report on a FAILED deploy at all,
    // and it is the ONLY difference the two are allowed to have.
    assert.ok(
      outcomeIf.startsWith("always() && "),
      `deploy-outcome's if: must lead with always() &&, got: ${outcomeIf}`,
    );
    assert.doesNotMatch(deployIf, /always\(\)/);

    assert.equal(
      outcomeIf.slice("always() && ".length),
      deployIf,
      "deploy-outcome's `if:` must be exactly `always() && ` + the deploy job's `if:`",
    );

    // Guards the comparison itself: if both blocks were somehow read as empty
    // or as the same trivial string, the equality above would pass vacuously.
    assert.match(deployIf, /workflow_run\.conclusion == 'success'/);
    assert.ok(deployIf.split("&&").length >= 3, "expected the deploy job's three guards");
  });
});
