import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * `scripts/gcp/load-balancer.sh` puts the API's public address in front of
 * Cloud Run (#5228). It only runs by hand in Cloud Shell, so these run it
 * against a stub `gcloud` that records every call, and pin what a mistake
 * would cost: the host each environment answers on, the region its backend
 * reads from, the project-name guard, and that the certificate is proved by
 * DNS rather than by traffic, so the address can move with no gap.
 */

const repoRoot = join(fileURLToPath(new URL(".", import.meta.url)), "..", "..", "..");
const SCRIPT = join(repoRoot, "scripts", "gcp", "load-balancer.sh");

// Nothing made yet except the Cloud Run service (STUB_SERVICE=1). Describes of
// what the script creates fail; reads after creation answer.
const STUB = `#!/usr/bin/env bash
printf '%s\\n' "$*" >> "$GCLOUD_LOG"
args="$*"
case "$args" in
  *"projects describe"*"value(name)"*) echo "$STUB_PROJECT_NAME" ;;
  *"run services describe"*) [ "$STUB_SERVICE" = 1 ] || exit 1 ;;
  *"addresses describe"*"value(address)"*) echo 203.0.113.7 ;;
  *"dns-authorizations describe"*"dnsResourceRecord.name"*) echo "_acme-challenge.$STUB_HOST." ;;
  *"dns-authorizations describe"*"dnsResourceRecord.data"*) echo "abc.1.authorize.certificatemanager.goog." ;;
  *"certificates describe"*"managed.state"*) echo PROVISIONING ;;
  *" describe "*) exit 1 ;;
esac
exit 0
`;

function run(args, { projectName, host = "api-staging.frapp.live", service = "1" }) {
  const dir = mkdtempSync(join(tmpdir(), "gcp-lb-"));
  try {
    const log = join(dir, "calls.log");
    writeFileSync(log, "");
    writeFileSync(join(dir, "gcloud"), STUB);
    chmodSync(join(dir, "gcloud"), 0o755);
    const res = spawnSync("bash", [SCRIPT, ...args], {
      encoding: "utf8",
      env: {
        ...process.env,
        PATH: `${dir}:${process.env.PATH}`,
        GCLOUD_LOG: log,
        STUB_PROJECT_NAME: projectName,
        STUB_HOST: host,
        STUB_SERVICE: service,
      },
    });
    return { status: res.status, stderr: res.stderr, stdout: res.stdout, calls: readFileSync(log, "utf8").split("\n") };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

const call = (calls, text) => calls.find((c) => c.includes(text)) ?? "";
const creates = (calls) => calls.filter((c) => / create /.test(c) || c.includes(" import "));

test("staging answers on api-staging.frapp.live from the us-east4 service, proved by DNS", () => {
  const r = run(["staging", "nonprod-123"], { projectName: "nonprod" });
  assert.equal(r.status, 0, r.stderr);
  assert.match(call(r.calls, "network-endpoint-groups create"), /--region=us-east4 .*--cloud-run-service=frapp-api/);
  assert.match(call(r.calls, "dns-authorizations create"), /--domain=api-staging\.frapp\.live/);
  assert.match(call(r.calls, "certificates create"), /--domains=api-staging\.frapp\.live --dns-authorizations=frapp-api-dns-auth/);
  assert.match(call(r.calls, "entries create"), /--hostname=api-staging\.frapp\.live/);
  assert.ok(r.calls.every((c) => !c || c.includes("--project=nonprod-123") || c.startsWith("projects describe")));
  assert.match(r.stdout, /challengeRecord:\s+CNAME _acme-challenge\.api-staging\.frapp\.live -> abc\.1\.authorize/);
  assert.match(r.stdout, /cutoverRecord:\s+A api-staging\.frapp\.live -> 203\.0\.113\.7/);
});

test("production answers on api.frapp.live from the us-east5 service", () => {
  const r = run(["production", "prod-456"], { projectName: "prod", host: "api.frapp.live" });
  assert.equal(r.status, 0, r.stderr);
  assert.match(call(r.calls, "network-endpoint-groups create"), /--region=us-east5 /);
  assert.match(call(r.calls, "certificates create"), /--domains=api\.frapp\.live /);
});

test("every request is logged at the balancer", () => {
  const r = run(["staging", "nonprod-123"], { projectName: "nonprod" });
  assert.match(call(r.calls, "backend-services create"), /--enable-logging --logging-sample-rate=1\.0/);
});

test("both ports share one address, and port 80 only redirects", () => {
  const r = run(["staging", "nonprod-123"], { projectName: "nonprod" });
  assert.match(call(r.calls, "forwarding-rules create frapp-api-https"), /--address=frapp-api-ip .*--ports=443/);
  assert.match(call(r.calls, "forwarding-rules create frapp-api-http "), /--address=frapp-api-ip .*--target-http-proxy=frapp-api-http --ports=80/);
  assert.match(call(r.calls, "target-http-proxies create"), /--url-map=frapp-api-http-redirect/);
});

test("a project named for the other environment is refused before any change", () => {
  const asStaging = run(["staging", "prod-456"], { projectName: "prod" });
  assert.equal(asStaging.status, 1);
  assert.deepEqual(creates(asStaging.calls), []);
  const asProduction = run(["production", "nonprod-123"], { projectName: "nonprod" });
  assert.equal(asProduction.status, 1);
  assert.deepEqual(creates(asProduction.calls), []);
});

test("with no Cloud Run service yet, it stops and says to deploy first", () => {
  const r = run(["staging", "nonprod-123"], { projectName: "nonprod", service: "0" });
  assert.equal(r.status, 1);
  assert.match(r.stderr, /Let a deploy create it first/);
  assert.deepEqual(creates(r.calls), []);
});

test("a wrong argument count prints usage", () => {
  const r = run(["staging"], { projectName: "nonprod" });
  assert.equal(r.status, 2);
  assert.match(r.stderr, /usage:/);
});
