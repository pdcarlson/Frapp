import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import {
  ALERT_ISSUE_TITLE,
  DEFAULT_READY_URL,
  READY_PATH,
  assertReadyUrl,
  evaluateReadyResponse,
  probeReady,
  runWatchdog,
} from "../production-uptime.mjs";

import { makeFetchMock } from "./helpers.mjs";

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const WORKFLOW = join(REPO_ROOT, ".github", "workflows", "production-uptime.yml");
const SCRIPT = join(REPO_ROOT, "scripts", "ci", "production-uptime.mjs");
const ALERT_ROUTING = join(REPO_ROOT, "docs", "internal", "ops", "ALERT_ROUTING.md");
const REQUIRED_CHECKS = join(REPO_ROOT, "scripts", "ci", "lib", "required-checks.mjs");

const TEST_URL = "https://example.test/health/ready";
const OK_BODY = { status: "ok", database: "connected", storage: "connected" };

describe("assertReadyUrl", () => {
  it("accepts the production URL", () =>
    assert.deepEqual(assertReadyUrl(DEFAULT_READY_URL), { ok: true }));

  it("accepts http for tests", () =>
    assert.deepEqual(assertReadyUrl("http://127.0.0.1:3001/health/ready"), { ok: true }));

  it("rejects /health (liveness, always 2xx while the process is up)", () => {
    const verdict = assertReadyUrl("https://api.frapp.live/health");
    assert.equal(verdict.ok, false);
    assert.match(verdict.reason, /\/health\/ready/);
  });

  it("rejects a trailing slash", () =>
    assert.equal(assertReadyUrl("https://api.frapp.live/health/ready/").ok, false));

  it("rejects a query string", () =>
    assert.equal(assertReadyUrl("https://api.frapp.live/health/ready?x=1").ok, false));

  it("rejects an unparseable value", () =>
    assert.equal(assertReadyUrl("not a url").ok, false));
});

describe("evaluateReadyResponse", () => {
  it("passes HTTP 200 with status ok", () =>
    assert.deepEqual(
      evaluateReadyResponse({
        httpStatus: 200,
        bodyText: JSON.stringify(OK_BODY),
      }),
      { ok: true, reason: "ok" },
    ));

  it("fails HTTP 503 even if the error envelope names a dependency", () => {
    const verdict = evaluateReadyResponse({
      httpStatus: 503,
      bodyText: JSON.stringify({
        statusCode: 503,
        error: "Service Unavailable",
        message: "database: error, storage: connected",
      }),
    });
    assert.equal(verdict.ok, false);
    assert.equal(verdict.reason, "HTTP 503");
  });

  it("fails HTTP 200 with status degraded — that is the /health liveness shape", () => {
    const verdict = evaluateReadyResponse({
      httpStatus: 200,
      bodyText: JSON.stringify({ status: "degraded", database: "error" }),
    });
    assert.equal(verdict.ok, false);
    assert.match(verdict.reason, /degraded/);
  });

  it("fails HTTP 200 with a missing status field", () => {
    const verdict = evaluateReadyResponse({
      httpStatus: 200,
      bodyText: JSON.stringify({ database: "connected" }),
    });
    assert.equal(verdict.ok, false);
    assert.match(verdict.reason, /missing/);
  });

  it("fails HTTP 200 with non-JSON", () => {
    const verdict = evaluateReadyResponse({ httpStatus: 200, bodyText: "ok" });
    assert.equal(verdict.ok, false);
    assert.equal(verdict.reason, "non-JSON body");
  });

  it("fails HTTP 200 with a JSON array", () => {
    const verdict = evaluateReadyResponse({
      httpStatus: 200,
      bodyText: JSON.stringify(["ok"]),
    });
    assert.equal(verdict.ok, false);
    assert.match(verdict.reason, /not an object/);
  });
});

describe("probeReady", () => {
  it("returns ok on a 200 status=ok response", async () => {
    const { fetchImpl, calls } = makeFetchMock([
      { method: "GET", path: READY_PATH, body: OK_BODY },
    ]);
    const result = await probeReady({
      url: TEST_URL,
      fetchImpl,
      attempts: 1,
    });
    assert.equal(result.ok, true);
    assert.equal(result.httpStatus, 200);
    assert.equal(calls.length, 1);
  });

  it("does not hit a /health URL even if fetch would 200", async () => {
    const fetchImpl = async () => {
      throw new Error("fetch must not run for a liveness URL");
    };
    const result = await probeReady({
      url: "https://api.frapp.live/health",
      fetchImpl,
      attempts: 1,
    });
    assert.equal(result.ok, false);
    assert.match(result.reason, /\/health\/ready/);
    assert.equal(result.httpStatus, 0);
  });

  it("classifies a 503 after retries as a failure, not a skip", async () => {
    const { fetchImpl, calls } = makeFetchMock([
      {
        method: "GET",
        path: READY_PATH,
        status: 503,
        body: { statusCode: 503, message: "database: error" },
      },
    ]);
    const result = await probeReady({
      url: TEST_URL,
      fetchImpl,
      attempts: 2,
      sleep: async () => {},
    });
    assert.equal(result.ok, false);
    assert.equal(result.reason, "HTTP 503");
    assert.equal(calls.length, 2);
  });

  it("classifies a thrown fetch as a network failure", async () => {
    const result = await probeReady({
      url: TEST_URL,
      fetchImpl: async () => {
        throw new Error("ECONNRESET");
      },
      attempts: 1,
    });
    assert.equal(result.ok, false);
    assert.match(result.reason, /network: ECONNRESET/);
  });
});

describe("runWatchdog", () => {
  const failResult = {
    ok: false,
    reason: "HTTP 503",
    httpStatus: 503,
    bodyText: '{"message":"database: error"}',
  };
  const passResult = {
    ok: true,
    reason: "ok",
    httpStatus: 200,
    bodyText: JSON.stringify(OK_BODY),
  };

  it("raises one alert on failure and does not file a second", async () => {
    const { fetchImpl, calls } = makeFetchMock([
      { method: "GET", path: "/issues?state=all", body: [] },
      { method: "POST", path: "/issues", body: { number: 42 } },
    ]);
    const out = await runWatchdog({
      result: failResult,
      url: DEFAULT_READY_URL,
      token: "t",
      repo: "pdcarlson/Frapp",
      fetchImpl,
    });
    assert.equal(out.outcome, "fail");
    assert.equal(out.alert.action, "created");
    const created = JSON.parse(calls.find((c) => c.method === "POST").body);
    assert.equal(created.title, ALERT_ISSUE_TITLE);
    assert.ok(created.labels.includes("routine-state"));
    assert.ok(created.labels.includes("P1"));
    assert.match(created.body, /\/health\/ready/);
    assert.doesNotMatch(created.body, /Fixes #/);
  });

  it("closes the alert on recovery only when lookup succeeded", async () => {
    const { fetchImpl, calls } = makeFetchMock([
      {
        method: "GET",
        path: "/issues?state=all",
        body: [{ number: 42, title: ALERT_ISSUE_TITLE, state: "open" }],
      },
      { method: "PATCH", path: "/issues/42", body: { number: 42 } },
      { method: "POST", path: "/comments", body: {} },
    ]);
    const out = await runWatchdog({
      result: passResult,
      url: DEFAULT_READY_URL,
      token: "t",
      repo: "pdcarlson/Frapp",
      fetchImpl,
    });
    assert.equal(out.outcome, "pass");
    assert.equal(out.resolved, true);
    assert.ok(calls.some((c) => c.method === "PATCH" && c.url.includes("/issues/42")));
  });

  it("does not close an alert when the lookup itself failed", async () => {
    const { fetchImpl, calls } = makeFetchMock([
      { method: "GET", path: "/issues?state=all", status: 500, body: {} },
    ]);
    const out = await runWatchdog({
      result: passResult,
      url: DEFAULT_READY_URL,
      token: "t",
      repo: "pdcarlson/Frapp",
      fetchImpl,
    });
    assert.equal(out.outcome, "pass");
    assert.equal(out.resolved, false);
    assert.equal(out.lookupOk, false);
    assert.equal(
      calls.filter((c) => c.method === "PATCH").length,
      0,
      "a failed lookup must not be treated as no open alert",
    );
  });

  it("does not treat a failed close PATCH as recovery", async () => {
    const { fetchImpl, calls } = makeFetchMock([
      {
        method: "GET",
        path: "/issues?state=all",
        body: [{ number: 42, title: ALERT_ISSUE_TITLE, state: "open" }],
      },
      { method: "POST", path: "/comments", body: {} },
      { method: "PATCH", path: "/issues/42", status: 502, body: {} },
    ]);
    const out = await runWatchdog({
      result: passResult,
      url: DEFAULT_READY_URL,
      token: "t",
      repo: "pdcarlson/Frapp",
      fetchImpl,
    });
    assert.equal(out.outcome, "fail");
    assert.equal(out.resolved, false);
    assert.ok(calls.some((c) => c.method === "PATCH" && c.url.includes("/issues/42")));
  });

  it("does not re-comment an already-open alert", async () => {
    const { fetchImpl, calls } = makeFetchMock([
      {
        method: "GET",
        path: "/issues?state=all",
        body: [{ number: 42, title: ALERT_ISSUE_TITLE, state: "open" }],
      },
      { method: "POST", path: "/issues", body: { number: 99 } },
      { method: "POST", path: "/comments", body: {} },
    ]);
    const out = await runWatchdog({
      result: failResult,
      url: DEFAULT_READY_URL,
      token: "t",
      repo: "pdcarlson/Frapp",
      fetchImpl,
    });
    assert.equal(out.outcome, "fail");
    assert.equal(out.alert.action, "none");
    assert.equal(out.alert.issueNumber, 42);
    assert.equal(
      calls.filter((c) => c.method === "POST").length,
      0,
      "a 15-minute cadence must not comment on every failing tick",
    );
  });

  it("does not treat a failed second lookup as recovery when an open P1 was already seen", async () => {
    let issueGets = 0;
    const fetchImpl = async (url, init = {}) => {
      const method = init.method ?? "GET";
      if (method === "GET" && String(url).includes("/issues?state=all")) {
        issueGets += 1;
        if (issueGets === 1) {
          return {
            ok: true,
            status: 200,
            text: async () =>
              JSON.stringify([{ number: 42, title: ALERT_ISSUE_TITLE, state: "open" }]),
          };
        }
        return { ok: false, status: 502, text: async () => "{}" };
      }
      throw new Error(`unexpected ${method} ${url}`);
    };
    const out = await runWatchdog({
      result: passResult,
      url: DEFAULT_READY_URL,
      token: "t",
      repo: "pdcarlson/Frapp",
      fetchImpl,
    });
    assert.equal(out.outcome, "fail");
    assert.equal(out.resolved, false);
    assert.equal(issueGets, 2);
  });
});

function uncommented(text) {
  return text
    .split("\n")
    .filter((line) => !/^\s*#/.test(line))
    .join("\n");
}

describe("workflow wiring", () => {
  const workflow = readFileSync(WORKFLOW, "utf8");
  const liveYaml = uncommented(workflow);
  const script = readFileSync(SCRIPT, "utf8");
  const routing = readFileSync(ALERT_ROUTING, "utf8");
  const roster = readFileSync(REQUIRED_CHECKS, "utf8");

  it("does not name environment: production — a schedule job that did would suspend on #1435", () => {
    assert.doesNotMatch(liveYaml, /^\s*environment:\s*production\s*$/m);
    assert.doesNotMatch(liveYaml, /environment:\s*production/);
    assert.doesNotMatch(liveYaml, /environment:\s*["']production["']/);
    assert.doesNotMatch(liveYaml, /^\s*name:\s*["']?production["']?\s*$/m);
  });

  it("pins the production readiness URL, not /health", () => {
    assert.match(workflow, /HEALTH_URL: https:\/\/api\.frapp\.live\/health\/ready/);
    assert.doesNotMatch(workflow, /HEALTH_URL:.*\/health"/);
  });

  it("is schedule + workflow_dispatch only — not a required PR check", () => {
    assert.match(workflow, /cron: "\*\/15 \* \* \* \*"/);
    assert.match(workflow, /workflow_dispatch:/);
    assert.doesNotMatch(workflow, /pull_request:/);
    assert.doesNotMatch(roster, /production-uptime/);
  });

  it("ALERT_ROUTING.md lists this alert title so the roster cannot drop it again", () => {
    assert.ok(
      routing.includes(ALERT_ISSUE_TITLE),
      "ALERT_ROUTING.md must name the new alert; #1674 was this exact miss for guardrails",
    );
  });

  it("the script refuses to close issues with a GitHub closer in its alert copy", () => {
    assert.doesNotMatch(script, /\b(fixes|closes|close)\s+#/i);
  });

  it("requires GitHub credentials before probing when not --probe-only", () => {
    const main = script.slice(script.indexOf("async function main()"));
    const tokenIdx = main.indexOf('requireEnv("GITHUB_TOKEN")');
    const probeIdx = main.indexOf("await probeReady");
    assert.ok(tokenIdx !== -1, "main() must require GITHUB_TOKEN");
    assert.ok(probeIdx !== -1, "main() must probe");
    assert.ok(
      tokenIdx < probeIdx,
      "a missing token must not look like a successful watch of production",
    );
  });
});
