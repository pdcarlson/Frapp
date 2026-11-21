import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * `scripts/gcp/observability.sh` sets up Google Cloud's uptime check, email
 * alerts and Secret Manager read log for the API (#5228). It only runs by hand
 * in Cloud Shell, so these run it against a stub `gcloud` that records every
 * call, and pin what a mistake would cost: the host each environment checks,
 * the project-name guard, that every policy emails the one channel, that a
 * rerun updates instead of duplicating, and that the IAM policy goes back with
 * only the audit config added.
 */

const repoRoot = join(fileURLToPath(new URL(".", import.meta.url)), "..", "..", "..");
const SCRIPT = join(repoRoot, "scripts", "gcp", "observability.sh");
const CHANNEL = "projects/nonprod-123/notificationChannels/111";
const CHECK = "projects/nonprod-123/uptimeCheckConfigs/frapp-api-check-abc";

const STUB = `#!/usr/bin/env bash
printf '%s\\n' "$*" >> "$GCLOUD_LOG"
args="$*"
file_arg() { for a in "$@"; do case "$a" in --policy-from-file=*) echo "\${a#--policy-from-file=}" ;; esac; done; }
case "$args" in
  *"projects describe"*"value(name)"*) echo "$STUB_PROJECT_NAME" ;;
  *"run services describe"*) [ "$STUB_SERVICE" = 1 ] || exit 1 ;;
  *"monitoring channels list"*) [ -n "$STUB_CHANNEL" ] && echo "$STUB_CHANNEL" ;;
  *"monitoring channels create"*) echo "${CHANNEL}" ;;
  *"uptime list-configs"*) [ -n "$STUB_UPTIME" ] && echo "$STUB_UPTIME" ;;
  *"uptime describe"*) echo "$STUB_UPTIME_HOST" ;;
  *"uptime create"*) echo "${CHECK}" ;;
  *"logging metrics describe"*) [ "$STUB_EXISTING" = 1 ] || exit 1 ;;
  *"policies list"*) [ "$STUB_EXISTING" = 1 ] && echo "projects/x/alertPolicies/9" ;;
  *"policies create"*)
    if [ "$STUB_CREATE_FAILS" = 1 ]; then echo "INVALID_ARGUMENT: Field alert_policy.combiner had an invalid value" >&2; exit 1; fi
    cat "$(file_arg "$@")" >> "$GCLOUD_LOG.policies"; echo "---" >> "$GCLOUD_LOG.policies" ;;
  *"policies update"*) cat "$(file_arg "$@")" >> "$GCLOUD_LOG.policies"; echo "---" >> "$GCLOUD_LOG.policies" ;;
  *"get-iam-policy"*) printf '%s\n' "$STUB_IAM" ;;
  *"set-iam-policy"*) for a in "$@"; do case "$a" in *.json) cp "$a" "$GCLOUD_LOG.iam" ;; esac; done ;;
esac
exit 0
`;

const IAM = JSON.stringify({ bindings: [{ role: "roles/owner", members: ["user:owner@example.com"] }], etag: "BwX1", version: 1 });

function run(
  args,
  { projectName, service = "1", channel = "", uptime = "", uptimeHost = "", existing = "0", iam = IAM, createFails = "0" } = {},
) {
  const dir = mkdtempSync(join(tmpdir(), "gcp-obs-"));
  try {
    const log = join(dir, "calls.log");
    writeFileSync(log, "");
    writeFileSync(`${log}.policies`, "");
    writeFileSync(join(dir, "gcloud"), STUB);
    chmodSync(join(dir, "gcloud"), 0o755);
    const res = spawnSync("bash", [SCRIPT, ...args], {
      encoding: "utf8",
      env: {
        ...process.env,
        PATH: `${dir}:${process.env.PATH}`,
        GCLOUD_LOG: log,
        STUB_PROJECT_NAME: projectName,
        STUB_SERVICE: service,
        STUB_CHANNEL: channel,
        STUB_UPTIME: uptime,
        STUB_UPTIME_HOST: uptimeHost,
        STUB_CREATE_FAILS: createFails,
        STUB_EXISTING: existing,
        STUB_IAM: iam,
      },
    });
    let iamSet = null;
    try {
      iamSet = JSON.parse(readFileSync(`${log}.iam`, "utf8"));
    } catch {
      iamSet = null;
    }
    const policies = readFileSync(`${log}.policies`, "utf8")
      .split("---\n")
      .filter((p) => p.trim())
      .map((p) => JSON.parse(p));
    return { status: res.status, stderr: res.stderr, stdout: res.stdout, calls: readFileSync(log, "utf8").split("\n"), policies, iamSet };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

const STAGING = ["staging", "nonprod-123", "alerts@example.com"];

test("staging: checks api-staging's /health/ready and emails every alert to the one channel", () => {
  const r = run(STAGING, { projectName: "nonprod" });
  assert.equal(r.status, 0, r.stderr);
  const create = r.calls.find((c) => c.includes("uptime create"));
  assert.match(create, /host=api-staging\.frapp\.live,project_id=nonprod-123/);
  assert.match(create, /--path=\/health\/ready/);
  assert.match(create, /--validate-ssl=true/);
  assert.match(create, /--period=1 /);
  assert.ok(r.calls.find((c) => c.includes("channels create"))?.includes("email_address=alerts@example.com"));
  assert.ok(r.calls.every((c) => !c || c.includes("--project=nonprod-123") || c.startsWith("projects describe")));

  assert.equal(r.policies.length, 5);
  for (const p of r.policies) {
    assert.deepEqual(p.notificationChannels, [CHANNEL]);
    assert.match(p.displayName, /^Frapp API \(staging\): /);
    assert.equal(p.alertStrategy.autoClose, "86400s");
  }
  const named = (suffix) => r.policies.find((p) => p.displayName.endsWith(suffix)).conditions[0];

  // Down means more than one checker region failing this check.
  const uptime = named("not answering").conditionThreshold;
  assert.match(uptime.filter, /uptime_check\/check_passed/);
  assert.match(uptime.filter, /metric\.label\.check_id="frapp-api-check-abc"/);
  assert.equal(uptime.aggregations[0].crossSeriesReducer, "REDUCE_COUNT_FALSE");
  assert.equal(uptime.comparison, "COMPARISON_GT");
  assert.equal(uptime.thresholdValue, 1);

  const fiveXx = named("5xx burst").conditionThreshold;
  assert.match(fiveXx.filter, /run\.googleapis\.com\/request_count/);
  assert.match(fiveXx.filter, /response_code_class="5xx"/);
  assert.equal(fiveXx.thresholdValue, 10);
  assert.equal(fiveXx.evaluationMissingData, "EVALUATION_MISSING_DATA_INACTIVE", "a quiet minute ends the burst");
  // Google refuses evaluationMissingData on a condition whose duration is 0s.
  for (const p of r.policies) {
    const c = p.conditions[0].conditionThreshold;
    if (c?.evaluationMissingData) assert.notEqual(c.duration, "0s", p.displayName);
  }

  const memory = named("memory near the limit").conditionThreshold;
  assert.match(memory.filter, /run\.googleapis\.com\/container\/memory\/utilizations/);
  assert.equal(memory.thresholdValue, 0.85);
  assert.equal(memory.duration, "300s");

  const crash = r.policies.find((p) => p.displayName.endsWith("container crashed"));
  const crashFilter = crash.conditions[0].conditionMatchedLog.filter;
  assert.match(crashFilter, /run\.googleapis\.com%2Fvarlog%2Fsystem/);
  for (const pattern of ["Container called exit", "Memory limit", "probe failed", "signal"]) {
    assert.ok(crashFilter.includes(pattern), `crash filter matches "${pattern}"`);
  }
  assert.ok(crash.alertStrategy.notificationRateLimit, "a log-match policy needs a rate limit");

  const errors = named("error log burst").conditionThreshold;
  assert.match(errors.filter, /logging\.googleapis\.com\/user\/frapp_api_error_logs/);
  assert.equal(errors.thresholdValue, 20);
  assert.equal(errors.evaluationMissingData, "EVALUATION_MISSING_DATA_INACTIVE");

  // The error metric counts the API's own output, without its 5xx reports.
  const metric = r.calls.find((c) => c.includes("logging metrics create"));
  assert.match(metric, /run\.googleapis\.com%2Fstdout/);
  assert.match(metric, /severity>=ERROR/);
  assert.match(metric, /NOT jsonPayload\.data\.statusCode>=500/);
});

test("the crash filter's signal pattern catches an abort or a kill, not a scale-down", () => {
  const r = run(STAGING, { projectName: "nonprod" });
  const filter = r.policies.find((p) => p.displayName.endsWith("container crashed")).conditions[0].conditionMatchedLog.filter;
  const pattern = new RegExp(filter.match(/textPayload=~"(signal[^"]+)"/)[1]);
  assert.ok(pattern.test("Container terminated on signal 6."));
  assert.ok(pattern.test("Uncaught signal: 11, pid=1"));
  assert.ok(pattern.test("Container terminated on signal 9."));
  assert.ok(!pattern.test("Container terminated on signal 15."));
  assert.ok(!pattern.test("Container terminated on signal 1."));
});

test("production checks api.frapp.live in us-east5's project", () => {
  const r = run(["production", "prod-456", "alerts@example.com"], { projectName: "prod" });
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.calls.find((c) => c.includes("uptime create")), /host=api\.frapp\.live,project_id=prod-456/);
  assert.ok(r.calls.find((c) => c.includes("run services describe")).includes("--region=us-east5"));
  assert.ok(r.policies.every((p) => p.displayName.startsWith("Frapp API (production): ")));
});

test("refuses a project named for the other environment before changing anything", () => {
  const r = run(["production", "nonprod-123", "alerts@example.com"], { projectName: "nonprod" });
  assert.notEqual(r.status, 0);
  assert.ok(r.calls.every((c) => !/create|update|set-iam-policy|services enable/.test(c)));
});

test("refuses something that isn't an email address", () => {
  const r = run(["staging", "nonprod-123", "not-an-email"], { projectName: "nonprod" });
  assert.equal(r.status, 2);
  assert.equal(r.calls.filter(Boolean).length, 0);
});

test("stops when the service doesn't exist yet", () => {
  const r = run(STAGING, { projectName: "nonprod", service: "0" });
  assert.notEqual(r.status, 0);
  assert.match(r.stderr, /no Cloud Run service/);
});

test("a rerun updates what exists instead of making a second copy", () => {
  const iam = JSON.stringify({
    ...JSON.parse(IAM),
    auditConfigs: [{ service: "secretmanager.googleapis.com", auditLogConfigs: [{ logType: "ADMIN_READ" }, { logType: "DATA_READ" }] }],
  });
  const r = run(STAGING, {
    projectName: "nonprod",
    channel: CHANNEL,
    uptime: CHECK,
    uptimeHost: "api-staging.frapp.live",
    existing: "1",
    iam,
  });
  assert.equal(r.status, 0, r.stderr);
  assert.ok(!r.calls.some((c) => c.includes("channels create")));
  assert.ok(r.calls.some((c) => c.includes("channels update") && c.includes("email_address=alerts@example.com")));
  assert.ok(!r.calls.some((c) => c.includes("uptime create") || c.includes("uptime delete")));
  const update = r.calls.find((c) => c.includes("uptime update"));
  assert.match(update, /uptime update frapp-api-check-abc /);
  assert.match(update, /--path=\/health\/ready/);
  assert.match(update, /--period=1 /);
  assert.match(update, /--set-status-classes=2xx/);
  assert.ok(!r.calls.some((c) => c.includes("policies create")));
  assert.equal(r.calls.filter((c) => c.includes("policies update")).length, 5);
  assert.ok(r.calls.some((c) => c.includes("logging metrics update")));
  assert.ok(!r.calls.some((c) => c.includes("set-iam-policy")), "an audit config already on is left alone");
});

test("turns on Secret Manager's read log and keeps the rest of the IAM policy as read", () => {
  const r = run(STAGING, { projectName: "nonprod" });
  assert.equal(r.status, 0, r.stderr);
  const before = JSON.parse(IAM);
  assert.deepEqual(r.iamSet.bindings, before.bindings);
  assert.equal(r.iamSet.etag, before.etag);
  const sm = r.iamSet.auditConfigs.find((c) => c.service === "secretmanager.googleapis.com");
  assert.deepEqual(sm.auditLogConfigs.map((c) => c.logType).sort(), ["ADMIN_READ", "DATA_READ"]);
});

test("a check left on another host is replaced, not kept", () => {
  const r = run(STAGING, { projectName: "nonprod", uptime: CHECK, uptimeHost: "old-api.frapp.live" });
  assert.equal(r.status, 0, r.stderr);
  assert.ok(r.calls.some((c) => c.includes("uptime delete frapp-api-check-abc")));
  assert.match(r.calls.find((c) => c.includes("uptime create")), /host=api-staging\.frapp\.live/);
});

test("a policy Google refuses for a reason other than the new metric stops at once", () => {
  const r = run(STAGING, { projectName: "nonprod", createFails: "1" });
  assert.notEqual(r.status, 0);
  assert.match(r.stderr, /INVALID_ARGUMENT/);
  assert.equal(r.calls.filter((c) => c.includes("policies create")).length, 1, "no retries");
});

test("an IAM policy it can't read fails instead of reading as already on", () => {
  const r = run(STAGING, { projectName: "nonprod", iam: "not json" });
  assert.notEqual(r.status, 0);
  assert.doesNotMatch(r.stdout, /Already on/);
  assert.ok(!r.calls.some((c) => c.includes("set-iam-policy")));
});
