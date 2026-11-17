import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * `scripts/gcp/bootstrap.sh` decides who may deploy to each Google Cloud project
 * (#5228), and it only runs by hand in Cloud Shell, so CI would otherwise only
 * parse it. These run it against a stub `gcloud` that records every call and
 * answers as a fresh project would, and pin the parts that keep staging out of
 * production: the sign-in condition, the per-environment binding, and the
 * argument and project-name guards.
 */

const repoRoot = join(fileURLToPath(new URL(".", import.meta.url)), "..", "..", "..");
const SCRIPT = join(repoRoot, "scripts", "gcp", "bootstrap.sh");

// A fresh project: describes of things the script creates fail, project and
// billing lookups answer from the environment.
const STUB = `#!/usr/bin/env bash
printf '%s\\n' "$*" >> "$GCLOUD_LOG"
args="$*"
case "$args" in
  *"projects describe"*"value(projectNumber)"*) echo 123456789012 ;;
  *"projects describe"*"value(name)"*) echo "$STUB_PROJECT_NAME" ;;
  *"billing projects describe"*) echo True ;;
  *" describe "*) exit 1 ;;
esac
exit 0
`;

function run(args, projectName) {
  const dir = mkdtempSync(join(tmpdir(), "gcp-bootstrap-"));
  try {
    const log = join(dir, "calls.log");
    writeFileSync(log, "");
    writeFileSync(join(dir, "gcloud"), STUB);
    chmodSync(join(dir, "gcloud"), 0o755);
    const res = spawnSync("bash", [SCRIPT, ...args], {
      encoding: "utf8",
      env: { ...process.env, PATH: `${dir}:${process.env.PATH}`, GCLOUD_LOG: log, STUB_PROJECT_NAME: projectName },
    });
    return { status: res.status, stderr: res.stderr, stdout: res.stdout, calls: readFileSync(log, "utf8").split("\n") };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

const condition = (calls) => calls.find((c) => c.includes("providers create-oidc")) ?? "";
const poolBinding = (calls) => calls.find((c) => c.includes("roles/iam.workloadIdentityUser")) ?? "";

test("staging: sign-in is limited to this repository, its owner and the staging environment", () => {
  const r = run(["staging", "nonprod-123"], "nonprod");
  assert.equal(r.status, 0, r.stderr);
  const c = condition(r.calls);
  assert.match(c, /assertion\.repository_id == '1157424895'/);
  assert.match(c, /assertion\.repository_owner_id == '356693519'/);
  assert.match(c, /assertion\.environment == 'staging'/);
  assert.match(poolBinding(r.calls), /workloadIdentityPools\/github\/attribute\.environment\/staging /);
  assert.match(r.stdout, /region:\s+us-east4/);
});

test("the API's identity may call Vertex AI in its own project, so it needs no key file", () => {
  const r = run(["staging", "nonprod-123"], "nonprod");
  assert.equal(r.status, 0, r.stderr);
  assert.ok(r.calls.some((c) => c.includes("--project=nonprod-123") && c.includes("services enable") && c.includes("aiplatform.googleapis.com")));
  const grant = r.calls.find((c) => c.includes("roles/aiplatform.user")) ?? "";
  assert.match(grant, /projects add-iam-policy-binding nonprod-123/);
  assert.match(grant, /serviceAccount:frapp-api-runtime@nonprod-123\.iam\.gserviceaccount\.com/);
});

test("production: sign-in is limited to the production environment, and it may read staging's images", () => {
  const r = run(["production", "prod-456", "--staging-project", "nonprod-123"], "prod");
  assert.equal(r.status, 0, r.stderr);
  assert.match(condition(r.calls), /assertion\.environment == 'production'/);
  assert.match(poolBinding(r.calls), /attribute\.environment\/production /);
  const read = r.calls.find((c) => c.includes("roles/artifactregistry.reader")) ?? "";
  assert.match(read, /--project=nonprod-123/);
  assert.match(read, /--location=us-east4/);
  assert.match(r.stdout, /region:\s+us-east5/);
});

test("production without --staging-project is refused before any change", () => {
  const r = run(["production", "prod-456"], "prod");
  assert.equal(r.status, 2);
  assert.ok(!r.calls.some((c) => c.includes("add-iam-policy-binding")));
});

test("a flag with no value prints usage instead of exiting silently", () => {
  const r = run(["production", "prod-456", "--staging-project"], "prod");
  assert.equal(r.status, 2);
  assert.match(r.stderr, /usage:/);
});

test("a project named for the other environment is refused", () => {
  const asStaging = run(["staging", "prod-456"], "prod");
  assert.equal(asStaging.status, 1);
  assert.ok(!asStaging.calls.some((c) => c.includes("add-iam-policy-binding")));
  const asProduction = run(["production", "nonprod-123", "--staging-project", "other"], "nonprod");
  assert.equal(asProduction.status, 1);
  assert.ok(!asProduction.calls.some((c) => c.includes("add-iam-policy-binding")));
});

test("--infisical-org-id names the sync account with the suffix Infisical requires", () => {
  const r = run(["staging", "nonprod-123", "--infisical-org-id", "df92581a-0fe9-42b5-b526-0a1e88ec8085"], "nonprod");
  assert.equal(r.status, 0, r.stderr);
  assert.ok(r.calls.some((c) => c.includes("service-accounts create infisical-df92581a-0fe9")));
  const grant = r.calls.find((c) => c.includes("roles/iam.serviceAccountTokenCreator")) ?? "";
  assert.match(grant, /infisical-us@infisical-us\.iam\.gserviceaccount\.com/);
  // Infisical lists a project for a sync only once it can see Secret Manager is on there.
  const viewer = r.calls.find((c) => c.includes("roles/serviceusage.serviceUsageViewer")) ?? "";
  assert.match(viewer, /serviceAccount:infisical-df92581a-0fe9@nonprod-123\.iam\.gserviceaccount\.com/);
});
