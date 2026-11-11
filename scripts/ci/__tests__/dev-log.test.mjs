import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  areasOf,
  buildDailySummary,
  buildPrMerged,
  buildUpdatePushed,
  buildWorkStarted,
  createGitHub,
  isBot,
  main,
  OTA_UPDATE_JOB,
  SHIPPED_JOB,
  STORE_BUILD_JOB,
  postDevLog,
} from "../dev-log.mjs";
import { WORKFLOW_DIR, workflowJobs, workflowSteps } from "./helpers/workflow-yaml.mjs";

// scripts/ci/dev-log.mjs: the facts GitHub Actions sends to the team's Dev log
// channel (#4145). The API side has its own specs
// (apps/api/src/application/services/dev-log.service.spec.ts).

const REPO = "pdcarlson/Frapp";
const SHA = "979c914f0123456789abcdef0123456789abcdef";
const human = (login) => ({ login, type: "User" });
const labels = (...names) => names.map((name) => ({ name }));
const NO_WAIT = { sleep: async () => {}, attempts: 1 };

/**
 * A fetch double. `routes` maps a URL substring to a JSON body (or a function
 * of the URL and init). Records every call; an unrouted URL answers 404.
 */
function fakeFetch(routes) {
  const calls = [];
  const fetchImpl = async (url, init = {}) => {
    calls.push({ url: String(url), init });
    const key = Object.keys(routes).find((k) => String(url).includes(k));
    const value = key === undefined ? undefined : routes[key];
    const body = typeof value === "function" ? value(String(url), init) : value;
    if (body === undefined) return new Response("{}", { status: 404 });
    if (body instanceof Response) return body;
    return new Response(JSON.stringify(body), { status: 200 });
  };
  return { fetchImpl, calls };
}

const github = (routes) => {
  const { fetchImpl, calls } = fakeFetch(routes);
  return { gh: createGitHub({ token: "gh", repo: REPO, fetchImpl, retryOptions: NO_WAIT }), calls, fetchImpl };
};

describe("dev-log: small readers", () => {
  it("reads area labels without the prefix, and nothing else", () => {
    assert.deepEqual(areasOf({ labels: labels("P3", "area:chat", "in-progress", "area:web") }), ["chat", "web"]);
    assert.deepEqual(areasOf({ labels: ["area:api"] }), ["api"]);
    assert.deepEqual(areasOf({}), []);
  });

  it("treats an App, Dependabot and a missing account as a bot", () => {
    assert.equal(isBot({ login: "dependabot[bot]", type: "Bot" }), true);
    assert.equal(isBot({ login: "claude[bot]", type: "User" }), true);
    assert.equal(isBot(null), true);
    assert.equal(isBot(human("pdcarlson")), false);
  });
});

describe("dev-log: work started", () => {
  const issue = (number, title, names, extra = {}) => ({ number, title, labels: labels(...names), ...extra });
  const event = (over = {}) => ({
    label: { name: "in-progress" },
    sender: human("shawn"),
    issue: issue(12, "Activity page", ["area:chat", "in-progress"]),
    ...over,
  });

  it("names who started it, its areas, and who is already in the same area", async () => {
    const { gh } = github({
      "/users/shawn": { name: "Shawn Klein" },
      "/users/winston": { name: null },
      "labels=in-progress": [
        issue(12, "Activity page", ["area:chat", "in-progress"]),
        issue(9, "Chat threads", ["area:chat", "in-progress"]),
        issue(8, "Billing export", ["area:billing", "in-progress"]),
        issue(7, "A PR, not an issue", ["area:chat", "in-progress"], { pull_request: {} }),
        issue(6, "Routine ledger", ["area:chat", "in-progress", "routine-state"]),
      ],
      "/issues/9/events": [
        { event: "labeled", label: { name: "in-progress" }, actor: human("paul") },
        { event: "labeled", label: { name: "P2" }, actor: human("paul") },
        { event: "labeled", label: { name: "in-progress" }, actor: human("winston") },
      ],
    });
    const { payload } = await buildWorkStarted({ event: event(), gh });
    assert.deepEqual(payload, {
      event: "work_started",
      number: 12,
      title: "Activity page",
      actor: "Shawn Klein",
      areas: ["chat"],
      // The latest person to add the label, by login when the profile has no name.
      also_in_area: [{ number: 9, title: "Chat threads", actor: "winston", areas: ["chat"] }],
    });
  });

  it("makes no extra reads for an issue with no area label", async () => {
    const { gh, calls } = github({ "/users/shawn": { name: "Shawn" } });
    const { payload } = await buildWorkStarted({
      event: event({ issue: issue(12, "Activity page", ["in-progress"]) }),
      gh,
    });
    assert.deepEqual(payload, { event: "work_started", number: 12, title: "Activity page", actor: "Shawn" });
    assert.equal(calls.length, 1);
  });

  for (const [why, over] of [
    ["another label", { label: { name: "P2" } }],
    ["a pull request", { issue: { ...issue(12, "T", ["in-progress"]), pull_request: {} } }],
    ["a routine-state issue", { issue: issue(12, "T", ["in-progress", "routine-state"]) }],
    ["an incident", { issue: issue(12, "T", ["in-progress", "incident"]) }],
    ["a bot's label", { sender: { login: "github-actions[bot]", type: "Bot" } }],
  ]) {
    it(`skips ${why}`, async () => {
      const { gh, calls } = github({});
      const built = await buildWorkStarted({ event: event(over), gh });
      assert.ok(built.skip);
      assert.equal(calls.length, 0);
    });
  }
});

describe("dev-log: pull request merged", () => {
  const pr = (over = {}) => ({
    number: 40,
    title: "Fix the badge",
    user: human("evan"),
    merged_at: "2026-11-11T12:00:00Z",
    merge_commit_sha: SHA,
    labels: [],
    ...over,
  });
  const build = async (pulls) => {
    const { gh } = github({ [`/commits/${SHA}/pulls`]: pulls, "/users/evan": { name: "Evan" } });
    return buildPrMerged({ sha: SHA, repo: REPO, gh });
  };

  it("names the pull request this commit merged, and its author", async () => {
    assert.deepEqual((await build([pr()])).payload, {
      event: "pr_merged",
      number: 40,
      title: "Fix the badge",
      actor: "Evan",
    });
  });

  it("skips a commit that merged nothing, a bot's pull request, and routine machinery", async () => {
    assert.ok((await build([])).skip);
    // Associated with the commit, but merged as a different one.
    assert.ok((await build([pr({ merge_commit_sha: "f".repeat(40) })])).skip);
    assert.ok((await build([pr({ merged_at: null })])).skip);
    assert.ok((await build([pr({ user: { login: "dependabot[bot]", type: "Bot" } })])).skip);
    assert.ok((await build([pr({ labels: labels("routine-state") })])).skip);
  });

  it("fails rather than guessing when GitHub cannot be read", async () => {
    const { gh } = github({ [`/commits/${SHA}/pulls`]: new Response("{}", { status: 500 }) });
    await assert.rejects(buildPrMerged({ sha: SHA, repo: REPO, gh }), /HTTP 500/);
  });
});

describe("dev-log: daily summary", () => {
  const now = new Date("2026-11-11T13:07:00Z");

  it("counts the last day's human merges per person and lists what is in progress", async () => {
    const { gh, calls } = github({
      "/search/issues": {
        items: [
          { number: 40, title: "Fix the badge", user: human("evan"), labels: [] },
          { number: 43, title: "Fix the list", user: human("shawn"), labels: [] },
          { number: 44, title: "Fix the sheet", user: human("shawn"), labels: [] },
          { number: 41, title: "Bump deps", user: { login: "dependabot[bot]", type: "Bot" }, labels: [] },
          { number: 42, title: "Ledger", user: human("paul"), labels: labels("routine-state") },
        ],
      },
      "labels=in-progress": [{ number: 9, title: "Chat threads", labels: labels("area:chat"), assignees: [human("winston")] }],
      "/issues/9/events": [],
      "/users/": { name: null },
    });
    const { payload } = await buildDailySummary({ repo: REPO, gh, now });
    assert.deepEqual(payload, {
      event: "daily_summary",
      date: "2026-11-11",
      merged_total: 3,
      merged_by: [
        { actor: "shawn", count: 2 },
        { actor: "evan", count: 1 },
      ],
      // No label event to read, so the assignee.
      in_progress: [{ number: 9, title: "Chat threads", actor: "winston", areas: ["chat"] }],
    });
    const search = decodeURIComponent(calls.find((c) => c.url.includes("/search/issues")).url);
    assert.match(search, /repo:pdcarlson\/Frapp is:pr is:merged base:main merged:>=2026-11-10T13:07:00Z/);
  });

  it("posts nothing on a day with nothing to say", async () => {
    const { gh } = github({ "/search/issues": { items: [] }, "labels=in-progress": [] });
    assert.ok((await buildDailySummary({ repo: REPO, gh, now })).skip);
  });
});

describe("dev-log: update pushed", () => {
  const job = (name, conclusion = "success") => ({ name, conclusion });
  const SHIP = job(`${SHIPPED_JOB} / release`);
  const build = async (jobs, runId = "35722904165") => {
    const { gh } = github({ "/actions/runs/35722904165/jobs": { jobs } });
    return buildUpdatePushed({ runId, repo: REPO, gh });
  };

  it("posts for a run that shipped, naming what else it shipped", async () => {
    assert.deepEqual((await build([SHIP])).payload, { event: "update_pushed", run_id: "35722904165" });
    assert.deepEqual(
      (
        await build([
          SHIP,
          job(`Build the live SHA for the stores (does not roll back a live ship) / ${STORE_BUILD_JOB}`),
          job(`Publish the live SHA as an OTA update (does not roll back a live ship) / ${OTA_UPDATE_JOB}`),
        ])
      ).payload,
      { event: "update_pushed", run_id: "35722904165", store_build: true, ota_update: true },
    );
  });

  it("leaves out an app job that failed or was skipped", async () => {
    const { payload } = await build([SHIP, job(`x / ${STORE_BUILD_JOB}`, "failure"), job(`x / ${OTA_UPDATE_JOB}`, "skipped")]);
    assert.deepEqual(payload, { event: "update_pushed", run_id: "35722904165" });
  });

  it("skips a run that did not ship: a dry run, migrations only, a failed deploy", async () => {
    // None of them mints the tag, whatever else succeeded.
    assert.ok((await build([job("Migrate, then ship Render + Vercel / deploy")])).skip);
    assert.ok((await build([job(`${SHIPPED_JOB} / release`, "skipped")])).skip);
    assert.ok((await build([job(`${SHIPPED_JOB} / release`, "failure")])).skip);
    assert.ok((await build([])).skip);
  });

  it("skips without a run id", async () => {
    assert.ok((await build([SHIP], "")).skip);
  });

  it("matches job names the workflows still have", () => {
    const text = (file) => readFileSync(join(WORKFLOW_DIR, file), "utf8");
    assert.ok(text("deploy-production.yml").includes(`name: ${SHIPPED_JOB}`));
    assert.ok(text("_mobile-build.yml").includes(`name: ${STORE_BUILD_JOB}`));
    assert.ok(text("_mobile-update.yml").includes(`name: ${OTA_UPDATE_JOB}`));
  });
});

describe("dev-log: the post", () => {
  it("sends the facts with the bearer token to the one route", async () => {
    const { fetchImpl, calls } = fakeFetch({ "/v1/integrations/dev-log": { status: "posted" } });
    const status = await postDevLog({
      apiUrl: "https://api.example.test/",
      token: "secret-token",
      payload: { event: "pr_merged", number: 40, title: "T", actor: "A" },
      fetchImpl,
      retryOptions: NO_WAIT,
    });
    assert.equal(status, "posted");
    assert.equal(calls[0].url, "https://api.example.test/v1/integrations/dev-log");
    assert.equal(calls[0].init.method, "POST");
    assert.equal(calls[0].init.headers.Authorization, "Bearer secret-token");
    assert.deepEqual(JSON.parse(calls[0].init.body), { event: "pr_merged", number: 40, title: "T", actor: "A" });
  });

  it("retries a failed send, which the API's dedupe makes safe", async () => {
    let attempts = 0;
    const fetchImpl = async () => {
      attempts += 1;
      return attempts === 1 ? new Response("", { status: 502 }) : new Response('{"status":"duplicate"}', { status: 200 });
    };
    const status = await postDevLog({
      apiUrl: "https://api.example.test",
      token: "t",
      payload: {},
      fetchImpl,
      retryOptions: { sleep: async () => {} },
    });
    assert.equal(status, "duplicate");
    assert.equal(attempts, 2);
  });

  it("fails on a refusal, without echoing the token", async () => {
    const { fetchImpl } = fakeFetch({ "/v1/integrations/dev-log": new Response('{"message":"dev_log.token.invalid"}', { status: 401 }) });
    await assert.rejects(
      postDevLog({ apiUrl: "https://api.example.test", token: "secret-token", payload: {}, fetchImpl, retryOptions: NO_WAIT }),
      (error) => /HTTP 401/.test(error.message) && !error.message.includes("secret-token"),
    );
  });
});

describe("dev-log: main", () => {
  it("says so and exits 0, calling nothing, before the token is set up", async () => {
    const { fetchImpl, calls } = fakeFetch({});
    const lines = [];
    const code = await main({ env: { DEV_LOG_EVENT: "pr_merged" }, fetchImpl, log: (line) => lines.push(line) });
    assert.equal(code, 0);
    assert.equal(calls.length, 0);
    assert.match(lines[0], /DEV_LOG_TOKEN is not set/);
  });

  it("posts a labelled issue from the event file to production's API by default", async () => {
    const dir = mkdtempSync(join(tmpdir(), "dev-log-"));
    try {
      const eventPath = join(dir, "event.json");
      writeFileSync(
        eventPath,
        JSON.stringify({ label: { name: "in-progress" }, sender: human("paul"), issue: { number: 3, title: "T", labels: [] } }),
      );
      const { fetchImpl, calls } = fakeFetch({ "/users/paul": { name: "Paul" }, "/v1/integrations/dev-log": { status: "posted" } });
      const code = await main({
        env: { DEV_LOG_EVENT: "work_started", DEV_LOG_TOKEN: "t", GITHUB_TOKEN: "gh", GITHUB_REPOSITORY: REPO, GITHUB_EVENT_PATH: eventPath },
        fetchImpl,
        log: () => {},
        retryOptions: NO_WAIT,
      });
      assert.equal(code, 0);
      const post = calls.at(-1);
      assert.equal(post.url, "https://api.frapp.live/v1/integrations/dev-log");
      assert.deepEqual(JSON.parse(post.init.body), { event: "work_started", number: 3, title: "T", actor: "Paul" });
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("rejects an event it does not know", async () => {
    await assert.rejects(main({ env: { DEV_LOG_EVENT: "nope", DEV_LOG_TOKEN: "t" }, log: () => {} }), /Unknown DEV_LOG_EVENT/);
  });
});

describe("dev-log: the workflows", () => {
  const WORKFLOW = join(WORKFLOW_DIR, "dev-log.yml");
  const DEPLOY = join(WORKFLOW_DIR, "deploy-production.yml");

  it("dev-log.yml reads its token from the automation environment and never on a pull_request run", () => {
    const text = readFileSync(WORKFLOW, "utf8");
    const [job] = workflowJobs(WORKFLOW);
    assert.equal(job.jobId, "post");
    assert.equal(job.keys.get("environment").get("name"), "automation");
    // A pull_request run could not read an automation secret, and
    // pull_request_target would hand one to a fork's code.
    assert.doesNotMatch(text, /^\s*pull_request(_target)?:/m);
    const post = workflowSteps(WORKFLOW).find((step) => step.name === "Post");
    assert.equal(post.env.get("DEV_LOG_TOKEN"), "${{ secrets.DEV_LOG_TOKEN }}");
    assert.match(post.body, /^\s*run: node scripts\/ci\/dev-log\.mjs$/m);
  });

  it("follows Deploy production from outside it, so a post can never fail or gate a ship", () => {
    const text = readFileSync(WORKFLOW, "utf8");
    assert.match(text, /workflow_run:\n\s+workflows: \["Deploy production"\]\n\s+types: \[completed\]/);
    assert.doesNotMatch(readFileSync(DEPLOY, "utf8"), /dev-log/);
    const post = workflowSteps(WORKFLOW).find((step) => step.name === "Post");
    assert.equal(post.env.get("WORKFLOW_RUN_ID"), "${{ github.event.workflow_run.id }}");
  });
});
