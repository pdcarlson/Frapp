import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import {
  actionFor,
  ALERTS,
  alertFor,
  buildIssueBody,
  checkRan,
  parseVerdicts,
  reportSourcemaps,
} from "../sentry-sourcemaps-alert.mjs";
import { ENVIRONMENTS } from "../lib/environments.mjs";
import { SOURCEMAP_PROJECTS, VERDICTS } from "../verify-sentry-sourcemaps.mjs";

import { makeFetchMock } from "./helpers.mjs";

const SHA = "0123456789abcdef0123456789abcdef01234567";
const SCRIPT = join(dirname(fileURLToPath(import.meta.url)), "..", "sentry-sourcemaps-alert.mjs");
const REPO_ROOT = join(dirname(SCRIPT), "..", "..");

/** GitHub with the given issues under the alert label; records every call. */
function github(issues = []) {
  return makeFetchMock([
    { method: "GET", path: "/issues?state=all", body: issues },
    { method: "POST", path: "/comments", body: {} },
    { method: "POST", path: "/issues", body: { number: 900, assignees: [{ login: "pdcarlson" }] } },
    { method: "PATCH", path: "/issues/", body: {} },
  ]);
}

const writes = (calls) => calls.filter((c) => c.method !== "GET");

function run(verdicts, mock, { environment = "staging", checked = "successskipped" } = {}) {
  const lines = [];
  return reportSourcemaps({
    environment,
    sha: SHA,
    verdicts,
    checked,
    token: "t",
    repo: "o/r",
    runUrl: "https://run",
    fetchImpl: mock.fetchImpl,
    logger: { log: (line) => lines.push(line) },
  }).then((outcomes) => ({ outcomes, lines }));
}

const all = (api, web, landing) => ({ "frapp-api": api, "frapp-web": web, "frapp-landing": landing });

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
  it("closes on present, raises on the four failing verdicts, notes unverifiable, skips unbuilt", () => {
    assert.equal(actionFor("frapp-web", "present"), "resolve");
    for (const v of ["missing", "no-token", "rejected", "no-project"]) assert.equal(actionFor("frapp-web", v), "raise", v);
    assert.equal(actionFor("frapp-web", "unverifiable"), "notice");
    assert.equal(actionFor("frapp-web", "unbuilt"), "none");
    // Every verdict the check can write has an action.
    for (const v of VERDICTS) assert.ok(["resolve", "raise", "notice", "none"].includes(actionFor("frapp-api", v)), v);
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
    const { outcomes } = await run(all("rejected", "present", "unbuilt"), mock);
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

  it("names production's Infisical slug, prod, in the no-token fix", async () => {
    const mock = github([]);
    await run(all("no-token", "unbuilt", "unbuilt"), mock, { environment: "production", checked: "skippedsuccess" });
    const issue = JSON.parse(writes(mock.calls).find((c) => c.url.endsWith("/issues")).body);
    assert.equal(issue.title, alertFor("production", "frapp-api").title);
    assert.match(issue.body, /Infisical `prod`/);
  });

  it("comments on an open alert instead of filing a second one", async () => {
    const open = [{ number: 42, state: "open", title: alertFor("production", "frapp-web").title }];
    const mock = github(open);
    const { outcomes } = await run(all("unbuilt", "missing", "unbuilt"), mock, { environment: "production" });
    assert.deepEqual(outcomes, [{ project: "frapp-web", verdict: "missing", action: "commented" }]);
    assert.equal(writes(mock.calls).filter((c) => c.url.endsWith("/issues")).length, 0);
    const comment = JSON.parse(writes(mock.calls).find((c) => c.url.endsWith("/comments")).body).body;
    assert.match(comment, /Build the Vercel … bundles/);
  });

  it("closes an open alert when the maps are back", async () => {
    const open = [{ number: 42, state: "open", title: alertFor("staging", "frapp-api").title }];
    const mock = github(open);
    const { outcomes } = await run(all("present", "unbuilt", "unbuilt"), mock);
    assert.equal(outcomes[0].action, "closed");
    const close = writes(mock.calls).find((c) => c.method === "PATCH");
    assert.deepEqual(JSON.parse(close.body), { state: "closed", state_reason: "completed" });
  });

  it("closes only the alert of the project it checked", async () => {
    // A run that proved the API says nothing about web's maps.
    const open = [{ number: 43, state: "open", title: alertFor("staging", "frapp-web").title }];
    const mock = github(open);
    await run(all("present", "unbuilt", "unbuilt"), mock);
    assert.deepEqual(writes(mock.calls), []);
  });

  it("changes nothing on unverifiable, or on landing's known missing project", async () => {
    const mock = github([]);
    const { outcomes } = await run(all("unverifiable", "unbuilt", "no-project"), mock);
    assert.deepEqual(outcomes.map((o) => o.action), ["none", "none"]);
    assert.equal(mock.calls.length, 0, "not even a lookup");
  });

  it("keeps one environment's alert out of the other's", async () => {
    const open = [{ number: 44, state: "open", title: alertFor("staging", "frapp-web").title }];
    const mock = github(open);
    const { outcomes } = await run(all("unbuilt", "missing", "unbuilt"), mock, { environment: "production" });
    assert.equal(outcomes[0].action, "created", "production files its own alert");
  });
});

describe("an empty report", () => {
  it("is 'nothing built' when neither check step ran", async () => {
    const mock = github([]);
    const { outcomes, lines } = await run(null, mock, { checked: "skippedskipped" });
    assert.deepEqual(outcomes, []);
    assert.equal(mock.calls.length, 0);
    assert.match(lines[0], /built nothing/);
  });

  it("is a warning naming both causes, never 'nothing built', when a check ran and no verdicts arrived", async () => {
    // Either the verifier crashed before writing (its exit-0 catch-all), or
    // the runner dropped a job output containing a masked value.
    for (const checked of ["successskipped", "skippedsuccess"]) {
      const mock = github([]);
      const { outcomes, lines } = await run(null, mock, { checked });
      assert.deepEqual(outcomes, []);
      assert.equal(mock.calls.length, 0);
      assert.match(lines[0], /^::warning::The source-map check ran, but no verdicts reached this job/);
      assert.match(lines[0], /crashed/);
      assert.match(lines[0], /masked value/);
    }
    assert.equal(checkRan(""), false);
    assert.equal(checkRan(undefined), false);
  });
});

describe("reading the deploy job's words", () => {
  it("is null for an empty output", () => {
    for (const raw of [undefined, "", "  "]) assert.equal(parseVerdicts(raw), null);
  });

  it("maps one word per project, in order", () => {
    assert.deepEqual(parseVerdicts("present missing unbuilt\n"), all("present", "missing", "unbuilt"));
  });

  it("refuses words the check could not have written", () => {
    assert.throws(() => parseVerdicts("present missing"));
    assert.throws(() => parseVerdicts("present missing unbuilt present"));
    assert.throws(() => parseVerdicts("present fine unbuilt"));
    assert.throws(() => parseVerdicts('{"environment":"staging"}'));
  });
});

describe("the issue body", () => {
  it("says the deploy shipped, what the verdict means, where the details are, and when it closes", () => {
    const body = buildIssueBody({ project: "frapp-web", environment: "staging", sha: SHA, verdict: "missing", runUrl: "https://run" });
    assert.match(body, /The deploy itself shipped/);
    assert.match(body, /holds no artifact bundle for this release that this deploy's build uploaded/);
    assert.match(body, /step summary/);
    assert.match(body, /Closes itself when a later deploy that builds frapp-web finds its maps/);
  });
});

describe("the script keeps deploy-outcome green", () => {
  const spawn = (env) =>
    spawnSync(process.execPath, [SCRIPT], {
      env: {
        PATH: process.env.PATH,
        GITHUB_TOKEN: "t",
        GITHUB_REPOSITORY: "o/r",
        RUN_URL: "https://run",
        TARGET_ENVIRONMENT: "staging",
        DEPLOY_SHA: SHA,
        ...env,
      },
      encoding: "utf8",
      timeout: 60_000,
    });

  it("exits 0 with a warning on output it can't read, touching no alert", () => {
    const result = spawn({ SOURCEMAPS: "present fine unbuilt" });
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /::warning::The deploy job's source-map verdicts could not be read/);
  });

  it("exits 0 with a warning when it crashes", () => {
    // An environment it has no alerts for throws inside main(); only the
    // catch-all stands between that and exit 1.
    const result = spawn({ TARGET_ENVIRONMENT: "preview", SOURCEMAPS: "present present present" });
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /::warning::Source-map alerting crashed/);
  });

  it("exits 0 with nothing to do when nothing was built", () => {
    const result = spawn({ SOURCEMAPS: "", SOURCEMAPS_CHECKED: "skippedskipped" });
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /built nothing/);
  });
});
