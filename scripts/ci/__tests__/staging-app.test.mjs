// The Staging app workflow's two scripts (#4917 step 3): which binaries a run builds, and which
// store uploads finished.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { describe as describeRow, main as confirm } from "../confirm-staging-submissions.mjs";
import { MARKER_DAYS, hasMarker, isTrustedMarker, main as planMain, markerName, plan } from "../plan-staging-app.mjs";

const RUNTIME = "0.13.0-0123456789ab";
const REPO_ID = "42";
const marker = (over = {}) => ({
  name: markerName("ios", RUNTIME),
  expired: false,
  workflow_run: { head_branch: "main", repository_id: 42, head_repository_id: 42 },
  ...over,
});
const artifacts = (list) => async () => ({ ok: true, status: 200, json: async () => ({ artifacts: list }) });

test("auto builds only the platforms with no uploaded binary of this runtime", async () => {
  const r = await plan({ choice: "auto", exists: async (p) => p === "ios" });
  assert.equal(r.ios, false);
  assert.equal(r.android, true);
  assert.match(r.reasons.ios, /already uploaded/);
});

test("a named choice builds exactly that, without asking for the record", async () => {
  const never = async () => assert.fail("the record was read");
  const ios = await plan({ choice: "ios", exists: never });
  assert.deepEqual([ios.ios, ios.android], [true, false]);
  const all = await plan({ choice: "all", exists: never });
  assert.deepEqual([all.ios, all.android], [true, true]);
  const none = await plan({ choice: "none", exists: never });
  assert.deepEqual([none.ios, none.android], [false, false]);
});

test("only a live marker from this repository's own run on main counts", async () => {
  assert.equal(isTrustedMarker(marker(), REPO_ID), true);
  assert.equal(isTrustedMarker(marker({ expired: true }), REPO_ID), false);
  for (const run of [
    { head_branch: "feature", repository_id: 42, head_repository_id: 42 },
    { head_branch: "main", repository_id: 42, head_repository_id: 7 },
    { head_branch: "main", repository_id: 7, head_repository_id: 7 },
    undefined,
  ]) {
    assert.equal(isTrustedMarker(marker({ workflow_run: run }), REPO_ID), false, JSON.stringify(run));
  }
  const args = { name: markerName("ios", RUNTIME), repository: "o/r", repositoryId: REPO_ID, token: "t", sleep: async () => {} };
  assert.equal(await hasMarker({ ...args, fetchImpl: artifacts([marker()]) }), true);
  assert.equal(await hasMarker({ ...args, fetchImpl: artifacts([marker({ name: "other" })]) }), false);
  assert.equal(await hasMarker({ ...args, fetchImpl: artifacts([]) }), false);
  await assert.rejects(hasMarker({ ...args, fetchImpl: async () => ({ ok: false, status: 403 }) }), /403/);
});

test("the plan step writes its outputs, and refuses what it can't judge", async () => {
  const written = [];
  const base = { GITHUB_OUTPUT: "out", GITHUB_REPOSITORY: "o/r", GITHUB_REPOSITORY_ID: REPO_ID, GITHUB_TOKEN: "t", RUNTIME, BUILD: "auto" };
  const run = (env, fetchImpl = artifacts([marker()])) =>
    planMain({ env: { ...base, ...env }, fetchImpl, sleep: async () => {}, write: (file, text) => written.push([file, text]), log: () => {} });
  assert.equal(await run({}), 0);
  assert.deepEqual(written[0], ["out", `runtime=${RUNTIME}\nios=false\nandroid=true\n`]);
  assert.equal(await run({ BUILD: "everything" }), 1);
  assert.equal(await run({ RUNTIME: "0.13.0" }), 1);
  // An unreadable record is an error, never a guess in either direction.
  assert.equal(await run({}, async () => ({ ok: false, status: 404 })), 1);
});

const IOS = "11111111-1111-4111-8111-111111111111";
const ANDROID = "22222222-2222-4222-8222-222222222222";
const eas = (statuses) => async (url, init) => {
  const { variables } = JSON.parse(init.body);
  const status = statuses[variables.id];
  return { ok: true, status: 200, json: async () => ({ data: { submissions: { byId: { id: variables.id, status, canRetry: false, error: status === "ERRORED" ? { message: "bad binary", errorCode: "X" } : null, logFiles: [] } } } }) };
};
const clock = () => {
  let t = 0;
  return { now: () => t, sleep: async (ms) => void (t += ms) };
};

test("confirm marks only the uploads that finished, and reds the run for the rest", async () => {
  const written = [];
  const run = (env, statuses) =>
    confirm({
      env: { EXPO_TOKEN: "t", GITHUB_OUTPUT: "out", GITHUB_STEP_SUMMARY: "sum", DEADLINE_MINUTES: "5", ...env },
      fetchImpl: eas(statuses),
      ...clock(),
      write: (file, text) => written.push([file, text]),
      log: () => {},
    });
  const both = { IOS_UPLOAD: "success", IOS_SUBMISSION: IOS, ANDROID_UPLOAD: "success", ANDROID_SUBMISSION: ANDROID };
  assert.equal(await run(both, { [IOS]: "FINISHED", [ANDROID]: "FINISHED" }), 0);
  assert.deepEqual(written[0], ["out", "ios=true\nandroid=true\n"]);
  written.length = 0;
  assert.equal(await run(both, { [IOS]: "FINISHED", [ANDROID]: "ERRORED" }), 1);
  assert.deepEqual(written[0], ["out", "ios=true\nandroid=false\n"]);
  assert.match(written[1][1], /Android: the upload failed: bad binary/);
  written.length = 0;
  // Only the platform whose upload step succeeded is checked.
  assert.equal(await run({ IOS_UPLOAD: "failure", ANDROID_UPLOAD: "success", ANDROID_SUBMISSION: ANDROID }, { [ANDROID]: "FINISHED" }), 0);
  assert.deepEqual(written[0], ["out", "ios=false\nandroid=true\n"]);
  written.length = 0;
  // Accepted with no id: nothing checked it, so nothing is recorded.
  assert.equal(await run({ IOS_UPLOAD: "success", IOS_SUBMISSION: "" }, {}), 1);
  assert.deepEqual(written[0], ["out", "ios=false\nandroid=false\n"]);
  assert.equal(await run({ IOS_UPLOAD: "skipped", ANDROID_UPLOAD: "skipped" }, {}), 1);
  // Still queued at the deadline is not a finished upload.
  written.length = 0;
  assert.equal(await run({ IOS_UPLOAD: "success", IOS_SUBMISSION: IOS }, { [IOS]: "IN_QUEUE" }), 1);
  assert.deepEqual(written[0], ["out", "ios=false\nandroid=false\n"]);
  assert.match(describeRow({ store: "ios", id: IOS, status: "IN_QUEUE" }), /builds this platform again/);
});

test("the workflow records each binary under the name and lifetime the plan reads", () => {
  const workflow = readFileSync(new URL("../../../.github/workflows/staging-app.yml", import.meta.url), "utf8");
  const runtime = "${{ needs.plan.outputs.runtime }}";
  for (const platform of ["ios", "android"]) {
    assert.ok(workflow.includes(`name: ${markerName(platform, runtime)}\n`), platform);
  }
  const days = [...workflow.matchAll(/name: staging-app-[^\n]+\n(?:[^\n]+\n){2}\s+retention-days: (\d+)/g)].map((m) => Number(m[1]));
  assert.deepEqual(days, [MARKER_DAYS, MARKER_DAYS]);
  // Every job that names the token names the main-only environment.
  for (const job of workflow.split(/^  (?=[a-z]+:\n)/m).slice(1)) {
    if (job.includes("secrets.EXPO_TOKEN")) assert.match(job, /environment:\n\s+name: automation\n/, job.slice(0, 20));
  }
});
