import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import {
  actionFor,
  ALERTS,
  alertFor,
  buildIssueBody,
  parseReport,
  reportSourcemaps,
} from "../sentry-sourcemaps-alert.mjs";
import { ENVIRONMENTS, SOURCEMAP_PROJECTS, VERDICTS } from "../verify-sentry-sourcemaps.mjs";

import { makeFetchMock } from "./helpers.mjs";

const SHA = "0123456789abcdef0123456789abcdef01234567";
const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const silent = { log: () => {} };

const report = (projects, environment = "staging") => ({ environment, sha: SHA, projects });
const verdict = (v, detail = "detail") => ({ verdict: v, detail });

/** GitHub with the given issues open under the alert label; records every call. */
function github(issues = []) {
  return makeFetchMock([
    { method: "GET", path: "/issues?state=all", body: issues },
    { method: "POST", path: "/comments", body: {} },
    { method: "POST", path: "/issues", body: { number: 900, assignees: [{ login: "pdcarlson" }] } },
    { method: "PATCH", path: "/issues/", body: {} },
  ]);
}

const writes = (calls) => calls.filter((c) => c.method !== "GET");
const run = (r, mock) =>
  reportSourcemaps({ report: r, token: "t", repo: "o/r", runUrl: "https://run", fetchImpl: mock.fetchImpl, logger: silent });

describe("the alert identities", () => {
  it("are one per project and environment, P2, each a distinct title", () => {
    assert.equal(Object.keys(ALERTS).length, ENVIRONMENTS.length * Object.keys(SOURCEMAP_PROJECTS).length);
    const titles = Object.values(ALERTS).map((a) => a.title);
    assert.equal(new Set(titles).size, titles.length);
    for (const alert of Object.values(ALERTS)) assert.ok(alert.labels.includes("P2"), alert.title);
    assert.equal(
      alertFor("staging", "frapp-web").title,
      "Sentry has no source maps for frapp-web on staging — its stack traces are minified",
    );
    assert.throws(() => alertFor("preview", "frapp-web"));
  });

  it("are all listed in ALERT_ROUTING.md", () => {
    const routing = readFileSync(join(REPO_ROOT, "docs", "internal", "ops", "ALERT_ROUTING.md"), "utf8");
    // One row stands for all of them: the title pattern, and one literal title
    // (the lookup key a search for the issue would use).
    assert.ok(routing.includes("Sentry has no source maps for &lt;project&gt; on &lt;environment&gt; — its stack traces are minified"));
    assert.ok(routing.includes(alertFor("staging", "frapp-web").title));
    for (const name of [...Object.keys(SOURCEMAP_PROJECTS), ...ENVIRONMENTS]) assert.ok(routing.includes(`\`${name}\``), name);
  });
});

describe("what each verdict does", () => {
  it("closes on present, raises on the four failing verdicts, and only notes unverifiable", () => {
    assert.equal(actionFor("frapp-web", "present"), "resolve");
    for (const v of ["missing", "no-token", "rejected", "no-project"]) assert.equal(actionFor("frapp-web", v), "raise", v);
    assert.equal(actionFor("frapp-web", "unverifiable"), "notice");
    // Every verdict the check can write has an action.
    for (const v of VERDICTS) assert.ok(["resolve", "raise", "notice"].includes(actionFor("frapp-api", v)), v);
  });

  it("raises a project still waiting for its Sentry project only on proof that it exists", () => {
    assert.equal(SOURCEMAP_PROJECTS["frapp-landing"].awaitingProject, 2071);
    assert.equal(actionFor("frapp-landing", "missing"), "raise", "a 200 means the project exists now");
    assert.equal(actionFor("frapp-landing", "present"), "resolve");
    for (const v of ["no-project", "no-token", "rejected", "unverifiable"]) {
      assert.equal(actionFor("frapp-landing", v), "notice", v);
    }
  });
});

describe("filing", () => {
  it("files one new alert per failing project, assigned, with the fix for its verdict", async () => {
    const mock = github([]);
    const outcomes = await run(
      report({ "frapp-api": verdict("rejected", "Sentry refused the token (HTTP 401)"), "frapp-web": verdict("present") }),
      mock,
    );
    assert.deepEqual(outcomes, [
      { project: "frapp-api", verdict: "rejected", action: "created" },
      { project: "frapp-web", verdict: "present", action: "none" },
    ]);
    const created = writes(mock.calls).filter((c) => c.method === "POST" && c.url.endsWith("/issues"));
    assert.equal(created.length, 1);
    const issue = JSON.parse(created[0].body);
    assert.equal(issue.title, alertFor("staging", "frapp-api").title);
    assert.deepEqual(issue.assignees, ["pdcarlson"]);
    assert.ok(issue.labels.includes("incident") && issue.labels.includes("P2"));
    assert.match(issue.body, /`rejected` for `0123456789abcdef0123456789abcdef01234567`/);
    assert.match(issue.body, /Mint a new org auth token/);
    assert.match(issue.body, /Run: https:\/\/run/);
  });

  it("comments on an open alert instead of filing a second one", async () => {
    const open = [{ number: 42, state: "open", title: alertFor("production", "frapp-web").title }];
    const mock = github(open);
    const [outcome] = await run(report({ "frapp-web": verdict("no-token") }, "production"), mock);
    assert.deepEqual(outcome, { project: "frapp-web", verdict: "no-token", action: "commented" });
    assert.equal(writes(mock.calls).filter((c) => c.url.endsWith("/issues")).length, 0);
    const comment = JSON.parse(writes(mock.calls).find((c) => c.url.endsWith("/comments")).body).body;
    assert.match(comment, /Add `SENTRY_AUTH_TOKEN`/);
  });

  it("closes an open alert when the maps are back", async () => {
    const open = [{ number: 42, state: "open", title: alertFor("staging", "frapp-api").title }];
    const mock = github(open);
    const [outcome] = await run(report({ "frapp-api": verdict("present", "1 artifact bundle(s)") }), mock);
    assert.equal(outcome.action, "closed");
    const close = writes(mock.calls).find((c) => c.method === "PATCH");
    assert.deepEqual(JSON.parse(close.body), { state: "closed", state_reason: "completed" });
  });

  it("closes only the alert of the project it checked", async () => {
    // A run that proved the API says nothing about web's maps.
    const open = [{ number: 43, state: "open", title: alertFor("staging", "frapp-web").title }];
    const mock = github(open);
    await run(report({ "frapp-api": verdict("present") }), mock);
    assert.deepEqual(writes(mock.calls), []);
  });

  it("changes nothing on unverifiable, or on landing's known missing project", async () => {
    const mock = github([]);
    const outcomes = await run(
      report({ "frapp-api": verdict("unverifiable"), "frapp-landing": verdict("no-project") }),
      mock,
    );
    assert.deepEqual(outcomes.map((o) => o.action), ["none", "none"]);
    assert.equal(mock.calls.length, 0, "not even a lookup");
  });

  it("does nothing for a run that built nothing", async () => {
    const mock = github([]);
    assert.deepEqual(await run(null, mock), []);
    assert.equal(mock.calls.length, 0);
  });

  it("keeps one environment's alert out of the other's", async () => {
    const open = [{ number: 44, state: "open", title: alertFor("staging", "frapp-web").title }];
    const mock = github(open);
    const [outcome] = await run(report({ "frapp-web": verdict("missing") }, "production"), mock);
    assert.equal(outcome.action, "created", "production files its own alert");
  });
});

describe("reading the deploy job's report", () => {
  it("is null for an empty output: the run built nothing", () => {
    for (const raw of [undefined, "", "  "]) assert.equal(parseReport(raw), null);
  });

  it("round-trips what the check writes", () => {
    const r = report({ "frapp-api": verdict("present") });
    assert.deepEqual(parseReport(JSON.stringify(r)), r);
  });

  it("refuses a report the check could not have written", () => {
    assert.throws(() => parseReport("{"));
    assert.throws(() => parseReport(JSON.stringify({ ...report({}), environment: "preview" })));
    assert.throws(() => parseReport(JSON.stringify(report({ "frapp-mobile": verdict("present") }))));
    assert.throws(() => parseReport(JSON.stringify(report({ "frapp-api": verdict("fine") }))));
    assert.throws(() => parseReport(JSON.stringify({ environment: "staging" })));
  });
});

describe("the issue body", () => {
  it("says the deploy shipped, what failed, and when it closes", () => {
    const body = buildIssueBody({
      project: "frapp-web",
      environment: "staging",
      sha: SHA,
      verdict: "missing",
      detail: "no artifact bundle is associated with this release",
      runUrl: "https://run",
    });
    assert.match(body, /The deploy itself shipped/);
    assert.match(body, /no artifact bundle is associated with this release/);
    assert.match(body, /Closes itself when a later deploy that builds frapp-web finds its maps/);
  });
});
