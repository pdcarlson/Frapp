import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { CANDIDATE_TAG } from "../deploy-cloud-run.mjs";

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

// STUB_EXISTING=0: nothing made yet except the Cloud Run service (STUB_SERVICE=1),
// so describes of what the script creates fail. STUB_EXISTING=1: a rerun, where
// everything exists; STUB_BACKENDS is what the backend service has behind it.
const STUB = `#!/usr/bin/env bash
printf '%s\\n' "$*" >> "$GCLOUD_LOG"
printf '%s|%s\\n' "$HTTPS_PROXY" "$HTTP_PROXY" >> "$GCLOUD_LOG.proxy"
args="$*"
case "$args" in
  *"projects describe"*"value(name)"*) echo "$STUB_PROJECT_NAME" ;;
  *"run services describe"*) [ "$STUB_SERVICE" = 1 ] || exit 1 ;;
  *"addresses describe"*"value(address)"*) echo 203.0.113.7 ;;
  *"dns-authorizations describe"*"dnsResourceRecord.name"*) echo "_acme-challenge.$STUB_HOST." ;;
  *"dns-authorizations describe"*"dnsResourceRecord.data"*) echo "abc.1.authorize.certificatemanager.goog." ;;
  *"certificates describe"*"managed.state"*) echo PROVISIONING ;;
  *"backend-services describe frapp-api-candidate-backend"*"backends[].group"*) echo "$STUB_CANDIDATE_BACKENDS" ;;
  *"backend-services describe"*"backends[].group"*) echo "$STUB_BACKENDS" ;;
  *"url-maps describe"*"hostRules[].hosts"*) echo "$STUB_HOST_RULES" ;;
  *" describe "*) [ "$STUB_EXISTING" = 1 ] || exit 1 ;;
esac
exit 0
`;

const NEG_URL = "https://www.googleapis.com/compute/v1/projects/nonprod-123/regions/us-east4/networkEndpointGroups/frapp-api-neg";
const CANDIDATE_NEG_URL = NEG_URL.replace("frapp-api-neg", "frapp-api-candidate-neg");
const RERUN = { existing: "1", backends: NEG_URL, candidateBackends: CANDIDATE_NEG_URL, hostRules: "candidate.api-staging.frapp.live" };

function run(args, { projectName, host = "api-staging.frapp.live", service = "1", existing = "0", backends = "", candidateBackends = "", hostRules = "", env = {} }) {
  const dir = mkdtempSync(join(tmpdir(), "gcp-lb-"));
  try {
    const log = join(dir, "calls.log");
    writeFileSync(log, "");
    writeFileSync(`${log}.proxy`, "");
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
        STUB_EXISTING: existing,
        STUB_BACKENDS: backends,
        STUB_CANDIDATE_BACKENDS: candidateBackends,
        STUB_HOST_RULES: hostRules,
        ...env,
      },
    });
    return { status: res.status, stderr: res.stderr, stdout: res.stdout, calls: readFileSync(log, "utf8").split("\n"),
      proxies: readFileSync(`${log}.proxy`, "utf8").split("\n").filter(Boolean),
    };
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
  assert.match(call(r.calls, "add-backend"), /--network-endpoint-group=frapp-api-neg --network-endpoint-group-region=us-east4/);
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

test("a rerun creates nothing and keeps logging on", () => {
  const r = run(["staging", "nonprod-123"], { projectName: "nonprod", ...RERUN });
  assert.equal(r.status, 0, r.stderr);
  assert.deepEqual(creates(r.calls), []);
  assert.equal(call(r.calls, "add-backend"), "");
  assert.equal(call(r.calls, "add-path-matcher"), "");
  assert.match(call(r.calls, "backend-services update"), /--enable-logging --logging-sample-rate=1\.0/);
});

test("a rerun attaches the backend an earlier run stopped before attaching", () => {
  const r = run(["staging", "nonprod-123"], { projectName: "nonprod", ...RERUN, backends: "" });
  assert.equal(r.status, 0, r.stderr);
  assert.match(call(r.calls, "add-backend"), /--network-endpoint-group=frapp-api-neg --network-endpoint-group-region=us-east4/);
});

test("candidate.<host> reaches the revision the deploy tags, with a wildcard proved by the same record", () => {
  const r = run(["staging", "nonprod-123"], { projectName: "nonprod" });
  assert.equal(r.status, 0, r.stderr);
  // The tag the deploy checks a new revision on, not a copy of its name.
  assert.match(
    call(r.calls, "network-endpoint-groups create frapp-api-candidate-neg"),
    new RegExp(`--region=us-east4 .*--cloud-run-service=frapp-api --cloud-run-tag=${CANDIDATE_TAG}$`),
  );
  assert.match(call(r.calls, "backend-services create frapp-api-candidate-backend"), /--enable-logging --logging-sample-rate=1\.0/);
  assert.match(call(r.calls, "add-backend frapp-api-candidate-backend"), /--network-endpoint-group=frapp-api-candidate-neg /);
  assert.match(
    call(r.calls, "add-path-matcher frapp-api "),
    /--default-service=frapp-api-candidate-backend --new-hosts=candidate\.api-staging\.frapp\.live/,
  );
  assert.match(call(r.calls, "certificates create frapp-api-candidate-cert"), /--domains=\*\.api-staging\.frapp\.live --dns-authorizations=frapp-api-dns-auth/);
  assert.match(call(r.calls, "entries create frapp-api-candidate-host"), /--certificates=frapp-api-candidate-cert --hostname=candidate\.api-staging\.frapp\.live/);
  // One challenge record covers both certificates; only an A record is new.
  assert.equal(r.calls.filter((c) => c.includes("dns-authorizations create")).length, 1);
  assert.match(r.stdout, /candidateRecord:\s+A candidate\.api-staging\.frapp\.live -> 203\.0\.113\.7/);
});

test("a rerun attaches the candidate backend and host rule an earlier run stopped before", () => {
  const r = run(["staging", "nonprod-123"], { projectName: "nonprod", ...RERUN, candidateBackends: "", hostRules: "" });
  assert.equal(r.status, 0, r.stderr);
  assert.match(call(r.calls, "add-backend frapp-api-candidate-backend"), /--network-endpoint-group=frapp-api-candidate-neg/);
  assert.match(call(r.calls, "add-path-matcher"), /--new-hosts=candidate\.api-staging\.frapp\.live/);
});

test("a proxy set in the caller's environment reaches gcloud unchanged", () => {
  const r = run(["staging", "nonprod-123"], {
    projectName: "nonprod",
    env: { HTTPS_PROXY: "http://proxy.example:3128", HTTP_PROXY: "http://proxy.example:3128" },
  });
  assert.equal(r.status, 0, r.stderr);
  assert.ok(r.proxies.every((p) => p === "http://proxy.example:3128|http://proxy.example:3128"), r.proxies.join(","));
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
