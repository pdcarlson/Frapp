import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import {
  ALERT,
  OFFSET_DAYS,
  SUITES,
  checkShift,
  classify,
  exitCodeFor,
  failureKey,
  failuresFromReport,
  main,
  marker,
  runAlert,
  runSuites,
} from "../clock-ahead-tests.mjs";
import { ALERT_LOOKUP_LABEL } from "../lib/alert-issue.mjs";
import { makeFetchMock, quiet } from "./helpers.mjs";
import { workflowJobs } from "./helpers/workflow-yaml.mjs";

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const WORKFLOW = join(REPO_ROOT, ".github", "workflows", "clock-ahead-tests.yml");
const REPO = "pdcarlson/Frapp";
const DAY_MS = 86_400_000;

const passing = (script) => ({ name: script, script, status: 0, tests: 10, failures: [], failureCount: 0, tail: "" });
const SWEEP_FAIL = {
  name: "API unit tests",
  script: "test",
  status: 1,
  tests: 10,
  failures: [{ file: "apps/api/src/sweep.spec.ts", test: "sweep sends the row" }],
  failureCount: 1,
  tail: "",
};

function result(suites, extra = {}) {
  return JSON.stringify({ offsetDays: OFFSET_DAYS, shiftOk: true, shiftedTo: "2026-11-21T05:30:00.000Z", suites, ...extra });
}

const PASSED = result([passing("test"), passing("test:e2e")]);
const FAILED = result([SWEEP_FAIL, passing("test:e2e")]);

function github({ issues = [], lookupStatus = 200 } = {}) {
  return makeFetchMock([
    { method: "GET", path: `/repos/${REPO}/issues?state=all`, status: lookupStatus, body: issues },
    { method: "POST", path: `/repos/${REPO}/issues/`, status: 201, body: { id: 1 } },
    { method: "POST", path: `/repos/${REPO}/issues`, status: 201, body: { number: 99, assignees: [{ login: "pdcarlson" }] } },
    { method: "PATCH", path: `/repos/${REPO}/issues/`, body: { number: 42, assignees: [{ login: "pdcarlson" }] } },
  ]);
}

function openIssue(number, body = "") {
  return { number, title: ALERT.title, state: "open", body, labels: [{ name: ALERT_LOOKUP_LABEL }], assignees: [] };
}

const alertArgs = (gh, raw) => ({ token: "t", repo: REPO, raw, fetchImpl: gh.fetchImpl, writeSummary: () => {}, logger: quiet });
const posts = (gh) => gh.calls.filter((c) => c.method === "POST");

describe("clock-ahead-tests: the clock shift", () => {
  it("runs the suites PR CI's api-tests job runs, a week ahead", () => {
    assert.equal(OFFSET_DAYS, 7);
    assert.deepEqual(
      SUITES.map((s) => s.script),
      ["test", "test:e2e"],
    );
    const ci = readFileSync(join(REPO_ROOT, ".github", "workflows", "ci.yml"), "utf8");
    for (const { script } of SUITES) assert.match(ci, new RegExp(`npm run ${script} -w apps/api`));
  });

  it("accepts a process that sees the clock a week ahead", () => {
    const now = Date.parse("2026-11-14T05:30:00Z");
    const spawn = () => ({ status: 0, stdout: String(now + OFFSET_DAYS * DAY_MS + 50), stderr: "" });
    const shift = checkShift({ spawn, now: () => now });
    assert.equal(shift.ok, true);
    assert.equal(shift.shiftedTo, "2026-11-21T05:30:00.050Z");
  });

  it("refuses a clock that did not move, so a rerun at today's date can't pass for the real thing", () => {
    const now = Date.parse("2026-11-14T05:30:00Z");
    const shift = checkShift({ spawn: () => ({ status: 0, stdout: String(now), stderr: "" }), now: () => now });
    assert.equal(shift.ok, false);
    assert.match(shift.detail, /0\.0 hours, not 168/);
  });

  it("refuses when faketime itself is missing", () => {
    const shift = checkShift({ spawn: () => ({ status: null, stdout: "", stderr: "", error: new Error("ENOENT") }) });
    assert.equal(shift.ok, false);
    assert.match(shift.detail, /did not run.*ENOENT/);
  });

  it("runs no suite when the shift did not take", () => {
    let ran = 0;
    const out = runSuites({ shift: () => ({ ok: false, detail: "nope" }), runSuite: () => ran++ });
    assert.equal(ran, 0);
    assert.equal(out.shiftOk, false);
    assert.equal(classify(JSON.stringify(out)).verdict, "no-verdict");
  });

  it("hands on each suite's exit, test count and failures", () => {
    const report = {
      numTotalTests: 3,
      testResults: [
        { name: `${REPO_ROOT}/apps/api/a.spec.ts`, status: "passed", assertionResults: [] },
        {
          name: `${REPO_ROOT}/apps/api/b.spec.ts`,
          status: "failed",
          assertionResults: [
            { status: "passed", fullName: "b ok" },
            { status: "failed", fullName: "b breaks a week out" },
          ],
        },
      ],
    };
    const out = runSuites({
      shift: () => ({ ok: true, shiftedTo: "2026-11-21T00:00:00.000Z" }),
      runSuite: (suite) => (suite.script === "test" ? { status: 1, output: "", report } : { status: 0, output: "", report: { numTotalTests: 2, testResults: [] } }),
    });
    assert.deepEqual(
      out.suites.map((s) => [s.script, s.status, s.tests, s.failureCount]),
      [
        ["test", 1, 3, 1],
        ["test:e2e", 0, 2, 0],
      ],
    );
    assert.deepEqual(out.suites[0].failures, [{ file: "apps/api/b.spec.ts", test: "b breaks a week out" }]);
  });

  it("keeps a crashed suite's output when it names no test", () => {
    const out = runSuites({
      shift: () => ({ ok: true }),
      runSuite: () => ({ status: 1, output: "line\nCannot find module x", report: null }),
    });
    assert.match(out.suites[0].tail, /Cannot find module x/);
  });
});

describe("clock-ahead-tests: reading jest's report", () => {
  it("names a file that failed to run, with the first line that says why", () => {
    const failures = failuresFromReport({
      testResults: [
        {
          name: `${REPO_ROOT}/apps/api/c.spec.ts`,
          status: "failed",
          message: "  ● Test suite failed to run\n\n    Cannot find module '#x'\n",
          assertionResults: [],
        },
      ],
    });
    assert.deepEqual(failures, [{ file: "apps/api/c.spec.ts", test: null, message: "Cannot find module '#x'" }]);
  });

  it("reads a missing report as no failures, leaving the exit code to say it failed", () => {
    assert.deepEqual(failuresFromReport(null), []);
  });
});

describe("clock-ahead-tests: verdict", () => {
  it("passes only when every suite exited 0", () => {
    assert.equal(classify(PASSED).verdict, "passed");
    assert.equal(classify(FAILED).verdict, "failed");
  });

  it("reads an empty, unparsable or partial result as no verdict", () => {
    assert.equal(classify("").verdict, "no-verdict");
    assert.equal(classify("{oops").verdict, "no-verdict");
    assert.equal(classify(result([passing("test")])).verdict, "no-verdict");
  });

  it("keys the alert on what fails, not on the order or the night", () => {
    const swapped = result([passing("test:e2e"), SWEEP_FAIL].reverse());
    assert.equal(failureKey(classify(FAILED)), failureKey(classify(swapped)));
    const other = result([{ ...SWEEP_FAIL, failures: [{ file: "apps/api/src/dev-log.spec.ts", test: "names the web" }] }, passing("test:e2e")]);
    assert.notEqual(failureKey(classify(FAILED)), failureKey(classify(other)));
  });

  it("is non-zero unless the suites passed and the alert is known closed or absent", () => {
    assert.equal(exitCodeFor({ verdict: "passed", alert: { action: "none" } }), 0);
    assert.equal(exitCodeFor({ verdict: "passed", alert: { action: "closed" } }), 0);
    assert.equal(exitCodeFor({ verdict: "passed", alert: { action: "unread" } }), 1);
    assert.equal(exitCodeFor({ verdict: "failed", alert: { action: "created" } }), 1);
    assert.equal(exitCodeFor({ verdict: "no-verdict", alert: { action: "unchanged" } }), 1);
  });
});

describe("clock-ahead-tests: the alert", () => {
  it("files one alert naming each failing test, how to reproduce, and the marker", async () => {
    const gh = github();
    const out = await runAlert(alertArgs(gh, FAILED));
    assert.deepEqual(out.alert, { action: "created", issueNumber: 99 });
    const filed = JSON.parse(posts(gh).at(-1).body);
    assert.equal(filed.title, ALERT.title);
    assert.match(filed.body, /`apps\/api\/src\/sweep\.spec\.ts`: sweep sends the row/);
    assert.match(filed.body, /2026-11-21/);
    assert.match(filed.body, /faketime -f \+7d/);
    assert.ok(filed.body.includes(marker(classify(FAILED))));
  });

  it("stays quiet on a night where the same tests fail, so one bomb is one email", async () => {
    const gh = github({ issues: [openIssue(42, `body\n${marker(classify(FAILED))}`)] });
    const out = await runAlert(alertArgs(gh, FAILED));
    assert.deepEqual(out.alert, { action: "unchanged", issueNumber: 42 });
    assert.equal(posts(gh).length, 0);
    assert.equal(exitCodeFor(out), 1, "the run still goes red");
  });

  it("comments when what fails changes", async () => {
    const gh = github({ issues: [openIssue(42, "<!-- clock-ahead-failing: something-else -->")] });
    const out = await runAlert(alertArgs(gh, FAILED));
    assert.equal(out.alert.action, "commented");
  });

  it("raises on no verdict rather than look like a quiet night", async () => {
    const gh = github();
    const out = await runAlert(alertArgs(gh, ""));
    assert.equal(out.verdict, "no-verdict");
    assert.equal(out.alert.action, "created");
    assert.match(JSON.parse(posts(gh).at(-1).body).body, /no verdict/);
  });

  it("closes an open alert on a night every suite passes", async () => {
    const gh = github({ issues: [openIssue(42)] });
    const out = await runAlert(alertArgs(gh, PASSED));
    assert.equal(out.alert.action, "closed");
    assert.equal(exitCodeFor(out), 0);
  });
});

describe("clock-ahead-tests: entry point", () => {
  it("refuses an unknown mode", async () => {
    const errors = [];
    const original = console.error;
    console.error = (line) => errors.push(line);
    try {
      assert.equal(await main({ argv: ["nope"] }), 2);
    } finally {
      console.error = original;
    }
    assert.match(errors[0], /usage/);
  });

  it("hands the tests job's result to the alert", async () => {
    let seen;
    const code = await main({
      argv: ["alert"],
      env: { GITHUB_TOKEN: "t", GITHUB_REPOSITORY: REPO, RESULT: PASSED },
      alert: async (args) => {
        seen = args;
        return { verdict: "passed", alert: { action: "none" } };
      },
    });
    assert.equal(code, 0);
    assert.equal(seen.raw, PASSED);
  });
});

describe("clock-ahead-tests.yml", () => {
  const text = readFileSync(WORKFLOW, "utf8");
  const jobs = workflowJobs(WORKFLOW);
  // Each job's text: from its key to the next job's, or the end.
  const block = (name) => {
    const start = text.indexOf(`\n  ${name}:\n`);
    const next = text.slice(start + 1).search(/\n {2}[a-z-]+:\n/);
    return start === -1 ? "" : next === -1 ? text.slice(start) : text.slice(start, start + 1 + next);
  };

  it("has the tests job and the alert job", () => {
    assert.deepEqual(
      jobs.map((job) => job.jobId),
      ["tests", "alert"],
    );
    assert.ok(block("tests").length > 0 && !block("tests").includes("issues: write"));
  });

  it("gives the job that runs test code no issue write", () => {
    assert.doesNotMatch(block("tests"), /issues:\s*write/);
    assert.doesNotMatch(block("tests"), /secrets\./);
    assert.match(block("alert"), /issues:\s*write/);
    assert.match(text, /^permissions:\n {2}contents: read$/m);
  });

  it("installs libfaketime and runs the script in each mode", () => {
    assert.match(block("tests"), /apt-get install[^\n]*\bfaketime\b/);
    assert.match(block("tests"), /node scripts\/ci\/clock-ahead-tests\.mjs run/);
    assert.match(block("alert"), /node scripts\/ci\/clock-ahead-tests\.mjs alert/);
  });

  it("alerts even when the tests job failed, and only on main", () => {
    assert.match(block("alert"), /if: always\(\) && github\.ref == 'refs\/heads\/main'/);
    assert.match(block("tests"), /if: github\.ref == 'refs\/heads\/main'/);
    assert.match(block("alert"), /RESULT: \$\{\{ needs\.tests\.outputs\.result \}\}/);
  });
});
