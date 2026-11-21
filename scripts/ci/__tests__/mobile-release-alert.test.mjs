import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import {
  ALERT_CONFIGS,
  PRODUCTION_MOBILE_CONFIG,
  STAGING_APP_CONFIG,
  buildIssueBody,
  classify,
  exitCodeFor,
  main,
  marker,
  readFailedSteps,
  runAlert,
} from "../mobile-release-alert.mjs";

import { makeFetchMock, quiet } from "./helpers.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");

const needsOf = (results) => Object.fromEntries(Object.entries(results).map(([job, result]) => [job, { result, outputs: {} }]));

// The run that went unheard on 2026-11-17: the update published, iOS failed on the signing profile.
const IOS_FAILED = needsOf({ plan: "success", update: "success", ios: "failure", android: "skipped", confirm: "skipped" });
const ALL_GREEN = needsOf({ plan: "success", update: "success", ios: "skipped", android: "skipped", confirm: "skipped" });

const JOBS = {
  jobs: [
    { name: "Decide which binaries this tree needs", conclusion: "success", steps: [] },
    {
      name: "Build Frapp Staging for iOS and send it to TestFlight",
      conclusion: "failure",
      html_url: "https://github.com/o/r/actions/runs/1/job/2",
      steps: [
        { name: "Build (Release, signed with EAS's credentials)", conclusion: "failure" },
        { name: "Upload", conclusion: "skipped" },
      ],
    },
  ],
};

function github({ issues = [], lookupStatus = 200 } = {}) {
  return makeFetchMock([
    { method: "GET", path: "/issues?state=all", status: lookupStatus, body: issues },
    { method: "GET", path: "/actions/runs/", body: JOBS },
    { method: "POST", path: "/comments", body: {} },
    { method: "POST", path: "/issues", body: { number: 77, assignees: [{ login: "pdcarlson" }] } },
    { method: "PATCH", path: "/issues/", body: { assignees: [{ login: "pdcarlson" }] } },
  ]);
}

const base = { token: "t", repo: "o/r", writeSummary: () => {}, logger: quiet, runId: "1", attempt: "1" };

test("classify: a skipped gate job is no run, whatever else happened", () => {
  const needs = needsOf({ plan: "skipped", update: "skipped", ios: "skipped", android: "skipped", confirm: "skipped" });
  assert.equal(classify(STAGING_APP_CONFIG, needs, "auto").verdict, "no-run");
});

test("classify: any failed job fails the run, and names it", () => {
  const classified = classify(STAGING_APP_CONFIG, IOS_FAILED, "auto");
  assert.equal(classified.verdict, "failed");
  assert.deepEqual(classified.failed, ["ios"]);
});

test("classify: only an all-green auto run proves recovery", () => {
  assert.equal(classify(STAGING_APP_CONFIG, ALL_GREEN, "auto").verdict, "recovered");
  // `none` publishes the update only: a platform that still can't build was never tried.
  assert.equal(classify(STAGING_APP_CONFIG, ALL_GREEN, "none").verdict, "unproven");
  assert.equal(classify(STAGING_APP_CONFIG, ALL_GREEN, "android").verdict, "unproven");
  const cancelled = needsOf({ plan: "success", update: "cancelled", ios: "skipped", android: "skipped", confirm: "skipped" });
  assert.equal(classify(STAGING_APP_CONFIG, cancelled, "auto").verdict, "unproven");
});

test("classify: production reads mobile-plan, mobile and ota", () => {
  const failed = needsOf({ validate: "success", "mobile-plan": "success", mobile: "failure", ota: "skipped" });
  assert.deepEqual(classify(PRODUCTION_MOBILE_CONFIG, failed, "auto").failed, ["mobile"]);
  const none = needsOf({ validate: "success", "mobile-plan": "skipped", mobile: "skipped", ota: "skipped" });
  assert.equal(classify(PRODUCTION_MOBILE_CONFIG, none, "none").verdict, "no-run");
});

test("a failed run files an alert naming the failed job, step, commit and runtime", async () => {
  const gh = github();
  const result = await runAlert({
    ...base,
    config: STAGING_APP_CONFIG,
    needs: IOS_FAILED,
    build: "auto",
    runtime: "0.14.0-8e51498d9db9",
    sha: "198f2c9",
    runUrl: "https://github.com/o/r/actions/runs/1",
    fetchImpl: gh.fetchImpl,
  });
  assert.equal(result.alert.action, "created");
  const created = gh.calls.find((c) => c.method === "POST" && c.url.endsWith("/issues"));
  const body = JSON.parse(created.body);
  assert.equal(body.title, STAGING_APP_CONFIG.alert.title);
  assert.deepEqual(body.assignees, ["pdcarlson"]);
  assert.match(body.body, /`ios`: could not build Frapp Staging for iOS/);
  assert.match(body.body, /"Build \(Release, signed with EAS's credentials\)"/);
  assert.match(body.body, /0\.14\.0-8e51498d9db9/);
  assert.match(body.body, /<!-- mobile-release-failing: ios @0\.14\.0-8e51498d9db9 -->/);
  assert.equal(exitCodeFor(result), 0);
});

test("the same failure on the next merge stays quiet: one email per change", async () => {
  const classified = classify(STAGING_APP_CONFIG, IOS_FAILED, "auto");
  const open = { number: 77, state: "open", title: STAGING_APP_CONFIG.alert.title, body: `x\n${marker(classified, "rt1")}` };
  const gh = github({ issues: [open] });
  const result = await runAlert({ ...base, config: STAGING_APP_CONFIG, needs: IOS_FAILED, build: "auto", runtime: "rt1", fetchImpl: gh.fetchImpl });
  assert.deepEqual(result.alert, { action: "unchanged", issueNumber: 77 });
  assert.equal(gh.calls.some((c) => c.method !== "GET"), false);
});

test("a different failure comments on the open alert", async () => {
  const classified = classify(STAGING_APP_CONFIG, IOS_FAILED, "auto");
  const open = { number: 77, state: "open", title: STAGING_APP_CONFIG.alert.title, body: `x\n${marker(classified, "rt1")}` };
  const gh = github({ issues: [open] });
  const result = await runAlert({ ...base, config: STAGING_APP_CONFIG, needs: IOS_FAILED, build: "auto", runtime: "rt2", fetchImpl: gh.fetchImpl });
  assert.equal(result.alert.action, "commented");
});

test("an unreadable lookup still raises: silence is the failure this exists for", async () => {
  const gh = github({ lookupStatus: 500 });
  const result = await runAlert({ ...base, config: STAGING_APP_CONFIG, needs: IOS_FAILED, build: "auto", fetchImpl: gh.fetchImpl });
  assert.equal(result.alert.action, "created");
});

test("an all-green auto run closes the open alert", async () => {
  const open = { number: 77, state: "open", title: STAGING_APP_CONFIG.alert.title, body: "x" };
  const gh = github({ issues: [open] });
  const result = await runAlert({ ...base, config: STAGING_APP_CONFIG, needs: ALL_GREEN, build: "auto", fetchImpl: gh.fetchImpl });
  assert.equal(result.verdict, "recovered");
  assert.equal(result.alert.action, "closed");
});

test("no run and unproven runs touch no issue", async () => {
  for (const build of ["none", "ios"]) {
    const gh = github();
    const result = await runAlert({ ...base, config: STAGING_APP_CONFIG, needs: ALL_GREEN, build, fetchImpl: gh.fetchImpl });
    assert.equal(result.alert.action, "none");
    assert.equal(gh.calls.length, 0);
  }
});

test("readFailedSteps returns [] when the jobs can't be read", async () => {
  const gh = makeFetchMock([{ method: "GET", path: "/actions/runs/", status: 403, body: {} }]);
  assert.deepEqual(await readFailedSteps({ token: "t", repo: "o/r", runId: "1", attempt: "1", fetchImpl: gh.fetchImpl, }), []);
});

test("buildIssueBody points at the doc that has the fix", () => {
  const body = buildIssueBody(STAGING_APP_CONFIG, classify(STAGING_APP_CONFIG, IOS_FAILED, "auto"));
  assert.match(body, /eas -- credentials --platform ios/);
  assert.match(body, /docs\/ops\/deployment\/mobile\.md/);
});

test("main refuses an unknown or missing ALERT_CONFIG", async () => {
  await assert.rejects(main({ env: { GITHUB_TOKEN: "t", GITHUB_REPOSITORY: "o/r", NEEDS: "{}" } }), /ALERT_CONFIG/);
  await assert.rejects(main({ env: { ALERT_CONFIG: "nope", GITHUB_TOKEN: "t", GITHUB_REPOSITORY: "o/r", NEEDS: "{}" } }), /ALERT_CONFIG/);
});

test("each workflow's alert job names its config and needs every job the config reads", () => {
  const files = {
    "staging-app": { file: ".github/workflows/staging-app.yml", job: "alert" },
    "production-mobile": { file: ".github/workflows/deploy-production.yml", job: "mobile-outcome" },
  };
  for (const [name, { file, job }] of Object.entries(files)) {
    const config = ALERT_CONFIGS[name];
    assert.equal(config.workflowFile, file);
    const source = readFileSync(join(ROOT, file), "utf8");
    const start = source.indexOf(`\n  ${job}:\n`);
    assert.ok(start >= 0, `${file} has a ${job} job`);
    const next = source.slice(start + 1).search(/\n {2}[a-z][a-z-]*:\n/);
    const block = next >= 0 ? source.slice(start, start + 1 + next) : source.slice(start);
    assert.match(block, new RegExp(`ALERT_CONFIG: ${name}\\b`));
    assert.match(block, /node scripts\/ci\/mobile-release-alert\.mjs/);
    assert.match(block, /issues: write/);
    const needs = block.match(/needs: \[([^\]]+)\]/)[1].split(",").map((s) => s.trim());
    for (const read of Object.keys(config.jobs)) assert.ok(needs.includes(read), `${job} needs ${read}`);
  }
});
