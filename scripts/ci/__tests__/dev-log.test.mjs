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
  DEPLOY_JOB,
  DRY_RUN_TITLE,
  MIGRATIONS_ONLY_SCOPE,
  OTA_UPDATE_JOB,
  STORE_CONFIRM_JOB,
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
    const { payload } = await buildWorkStarted({ event: event(), runId: "77", gh });
    assert.deepEqual(payload, {
      event: "work_started",
      run_id: "77",
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
      runId: "77",
      gh,
    });
    assert.deepEqual(payload, { event: "work_started", run_id: "77", number: 12, title: "Activity page", actor: "Shawn" });
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
      const built = await buildWorkStarted({ event: event(over), runId: "77", gh });
      assert.ok(built.skip);
      assert.equal(calls.length, 0);
    });
  }
});

describe("dev-log: who started an issue", () => {
  it("reads past the first page of a long-lived issue's events", async () => {
    const labeled = (login) => ({ event: "labeled", label: { name: "in-progress" }, actor: human(login) });
    const filler = Array.from({ length: 99 }, () => ({ event: "commented" }));
    const { gh } = github({
      "/issues/9/events?per_page=100&page=1": [labeled("paul"), ...filler],
      "/issues/9/events?per_page=100&page=2": [labeled("winston")],
    });
    assert.equal(await gh.startedBy({ number: 9 }), "winston");
  });
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
  const SHIP = job(`${DEPLOY_JOB} / deploy`);
  const TAG_FAILED = job("Mint v* tag (does not roll back a live ship) / release", "failure");
  const STORE = (conclusion) => job(`Build the live SHA for the stores (does not roll back a live ship) / ${STORE_CONFIRM_JOB}`, conclusion);
  const OTA = (conclusion) => job(`Publish the live SHA as an OTA update (does not roll back a live ship) / ${OTA_UPDATE_JOB}`, conclusion);
  const build = async (jobs, { title = `full ${SHA}`, runId = "35722904165" } = {}) => {
    const { gh } = github({ "/actions/runs/35722904165/jobs": { jobs }, "/actions/runs/35722904165": { display_title: title } });
    return buildUpdatePushed({ runId, repo: REPO, gh });
  };

  it("posts for a run that shipped, naming what else it shipped", async () => {
    assert.deepEqual((await build([SHIP])).payload, { event: "update_pushed", run_id: "35722904165" });
    assert.deepEqual((await build([SHIP, STORE(), OTA()])).payload, {
      event: "update_pushed",
      run_id: "35722904165",
      store_build: true,
      ota_update: true,
    });
  });

  it("still posts when the tag failed after the hosts went live", async () => {
    assert.deepEqual((await build([SHIP, TAG_FAILED])).payload, { event: "update_pushed", run_id: "35722904165" });
  });

  it("leaves out an app job that failed or was skipped, and a build nobody confirmed", async () => {
    const built = job("x / Build on EAS, then upload to TestFlight / Play internal");
    const { payload } = await build([SHIP, built, STORE("failure"), OTA("skipped")]);
    assert.deepEqual(payload, { event: "update_pushed", run_id: "35722904165" });
  });

  it("skips a run that did not ship: a dry run, migrations only, a failed deploy", async () => {
    // The deploy job succeeds on a dry run and a migrations-only run too; the run's title tells them apart.
    assert.ok((await build([SHIP], { title: `DRY RUN · full ${SHA}` })).skip);
    assert.ok((await build([SHIP], { title: `migrations-only ${SHA}` })).skip);
    assert.ok((await build([job(`${DEPLOY_JOB} / deploy`, "failure")])).skip);
    assert.ok((await build([])).skip);
  });

  it("skips without a run id", async () => {
    assert.ok((await build([SHIP], { runId: "" })).skip);
  });

  it("matches the names and run title the workflows still have", () => {
    const text = (file) => readFileSync(join(WORKFLOW_DIR, file), "utf8");
    const deploy = text("deploy-production.yml");
    assert.ok(deploy.includes(`name: ${DEPLOY_JOB}`));
    assert.ok(deploy.includes(`run-name: "\${{ inputs.dry_run_only == true && '${DRY_RUN_TITLE} · ' || '' }}\${{ inputs.scope }} `));
    assert.ok(deploy.includes(`options: [full, ${MIGRATIONS_ONLY_SCOPE}]`));
    assert.ok(text("_mobile-build.yml").includes(`name: ${STORE_CONFIRM_JOB}`));
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

  it("reports off, not a failure, when the API has no Dev log configured", async () => {
    const { fetchImpl } = fakeFetch({ "/v1/integrations/dev-log": new Response('{"statusCode":404}', { status: 404 }) });
    assert.equal(await postDevLog({ apiUrl: "https://api.example.test", token: "t", payload: {}, fetchImpl, retryOptions: NO_WAIT }), "off");
  });

  it("fails on a 200 that is not the API's answer", async () => {
    for (const body of ["<html>proxy</html>", "{}", '{"status":"ok"}']) {
      const { fetchImpl } = fakeFetch({ "/v1/integrations/dev-log": new Response(body, { status: 200 }) });
      await assert.rejects(
        postDevLog({ apiUrl: "https://api.example.test", token: "t", payload: {}, fetchImpl, retryOptions: NO_WAIT }),
        /not the API's answer/,
      );
    }
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
        env: {
          DEV_LOG_EVENT: "work_started",
          DEV_LOG_TOKEN: "t",
          GITHUB_TOKEN: "gh",
          GITHUB_REPOSITORY: REPO,
          GITHUB_EVENT_PATH: eventPath,
          GITHUB_RUN_ID: "77",
        },
        fetchImpl,
        log: () => {},
        retryOptions: NO_WAIT,
      });
      assert.equal(code, 0);
      const post = calls.at(-1);
      assert.equal(post.url, "https://api.frapp.live/v1/integrations/dev-log");
      assert.deepEqual(JSON.parse(post.init.body), { event: "work_started", run_id: "77", number: 3, title: "T", actor: "Paul" });
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  // The names the workflow sets are the names main() reads: a mismatch skips every post, green.
  const run = async (env, routes) => {
    const { fetchImpl, calls } = fakeFetch({ ...routes, "/v1/integrations/dev-log": { status: "posted" } });
    const code = await main({
      env: { DEV_LOG_TOKEN: "t", GITHUB_TOKEN: "gh", GITHUB_REPOSITORY: REPO, DEV_LOG_API_URL: "https://api.example.test", ...env },
      fetchImpl,
      log: () => {},
      retryOptions: NO_WAIT,
    });
    const post = calls.find((c) => c.url.endsWith("/v1/integrations/dev-log"));
    return { code, body: post ? JSON.parse(post.init.body) : null };
  };

  it("posts a merge from GITHUB_SHA", async () => {
    const { body } = await run(
      { DEV_LOG_EVENT: "pr_merged", GITHUB_SHA: SHA },
      {
        [`/commits/${SHA}/pulls`]: [{ number: 40, title: "T", user: human("evan"), merged_at: "x", merge_commit_sha: SHA, labels: [] }],
        "/users/evan": { name: "Evan" },
      },
    );
    assert.deepEqual(body, { event: "pr_merged", number: 40, title: "T", actor: "Evan" });
  });

  it("posts an update from WORKFLOW_RUN_ID", async () => {
    const { body } = await run(
      { DEV_LOG_EVENT: "update_pushed", WORKFLOW_RUN_ID: "35722904165" },
      {
        "/actions/runs/35722904165/jobs": { jobs: [{ name: `${DEPLOY_JOB} / deploy`, conclusion: "success" }] },
        "/actions/runs/35722904165": { display_title: `full ${SHA}` },
      },
    );
    assert.deepEqual(body, { event: "update_pushed", run_id: "35722904165" });
  });

  it("exits 0 when the API says the Dev log is off", async () => {
    const { fetchImpl } = fakeFetch({
      "/actions/runs/1/jobs": { jobs: [{ name: `${DEPLOY_JOB} / deploy`, conclusion: "success" }] },
      "/actions/runs/1": { display_title: `full ${SHA}` },
      "/v1/integrations/dev-log": new Response("{}", { status: 404 }),
    });
    const lines = [];
    const code = await main({
      env: { DEV_LOG_EVENT: "update_pushed", DEV_LOG_TOKEN: "t", GITHUB_TOKEN: "gh", GITHUB_REPOSITORY: REPO, WORKFLOW_RUN_ID: "1" },
      fetchImpl,
      log: (line) => lines.push(line),
      retryOptions: NO_WAIT,
    });
    assert.equal(code, 0);
    assert.match(lines[0], /not configured there/);
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

  it("maps each trigger to its event, and only the in-progress label starts a job", () => {
    const text = readFileSync(WORKFLOW, "utf8");
    const [job] = workflowJobs(WORKFLOW);
    assert.equal(job.if, "github.event_name != 'issues' || github.event.label.name == 'in-progress'");
    assert.match(text, /\n  issues:\n    types: \[labeled\]\n/);
    assert.match(text, /\n  push:\n    branches: \[main\]\n/);
    assert.match(text, /\n  schedule:\n/);
    const post = workflowSteps(WORKFLOW).find((step) => step.name === "Post");
    assert.equal(
      post.env.get("DEV_LOG_EVENT"),
      "${{ github.event_name == 'issues' && 'work_started' || github.event_name == 'push' && 'pr_merged' || github.event_name == 'workflow_run' && 'update_pushed' || 'daily_summary' }}",
    );
    assert.equal(post.env.get("GITHUB_TOKEN"), "${{ secrets.GITHUB_TOKEN }}");
  });

  it("sends nothing past the caps the API validates", () => {
    // The script clips to these so a long title is cut, not refused with a 400.
    const dto = readFileSync(join(WORKFLOW_DIR, "..", "..", "apps", "api", "src", "interface", "dtos", "dev-log.dto.ts"), "utf8");
    const script = readFileSync(join(WORKFLOW_DIR, "..", "..", "scripts", "ci", "dev-log.mjs"), "utf8");
    for (const name of ["TITLE_MAX", "ACTOR_MAX", "AREA_MAX", "AREAS_MAX", "ALSO_IN_AREA_MAX", "SUMMARY_ITEMS_MAX", "MERGED_BY_MAX"]) {
      const read = (source) => source.match(new RegExp(`const ${name} = (\\d+);`))?.[1];
      assert.ok(read(dto), `${name} is not in the DTO`);
      assert.equal(read(script), read(dto), name);
    }
  });
});
