import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import {
  AUDIT_ALERT,
  EXPIRY_ALERT,
  EXPIRY_WARNING_DAYS,
  addDays,
  buildAuditIssueBody,
  buildExpiryIssueBody,
  classifyGate,
  exitCodeFor,
  expiringEntries,
  expiryMarker,
  main,
  markerIn,
  outputTail,
  runExpiryWatch,
  runNpmAuditWatch,
} from "../npm-audit-watch.mjs";
import { ALERT_LOOKUP_LABEL } from "../lib/alert-issue.mjs";
import { makeFetchMock, quiet } from "./helpers.mjs";
import { workflowJobs, workflowSteps } from "./helpers/workflow-yaml.mjs";

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const WORKFLOW = join(REPO_ROOT, ".github", "workflows", "npm-audit-watch.yml");
const REPO = "pdcarlson/Frapp";
const NOW = new Date("2026-11-06T08:30:00Z");
const TODAY = "2026-11-06";

function entry(ghsa, expires, extra = {}) {
  return {
    ghsa,
    expires,
    reason: "no fix published at any version yet",
    trackedBy: "#2329",
    ...extra,
  };
}

const FAR = entry("GHSA-aaaa-bbbb-cccc", "2026-12-15", { package: "far-pkg" });
const SOON = entry("GHSA-dddd-eeee-ffff", "2026-11-10", { package: "soon-pkg" });

/** GitHub routes; `issues` is what every alert lookup returns. */
function github({ issues = [], lookupStatus = 200 } = {}) {
  return makeFetchMock([
    { method: "GET", path: `/repos/${REPO}/issues?state=all`, status: lookupStatus, body: issues },
    { method: "POST", path: `/repos/${REPO}/issues/`, status: 201, body: { id: 1 } },
    { method: "POST", path: `/repos/${REPO}/issues`, status: 201, body: { number: 99, assignees: [{ login: "pdcarlson" }] } },
    { method: "PATCH", path: `/repos/${REPO}/issues/`, body: { number: 42, assignees: [{ login: "pdcarlson" }] } },
  ]);
}

function openIssue(alert, number, body = "") {
  return { number, title: alert.title, state: "open", body, labels: [{ name: ALERT_LOOKUP_LABEL }], assignees: [] };
}

function created(mock) {
  return mock.calls
    .filter((c) => c.method === "POST" && c.url.endsWith(`/repos/${REPO}/issues`))
    .map((c) => JSON.parse(c.body));
}

function closedNumbers(mock) {
  return mock.calls
    .filter((c) => c.method === "PATCH" && c.body && JSON.parse(c.body).state === "closed")
    .map((c) => Number(c.url.split("/").pop()));
}

function watch({ mock, status = 0, stdout = "npm audit: ok", stderr = "", entries = [FAR] }) {
  return runNpmAuditWatch({
    token: "gh-token",
    repo: REPO,
    fetchImpl: mock.fetchImpl,
    gate: () => ({ status, stdout, stderr }),
    readAllowlist: () => entries,
    now: NOW,
    runUrl: "https://github.com/pdcarlson/Frapp/actions/runs/1",
    writeSummary: () => {},
    logger: quiet,
  });
}

describe("classifyGate", () => {
  it("reads the gate's exit codes with the gate's own meaning", () => {
    assert.equal(classifyGate(0), "passed");
    assert.equal(classifyGate(1), "failed");
    assert.equal(classifyGate(2), "no-verdict");
  });

  it("treats a signal or a spawn failure as no verdict, never as a pass", () => {
    assert.equal(classifyGate(null), "no-verdict");
    assert.equal(classifyGate(137), "no-verdict");
  });
});

describe("outputTail", () => {
  it("keeps the last lines of stdout then stderr, and says how many it dropped", () => {
    const stdout = Array.from({ length: 70 }, (_, i) => `out ${i}`).join("\n");
    const tail = outputTail({ stdout, stderr: "err last" }, 10);
    const lines = tail.split("\n");
    assert.equal(lines[0], "… 61 earlier lines in the run log");
    assert.equal(lines.at(-1), "err last");
    assert.equal(lines.length, 11);
  });

  it("cannot close the alert's code fence early", () => {
    assert.doesNotMatch(outputTail({ stdout: "a ``` b", stderr: "" }), /```/);
  });
});

describe("expiringEntries", () => {
  it("lists entries due on or before today plus the window, soonest first", () => {
    const edge = entry("GHSA-gggg-hhhh-jjjj", addDays(TODAY, EXPIRY_WARNING_DAYS));
    const past = entry("GHSA-kkkk-mmmm-nnnn", "2026-11-01");
    const beyond = entry("GHSA-pppp-qqqq-rrrr", addDays(TODAY, EXPIRY_WARNING_DAYS + 1));
    const result = expiringEntries({ entries: [beyond, edge, FAR, SOON, past], today: TODAY });
    assert.deepEqual(
      result.map((e) => e.ghsa),
      [past.ghsa, SOON.ghsa, edge.ghsa],
    );
  });

  it("adds days across a month and a year", () => {
    assert.equal(addDays("2026-11-28", 7), "2026-12-05");
    assert.equal(addDays("2026-12-28", 7), "2027-01-04");
  });
});

describe("expiry marker", () => {
  it("names each entry and its date, so a renewal reads as a change", () => {
    const before = expiryMarker([SOON]);
    const renewed = expiryMarker([{ ...SOON, expires: "2026-11-12" }]);
    assert.notEqual(before, renewed);
    assert.equal(markerIn(buildExpiryIssueBody({ expiring: [SOON], today: TODAY, runUrl: "" })), before);
  });

  it("reads the marker back from a body the web UI saved with CRLF line endings", () => {
    const body = buildExpiryIssueBody({ expiring: [SOON], today: TODAY, runUrl: "" }).replaceAll("\n", "\r\n");
    assert.equal(markerIn(`${body}\r\n\r\n---\r\n_agent note_`), expiryMarker([SOON]));
  });

  it("finds no marker in a body without one", () => {
    assert.equal(markerIn("plain body"), null);
    assert.equal(markerIn(null), null);
  });
});

describe("runNpmAuditWatch: the audit alert", () => {
  it("closes an open audit alert when the gate passes, and exits 0", async () => {
    const mock = github({ issues: [openIssue(AUDIT_ALERT, 42)] });
    const result = await watch({ mock, status: 0 });
    assert.equal(result.audit.action, "closed");
    assert.deepEqual(closedNumbers(mock), [42]);
    assert.equal(exitCodeFor(result), 0);
  });

  it("files one alert with the gate's output when it finds something, and exits 1", async () => {
    const mock = github();
    const result = await watch({ mock, status: 1, stderr: "❌ Unallowlisted HIGH/CRITICAL advisories (1):\n  - GHSA-xxxx" });
    assert.equal(result.verdict, "failed");
    assert.equal(result.audit.action, "created");
    const [issue] = created(mock);
    assert.equal(issue.title, AUDIT_ALERT.title);
    assert.ok(issue.labels.includes(ALERT_LOOKUP_LABEL));
    assert.match(issue.body, /Unallowlisted HIGH\/CRITICAL/);
    assert.equal(exitCodeFor(result), 1);
  });

  it("raises the alert on no verdict too, and says nothing is known", async () => {
    const mock = github();
    const result = await watch({ mock, status: 2, stderr: "npm audit gate: registry unreachable" });
    assert.equal(result.verdict, "no-verdict");
    const [issue] = created(mock);
    assert.match(issue.body, /no verdict/);
    assert.equal(exitCodeFor(result), 1);
  });

  it("comments on the open alert rather than filing a second", async () => {
    const mock = github({ issues: [openIssue(AUDIT_ALERT, 42)] });
    const result = await watch({ mock, status: 1 });
    assert.equal(result.audit.action, "commented");
    assert.equal(created(mock).length, 0);
  });

  it("exits 1 when the gate passes but the alerts can't be read", async () => {
    const mock = github({ lookupStatus: 500 });
    const result = await watch({ mock, status: 0 });
    assert.equal(result.audit.action, "unread");
    assert.equal(exitCodeFor(result), 1);
  });
});

describe("runExpiryWatch", () => {
  const run = (mock, entries) =>
    runExpiryWatch({
      token: "gh-token",
      repo: REPO,
      fetchImpl: mock.fetchImpl,
      today: TODAY,
      runUrl: "",
      readAllowlist: () => entries,
      logger: quiet,
    });

  it("files the warning when an entry is inside the window", async () => {
    const mock = github();
    const result = await run(mock, [FAR, SOON]);
    assert.equal(result.action, "created");
    const [issue] = created(mock);
    assert.equal(issue.title, EXPIRY_ALERT.title);
    assert.match(issue.body, /GHSA-dddd-eeee-ffff/);
    assert.doesNotMatch(issue.body, /GHSA-aaaa-bbbb-cccc/);
  });

  it("stays quiet when the open warning already lists exactly these entries", async () => {
    const body = buildExpiryIssueBody({ expiring: [SOON], today: TODAY, runUrl: "" });
    const mock = github({ issues: [openIssue(EXPIRY_ALERT, 7, body)] });
    const result = await run(mock, [FAR, SOON]);
    assert.equal(result.action, "unchanged");
    assert.equal(mock.calls.filter((c) => c.method !== "GET").length, 0);
  });

  it("comments, and rewrites the body, when the set changes", async () => {
    const body = buildExpiryIssueBody({ expiring: [SOON], today: TODAY, runUrl: "" });
    const another = entry("GHSA-ssss-tttt-vvvv", "2026-11-08");
    const mock = github({ issues: [openIssue(EXPIRY_ALERT, 7, body)] });
    const result = await run(mock, [FAR, SOON, another]);
    assert.equal(result.action, "commented");
    const patch = mock.calls.find((c) => c.method === "PATCH");
    assert.equal(markerIn(JSON.parse(patch.body).body), expiryMarker([another, SOON]));
  });

  it("touches nothing when the alerts can't be read, so it never claims a change it can't see", async () => {
    const mock = github({ lookupStatus: 500 });
    const result = await run(mock, [FAR, SOON]);
    assert.equal(result.action, "unread");
    assert.equal(mock.calls.filter((c) => c.method !== "GET").length, 0);
  });

  it("code-formats a package name, so a scoped one is not an @-mention", async () => {
    const mock = github();
    await run(mock, [entry("GHSA-wwww-xxxx-cccc", "2026-11-09", { package: "@scope/pkg" })]);
    assert.match(created(mock)[0].body, /\(`@scope\/pkg`\)/);
  });

  it("names its window in its title, which can't be derived because it is the lookup key", () => {
    assert.match(EXPIRY_ALERT.title, new RegExp(`within ${EXPIRY_WARNING_DAYS} days`));
  });

  it("closes the warning when nothing is inside the window", async () => {
    const mock = github({ issues: [openIssue(EXPIRY_ALERT, 7)] });
    const result = await run(mock, [FAR]);
    assert.equal(result.action, "closed");
    assert.deepEqual(closedNumbers(mock), [7]);
  });

  it("skips a malformed allowlist, which the gate itself fails on", async () => {
    const mock = github();
    assert.equal((await run(mock, [{ ghsa: "nope" }])).action, "skipped");
    assert.equal(mock.calls.length, 0);
  });

  it("never reds the run on its own: a raised warning still exits 0 when the gate passes", async () => {
    const mock = github();
    const result = await watch({ mock, status: 0, entries: [SOON] });
    assert.equal(result.expiry.action, "created");
    assert.equal(exitCodeFor(result), 0);
  });
});

describe("exitCodeFor", () => {
  const passed = { verdict: "passed", audit: { action: "none" } };

  it("exits 1 when the gate passes but the expiry alert could not be written or read", () => {
    assert.equal(exitCodeFor({ ...passed, expiry: { action: "failed" } }), 1);
    assert.equal(exitCodeFor({ ...passed, expiry: { action: "unread" } }), 1);
  });

  it("exits 0 for every other expiry outcome when the gate passes", () => {
    for (const action of ["none", "closed", "created", "commented", "reopened", "unchanged", "skipped"]) {
      assert.equal(exitCodeFor({ ...passed, expiry: { action } }), 0, action);
    }
  });
});

describe("main", () => {
  it("hands the run its token, repo and run link", async () => {
    let seen;
    const code = await main({
      env: { GITHUB_TOKEN: "t", GITHUB_REPOSITORY: REPO, RUN_URL: "https://run" },
      run: async (args) => {
        seen = args;
        return { verdict: "passed", audit: { action: "none" }, expiry: { action: "none" } };
      },
    });
    assert.equal(code, 0);
    assert.deepEqual(seen, { token: "t", repo: REPO, runUrl: "https://run" });
  });
});

describe("the alert bodies", () => {
  it("point at the policy doc and the gate the PRs run", () => {
    const body = buildAuditIssueBody({ verdict: "failed", gate: { stdout: "", stderr: "x" }, runUrl: "" });
    assert.match(body, /docs\/security\/security-fixes\.md/);
    assert.match(body, /scripts\/check-npm-audit\.mjs/);
  });
});

describe("npm-audit-watch.yml", () => {
  const code = readFileSync(WORKFLOW, "utf8");

  it("runs daily and on dispatch, one run at a time", () => {
    assert.match(code, /schedule:\n\s+# [^\n]*\n(?:\s+#[^\n]*\n)*\s+- cron: "30 8 \* \* \*"/);
    assert.match(code, /workflow_dispatch:/);
    assert.match(code, /cancel-in-progress: false/);
  });

  it("runs only on main, so a dispatch from a branch can't open or close the alerts about main", () => {
    const [job] = workflowJobs(WORKFLOW);
    assert.equal(job.keys.get("if"), "github.ref == 'refs/heads/main'");
  });

  it("has one job, bounded, with issues: write as its only write scope", () => {
    const jobs = workflowJobs(WORKFLOW);
    assert.deepEqual(jobs.map((j) => j.jobId), ["audit"]);
    const { keys } = jobs[0];
    assert.deepEqual(Object.fromEntries(keys.get("permissions")), { contents: "read", issues: "write" });
    assert.equal(keys.get("timeout-minutes"), "20");
    assert.doesNotMatch(code, /environment:/);
  });

  it("runs the watch script, with no expression inside the run line", () => {
    const steps = workflowSteps(WORKFLOW);
    assert.deepEqual(
      steps.map((s) => s.name),
      ["Checkout", "Setup Node", "Audit main and update the alerts"],
    );
    const audit = steps.at(-1);
    assert.match(audit.body, /run: node scripts\/ci\/npm-audit-watch\.mjs$/);
    assert.doesNotMatch(audit.body, /run:[^\n]*\$\{\{/);
  });
});
