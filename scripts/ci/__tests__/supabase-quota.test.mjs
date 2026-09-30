import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import {
  ALERT,
  DEFAULT_THRESHOLD_PERCENT,
  DISK_QUOTA_BYTES,
  STORAGE_QUOTA_BYTES,
  STORAGE_SIZE_SQL,
  evaluateUsage,
  exitCodeFor,
  formatBytes,
  parseThresholdPercent,
  readDiskBytes,
  readStorageBytes,
  runSupabaseQuota,
} from "../supabase-quota.mjs";
import { ALERT_ASSIGNEE, ALERT_LOOKUP_LABEL } from "../lib/alert-issue.mjs";

import { makeFetchMock, quiet } from "./helpers.mjs";
import { workflowJobs, workflowSteps } from "./helpers/workflow-yaml.mjs";

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const WORKFLOW = join(REPO_ROOT, ".github", "workflows", "supabase-quota.yml");

const ENVIRONMENTS = {
  staging: { supabaseProjectRef: "stagingref00000001", supabaseProjectName: "frapp-staging" },
  production: { supabaseProjectRef: "prodref0000000001", supabaseProjectName: "frapp-prod" },
};
const TOKENS = {
  SUPABASE_ACCESS_TOKEN_STAGING: "sbp_staging_token",
  SUPABASE_ACCESS_TOKEN_PRODUCTION: "sbp_production_token",
};
const REPO = "pdcarlson/Frapp";

function diskBody(usedBytes) {
  return { timestamp: "2026-09-30T08:15:00Z", metrics: { fs_size_bytes: 8.4e9, fs_avail_bytes: 8.4e9 - usedBytes, fs_used_bytes: usedBytes } };
}

/**
 * Management API routes for both projects, then the GitHub issue routes.
 * `openAlerts` are what the alert lookup returns.
 */
function supabaseRoutes({
  stagingDisk = 2e9,
  prodDisk = 1e9,
  stagingStorage = "1000",
  prodStorage = "0",
  stagingDiskStatus = 200,
  prodStorageStatus = 201,
  openAlerts = [],
} = {}) {
  return makeFetchMock([
    { method: "GET", path: "/v1/projects/stagingref00000001/config/disk/util", status: stagingDiskStatus, body: stagingDiskStatus === 200 ? diskBody(stagingDisk) : { message: "Forbidden resource" } },
    { method: "GET", path: "/v1/projects/prodref0000000001/config/disk/util", body: diskBody(prodDisk) },
    { method: "POST", path: "/v1/projects/stagingref00000001/database/query/read-only", status: 201, body: [{ bytes: stagingStorage }] },
    { method: "POST", path: "/v1/projects/prodref0000000001/database/query/read-only", status: prodStorageStatus, body: prodStorageStatus === 201 ? [{ bytes: prodStorage }] : { message: "Unauthorized" } },
    { method: "GET", path: `/repos/${REPO}/issues?state=all`, body: openAlerts },
    { method: "POST", path: `/repos/${REPO}/issues/`, status: 201, body: { id: 1 } },
    { method: "POST", path: `/repos/${REPO}/issues`, status: 201, body: { number: 99, assignees: [{ login: ALERT_ASSIGNEE }] } },
    { method: "PATCH", path: `/repos/${REPO}/issues/`, body: { number: 42, assignees: [{ login: ALERT_ASSIGNEE }] } },
  ]);
}

function run({ mock, threshold, env = TOKENS }) {
  return runSupabaseQuota({
    token: "gh-token",
    repo: REPO,
    env,
    fetchImpl: mock.fetchImpl,
    environments: ENVIRONMENTS,
    ...(threshold === undefined ? {} : { threshold }),
    writeSummary: () => {},
    logger: quiet,
    runUrl: "https://github.com/pdcarlson/Frapp/actions/runs/1",
  });
}

const issueCreates = (calls) => calls.filter((c) => c.method === "POST" && c.url.endsWith(`/repos/${REPO}/issues`));
const closes = (calls) =>
  calls.filter((c) => c.method === "PATCH" && c.body && JSON.parse(c.body).state === "closed");

describe("parseThresholdPercent", () => {
  it("defaults to 70% when unset or empty (a scheduled run passes an empty input)", () => {
    assert.equal(parseThresholdPercent(undefined), 0.7);
    assert.equal(parseThresholdPercent(""), 0.7);
    assert.equal(parseThresholdPercent("  "), 0.7);
    assert.equal(DEFAULT_THRESHOLD_PERCENT, 70);
  });

  it("accepts any lower threshold, down to 0", () => {
    assert.equal(parseThresholdPercent("70"), 0.7);
    assert.equal(parseThresholdPercent("50"), 0.5);
    assert.equal(parseThresholdPercent("0.5"), 0.005);
    assert.equal(parseThresholdPercent("0"), 0);
  });

  it("refuses a raised threshold, which could close an alert the default keeps open", () => {
    assert.throws(() => parseThresholdPercent("71"), /0 to 70/);
    assert.throws(() => parseThresholdPercent("100"), /0 to 70/);
  });

  it("refuses anything that is not a plain number", () => {
    for (const bad of ["-1", "abc", "70%", "1e1", "0x10", "NaN"]) {
      assert.throws(() => parseThresholdPercent(bad), /0 to 70/, bad);
    }
  });
});

describe("readDiskBytes", () => {
  it("reads fs_used_bytes from the disk utilization endpoint, with the project's token", async () => {
    const mock = makeFetchMock([{ method: "GET", path: "/config/disk/util", body: diskBody(3e9) }]);
    const result = await readDiskBytes({ projectRef: "stagingref00000001", token: "t", fetchImpl: mock.fetchImpl });
    assert.deepEqual(result, { ok: true, bytes: 3e9 });
    assert.equal(mock.calls[0].url, "https://api.supabase.com/v1/projects/stagingref00000001/config/disk/util");
  });

  it("is unread, without a request, when the project has no token", async () => {
    const mock = makeFetchMock([]);
    const result = await readDiskBytes({ projectRef: "stagingref00000001", token: "", fetchImpl: mock.fetchImpl });
    assert.equal(result.ok, false);
    assert.match(result.detail, /no Supabase access token/);
    assert.equal(mock.calls.length, 0);
  });

  it("is unread on a refusal, and says what the API said", async () => {
    const mock = makeFetchMock([{ method: "GET", path: "/config/disk/util", status: 403, body: { message: "Forbidden resource" } }]);
    const result = await readDiskBytes({ projectRef: "r", token: "t", fetchImpl: mock.fetchImpl });
    assert.deepEqual(result, { ok: false, detail: "Management API returned HTTP 403: Forbidden resource" });
  });

  it("is unread when the answer has no numeric fs_used_bytes, never zero", async () => {
    for (const body of [{}, { metrics: {} }, { metrics: { fs_used_bytes: "12" } }, { metrics: { fs_used_bytes: -1 } }]) {
      const mock = makeFetchMock([{ method: "GET", path: "/config/disk/util", body }]);
      const result = await readDiskBytes({ projectRef: "r", token: "t", fetchImpl: mock.fetchImpl });
      assert.equal(result.ok, false, JSON.stringify(body));
    }
  });

  it("is unread, not a crash, when every attempt throws", async () => {
    let attempts = 0;
    const fetchImpl = async () => {
      attempts += 1;
      throw new Error("socket hang up");
    };
    const result = await readDiskBytes({ projectRef: "r", token: "t", fetchImpl, sleep: async () => {} });
    assert.equal(result.ok, false);
    assert.match(result.detail, /socket hang up/);
    assert.equal(attempts, 3, "a read is retried like any other");
  });
});

describe("readStorageBytes", () => {
  it("sums storage.objects through the read-only query endpoint", async () => {
    const mock = makeFetchMock([{ method: "POST", path: "/database/query/read-only", status: 201, body: [{ bytes: "2850000000" }] }]);
    const result = await readStorageBytes({ projectRef: "stagingref00000001", token: "t", fetchImpl: mock.fetchImpl });
    assert.deepEqual(result, { ok: true, bytes: 2.85e9 });
    const call = mock.calls[0];
    assert.equal(call.url, "https://api.supabase.com/v1/projects/stagingref00000001/database/query/read-only");
    assert.deepEqual(JSON.parse(call.body), { query: STORAGE_SIZE_SQL });
  });

  it("asks only for a schema-qualified read", () => {
    assert.match(STORAGE_SIZE_SQL, /^select /);
    assert.match(STORAGE_SIZE_SQL, /from storage\.objects$/);
    assert.doesNotMatch(STORAGE_SIZE_SQL, /;/);
  });

  it("is unread when the rows are not one numeric `bytes`", async () => {
    for (const body of [[], [{ bytes: "1" }, { bytes: "2" }], [{ bytes: 12 }], [{ bytes: "-3" }], [{ total: "1" }], { bytes: "1" }]) {
      const mock = makeFetchMock([{ method: "POST", path: "/database/query/read-only", status: 201, body }]);
      const result = await readStorageBytes({ projectRef: "r", token: "t", fetchImpl: mock.fetchImpl });
      assert.equal(result.ok, false, JSON.stringify(body));
    }
  });
});

describe("evaluateUsage", () => {
  const projects = (overrides = {}) => [
    { name: "staging", projectName: "frapp-staging", disk: { ok: true, bytes: 1e9 }, storage: { ok: true, bytes: 30e9 }, ...overrides.staging },
    { name: "production", projectName: "frapp-prod", disk: { ok: true, bytes: 1e9 }, storage: { ok: true, bytes: 30e9 }, ...overrides.production },
  ];

  it("judges disk per project against 8 GB and storage across both projects against 100 GB", () => {
    assert.equal(DISK_QUOTA_BYTES, 8e9);
    assert.equal(STORAGE_QUOTA_BYTES, 100e9);
    const { rows, over, unread } = evaluateUsage({ projects: projects(), threshold: 0.7 });
    assert.deepEqual(
      rows.map((r) => [r.quota, r.scope, r.status]),
      [
        ["Disk", "frapp-staging", "ok"],
        ["Disk", "frapp-prod", "ok"],
        ["Storage", "organization (frapp-staging + frapp-prod)", "ok"],
      ],
    );
    assert.equal(rows[2].usedBytes, 60e9);
    assert.deepEqual([over.length, unread.length], [0, 0]);
  });

  it("counts a figure exactly at the threshold as over", () => {
    const { over } = evaluateUsage({ projects: projects({ production: { disk: { ok: true, bytes: 5.6e9 } } }), threshold: 0.7 });
    assert.deepEqual(over.map((r) => r.scope), ["frapp-prod"]);
  });

  it("finds the organization's storage over when neither project is over alone", () => {
    const { over } = evaluateUsage({
      projects: projects({ staging: { storage: { ok: true, bytes: 40e9 } }, production: { storage: { ok: true, bytes: 35e9 } } }),
      threshold: 0.7,
    });
    assert.deepEqual(over.map((r) => r.quota), ["Storage"]);
  });

  it("marks the organization's storage unread when either project's is, since a partial sum proves nothing", () => {
    const { rows, unread } = evaluateUsage({
      projects: projects({ production: { storage: { ok: false, detail: "Management API returned HTTP 401" } } }),
      threshold: 0.7,
    });
    assert.equal(rows[2].status, "unread");
    assert.match(unread[0].detail, /^frapp-prod: Management API returned HTTP 401$/);
  });
});

describe("runSupabaseQuota", () => {
  it("files nothing and exits 0 when every figure is read and under the threshold", async () => {
    const mock = supabaseRoutes();
    const result = await run({ mock });
    assert.equal(result.outcome, "ok");
    assert.deepEqual(result.alert, { action: "none", closed: [] });
    assert.equal(issueCreates(mock.calls).length, 0);
    assert.equal(exitCodeFor(result), 0);
  });

  it("reads each project with its own token", async () => {
    const mock = makeFetchMock([
      { method: "GET", path: "/config/disk/util", body: diskBody(1) },
      { method: "POST", path: "/database/query/read-only", status: 201, body: [{ bytes: "1" }] },
      { method: "GET", path: "/issues?state=all", body: [] },
    ]);
    const seen = [];
    const fetchImpl = async (url, init = {}) => {
      if (url.startsWith("https://api.supabase.com/")) seen.push([url.split("/")[5], init.headers.Authorization]);
      return mock.fetchImpl(url, init);
    };
    await runSupabaseQuota({ token: "g", repo: REPO, env: TOKENS, fetchImpl, environments: ENVIRONMENTS, writeSummary: () => {}, logger: quiet });
    assert.deepEqual([...new Set(seen.map((s) => s.join(" ")))], [
      "stagingref00000001 Bearer sbp_staging_token",
      "prodref0000000001 Bearer sbp_production_token",
    ]);
  });

  it("lowering the threshold in a test run produces a page (#2531 acceptance criterion 1)", async () => {
    const atDefault = supabaseRoutes();
    assert.equal((await run({ mock: atDefault })).outcome, "ok");
    assert.equal(issueCreates(atDefault.calls).length, 0);

    // The same readings, with the workflow's dispatch input at 0.
    const lowered = supabaseRoutes();
    const result = await run({ mock: lowered, threshold: parseThresholdPercent("0") });
    assert.equal(result.outcome, "alert");
    assert.equal(result.alert.action, "created");
    assert.equal(exitCodeFor(result), 1);

    const [create] = issueCreates(lowered.calls);
    const body = JSON.parse(create.body);
    assert.equal(body.title, ALERT.title);
    assert.deepEqual(body.assignees, [ALERT_ASSIGNEE]);
    assert.ok(body.labels.includes(ALERT_LOOKUP_LABEL));
    assert.match(body.body, /Threshold: \*\*0%\*\* of each quota, lowered for this run/);
  });

  it("raises the alert when a figure is over, and names it", async () => {
    const mock = supabaseRoutes({ stagingDisk: 6e9 });
    const result = await run({ mock });
    assert.equal(result.outcome, "alert");
    const body = JSON.parse(issueCreates(mock.calls)[0].body).body;
    assert.match(body, /\| Disk \| frapp-staging \| 6\.00 GB of 8\.00 GB \(75\.0%\) \| \*\*over\*\* \|/);
    assert.match(body, /restricts \*\*every\*\* project/);
  });

  it("raises the alert when a figure can't be read, rather than passing on what it could", async () => {
    const mock = supabaseRoutes({ stagingDiskStatus: 403 });
    const result = await run({ mock });
    assert.equal(result.outcome, "alert");
    const body = JSON.parse(issueCreates(mock.calls)[0].body).body;
    assert.match(body, /could not be read \(Management API returned HTTP 403: Forbidden resource\)/);
  });

  it("treats a missing token as unreadable, so a project can't drop out of the watch", async () => {
    const mock = supabaseRoutes();
    const result = await run({ mock, env: { SUPABASE_ACCESS_TOKEN_STAGING: "sbp_staging_token" } });
    assert.equal(result.outcome, "alert");
    assert.deepEqual(
      result.rows.filter((r) => r.status === "unread").map((r) => r.quota),
      ["Disk", "Storage"],
    );
    assert.ok(!mock.calls.some((c) => c.url.includes("prodref0000000001")), "no request without a token");
  });

  it("comments on an alert that is already open instead of filing a second", async () => {
    const open = [{ number: 42, title: ALERT.title, state: "open", assignees: [], labels: [{ name: ALERT_LOOKUP_LABEL }] }];
    const mock = supabaseRoutes({ prodStorageStatus: 401, openAlerts: open });
    const result = await run({ mock });
    assert.deepEqual(result.alert, { action: "commented", issueNumber: 42 });
    assert.equal(issueCreates(mock.calls).length, 0);
    assert.equal(closes(mock.calls).length, 0);
  });

  it("closes an open alert once every figure is read and under the threshold", async () => {
    const open = [{ number: 42, title: ALERT.title, state: "open", assignees: [], labels: [{ name: ALERT_LOOKUP_LABEL }] }];
    const mock = supabaseRoutes({ openAlerts: open });
    const result = await run({ mock });
    assert.deepEqual(result.alert, { action: "closed", closed: [42] });
    assert.equal(closes(mock.calls).length, 1);
    const recovery = mock.calls.find((c) => c.method === "POST" && c.url.endsWith("/issues/42/comments"));
    assert.match(JSON.parse(recovery.body).body, /^\*\*Recovered\.\*\*/);
    assert.equal(exitCodeFor(result), 0);
  });

  it("reds the run when it can't tell whether an alert is open", async () => {
    const mock = makeFetchMock([
      { method: "GET", path: "/config/disk/util", body: diskBody(1) },
      { method: "POST", path: "/database/query/read-only", status: 201, body: [{ bytes: "1" }] },
      { method: "GET", path: "/issues?state=all", status: 403, body: {} },
    ]);
    const result = await run({ mock });
    assert.equal(result.alert.action, "unread");
    assert.equal(exitCodeFor(result), 1);
  });
});

describe("formatBytes", () => {
  it("prints decimal units, as Supabase's quotas are written", () => {
    assert.equal(formatBytes(8e9), "8.00 GB");
    assert.equal(formatBytes(490068), "490.1 KB");
    assert.equal(formatBytes(213184689), "213.2 MB");
    assert.equal(formatBytes(0), "0 B");
  });
});

describe("supabase-quota.yml", () => {
  const text = readFileSync(WORKFLOW, "utf8");
  const code = text
    .split("\n")
    .filter((line) => !/^\s*#/.test(line))
    .join("\n");

  it("runs daily at 08:15 UTC and on dispatch, never on a pull request", () => {
    assert.match(code, /cron: "15 8 \* \* \*"/);
    assert.match(code, /workflow_dispatch:/);
    assert.doesNotMatch(code, /pull_request/);
  });

  it("names the main-only automation environment, never production, and writes only issues", () => {
    const jobs = workflowJobs(WORKFLOW);
    assert.deepEqual(jobs.map((j) => j.jobId), ["quota"]);
    const { keys } = jobs[0];
    assert.deepEqual(Object.fromEntries(keys.get("environment")), { name: "automation", deployment: "false" });
    assert.deepEqual(Object.fromEntries(keys.get("permissions")), { contents: "read", issues: "write" });
    assert.doesNotMatch(code, /environment:\s*["']?production/);
  });

  it("injects staging then prod, and hands the script each project's token by name", () => {
    const steps = workflowSteps(WORKFLOW);
    const names = steps.map((s) => s.name);
    assert.deepEqual(names, [
      "Checkout",
      "Setup Node",
      "Inject staging secrets from Infisical",
      "Keep the staging token",
      "Inject production secrets from Infisical",
      "Keep the production token",
      "Check Supabase quotas",
    ]);
    const keepProduction = steps.find((s) => s.name === "Keep the production token").body;
    assert.match(keepProduction, /echo "SUPABASE_ACCESS_TOKEN_PRODUCTION=\$SUPABASE_ACCESS_TOKEN" >> "\$GITHUB_ENV"/);
    assert.match(keepProduction, /echo "SUPABASE_ACCESS_TOKEN=" >> "\$GITHUB_ENV"/);
    // A missing token is the script's to report, as an unreadable project.
    for (const name of ["Keep the staging token", "Keep the production token"]) {
      assert.doesNotMatch(steps.find((s) => s.name === name).body, /exit 1/, name);
    }
  });

  it("passes the dispatch threshold through env, never into the shell", () => {
    const check = workflowSteps(WORKFLOW).find((s) => s.name === "Check Supabase quotas");
    assert.equal(check.env.get("SUPABASE_QUOTA_THRESHOLD_PERCENT"), "${{ inputs.threshold_percent }}");
    assert.match(check.body, /run: node scripts\/ci\/supabase-quota\.mjs$/);
    assert.doesNotMatch(check.body, /run:[^\n]*\$\{\{/);
  });

  it("defaults the dispatch input to the script's default threshold", () => {
    assert.match(code, new RegExp(`threshold_percent:[\\s\\S]*?default: "${DEFAULT_THRESHOLD_PERCENT}"`));
  });
});
