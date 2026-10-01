// Pins `resolve-deploy-sha.mjs` (#3114): what an empty `sha` on Deploy
// production resolves to. The four cases the issue names come first. Then:
// what counts as staging having deployed and verified a commit, the floor that
// keeps an empty input from resolving a rollback, the run title the deployed
// commit is read from, and the CLI wiring that hands the pick to the workflow.
//
// Production's own wiring of the step (`deploy-production.yml`) is pinned in
// `deploy-production-fence.test.mjs`, with the rest of the validate job.

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import {
  fetchStagingRuns,
  indexStagingRuns,
  renderSummary,
  resolveDeploySha,
  runCli,
  STAGING_DEPLOY_JOB,
  STAGING_VERIFY_STEP,
  stagingRunSha,
  stagingVerdict,
} from "../resolve-deploy-sha.mjs";
import { workflowJobs, workflowKeys, workflowSteps } from "./helpers/workflow-yaml.mjs";

const WORKFLOWS = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..", ".github", "workflows");
const STAGING_WORKFLOW = join(WORKFLOWS, "deploy-staging.yml");
const SHARED_DEPLOY = join(WORKFLOWS, "_deploy.yml");

const sha = (digit) => digit.repeat(40);
const FLOOR = sha("f");
const TIP = sha("c");
const MIDDLE = sha("b");
const OLDEST = sha("a");
const REPO = "owner/repo";

const commit = (s, subject, date = "2026-10-01T12:00:00Z") => ({ sha: s, date, subject });
const DEFAULT_COMMITS = [commit(TIP, "feat: newest"), commit(MIDDLE, "fix: middle"), commit(OLDEST, "docs: oldest")];

/**
 * A `git` double answering the resolver's own calls: the tag listing, the
 * tag's commit, its ancestry, and the first-parent log above it.
 */
function makeGit({ tags = "v0.7.0\nv0.6.0\n", floorOnMain = true, commits = DEFAULT_COMMITS } = {}) {
  const calls = [];
  const git = (args) => {
    calls.push(args);
    const [cmd] = args;
    if (cmd === "tag") return tags;
    if (cmd === "rev-parse") return `${FLOOR}\n`;
    if (cmd === "merge-base") {
      if (!floorOnMain) throw new Error("exit 1");
      return "";
    }
    if (cmd === "log") {
      const max = Number(args.find((a) => a.startsWith("--max-count=")).split("=")[1]);
      return commits
        .slice(0, max)
        .map((c) => `${c.sha}\t${c.date}\t${c.subject}`)
        .join("\n");
    }
    throw new Error(`unexpected git ${args.join(" ")}`);
  };
  return { git, calls };
}

/**
 * A Deploy staging run naming `deployed`, with its latest-attempt jobs as the
 * jobs API lists them: the called deploy job (`deploy / deploy`) with its plan
 * and verify steps, and the two jobs beside it.
 */
let nextId = 1000;
function run(
  deployed,
  {
    id = nextId++,
    started = "2026-10-01T12:00:00Z",
    status = "completed",
    conclusion = "success",
    deploy = "success",
    verify = "success",
    prune = "success",
    steps,
  } = {},
) {
  const deployDone = deploy !== "in_progress" && deploy !== "queued";
  const deployJob = {
    name: `${STAGING_DEPLOY_JOB} / deploy`,
    status: deployDone ? "completed" : deploy,
    conclusion: deployDone ? deploy : null,
    steps: steps ?? [
      { name: "Plan the deploy", conclusion: "success" },
      { name: STAGING_VERIFY_STEP, conclusion: verify },
    ],
  };
  return {
    id,
    run_started_at: started,
    status,
    conclusion: status === "completed" ? conclusion : null,
    display_title: `staging ${deployed}`,
    html_url: `https://github.com/${REPO}/actions/runs/${id}`,
    jobs: [
      deployJob,
      { name: "deploy-outcome", status: "completed", conclusion: "success", steps: [] },
      { name: "prune-vercel-staging", status: "completed", conclusion: prune, steps: [] },
    ],
  };
}

/**
 * The Actions API as the resolver reads it: the runs listing (newest first, as
 * GitHub returns it) and each run's latest-attempt jobs. `jobs` isn't a field
 * of a listed run; the double serves it from the jobs endpoint.
 */
function api(runs, { seen = [], failJobs = false } = {}) {
  return async (url) => {
    seen.push(String(url));
    const jobsMatch = /\/actions\/runs\/(\d+)\/jobs/.exec(String(url));
    if (jobsMatch) {
      if (failJobs) return { ok: false, status: 502, text: async () => "bad gateway" };
      const found = runs.find((r) => String(r.id) === jobsMatch[1]);
      return { ok: true, status: 200, text: async () => JSON.stringify({ jobs: found?.jobs ?? [] }) };
    }
    const listed = runs.map(({ jobs, ...rest }) => rest);
    return { ok: true, status: 200, text: async () => JSON.stringify({ workflow_runs: listed }) };
  };
}

/** A `validateDeploySha` double: green unless `red` names the commit. */
function makeValidate(red = {}) {
  const asked = [];
  const validate = async ({ sha: s }) => {
    asked.push(s);
    return red[s] ? { ok: false, reason: red[s] } : { ok: true, reason: null };
  };
  return { validate, asked };
}

const resolve = (opts) =>
  resolveDeploySha({ repo: REPO, token: "t", retryOptions: { attempts: 1, sleep: async () => {} }, ...opts });

describe("resolveDeploySha — the four cases #3114 names", () => {
  it("takes the tip when its checks and its staging deploy are both green", async () => {
    const { git } = makeGit();
    const { validate } = makeValidate();
    const result = await resolve({ git, validate, fetchImpl: api([run(TIP), run(MIDDLE)]) });
    assert.equal(result.ok, true);
    assert.equal(result.sha, TIP);
    assert.equal(result.subject, "feat: newest");
    assert.deepEqual(result.skipped, []);
  });

  it("falls back past a tip whose CI is still running", async () => {
    const { git } = makeGit();
    const ciRunning = `CI is not green on ${TIP} — still running: api-tests (in_progress)`;
    const { validate, asked } = makeValidate({ [TIP]: ciRunning });
    // No staging run for the tip yet: it starts when CI completes.
    const result = await resolve({ git, validate, fetchImpl: api([run(MIDDLE)]) });
    assert.equal(result.ok, true);
    assert.equal(result.sha, MIDDLE);
    assert.deepEqual(asked, [TIP, MIDDLE], "with no staging run, CI is asked, because it says more");
    assert.equal(result.skipped.length, 1);
    assert.equal(result.skipped[0].sha, TIP);
    assert.equal(result.skipped[0].reason, ciRunning);
  });

  it("falls back past a tip whose CI is green and whose staging deploy failed", async () => {
    const { git } = makeGit();
    const { validate, asked } = makeValidate();
    const failed = run(TIP, { conclusion: "failure", deploy: "failure" });
    const result = await resolve({ git, validate, fetchImpl: api([failed, run(MIDDLE)]) });
    assert.equal(result.ok, true);
    assert.equal(result.sha, MIDDLE);
    assert.deepEqual(asked, [MIDDLE], "a failed staging deploy settles it without asking CI");
    assert.match(result.skipped[0].reason, /Deploy staging deploy concluded failure/);
    assert.ok(result.skipped[0].reason.includes(failed.html_url));
  });

  it("fails, naming every commit and why, when nothing in range is eligible", async () => {
    const { git } = makeGit();
    const { validate } = makeValidate({ [MIDDLE]: "CI is not green — failed: api-tests (failure)" });
    const runs = [
      run(TIP, { status: "in_progress", deploy: "in_progress" }),
      run(OLDEST, { conclusion: "failure", deploy: "cancelled" }),
    ];
    const result = await resolve({ git, validate, fetchImpl: api(runs) });
    assert.equal(result.ok, false);
    assert.match(result.reason, /None of the 3 commits above production's v0\.7\.0/);
    assert.match(result.reason, /paste its SHA/);
    assert.deepEqual(
      result.skipped.map((c) => c.sha),
      [TIP, MIDDLE, OLDEST],
    );
    assert.match(result.skipped[0].reason, /deploy is still in_progress/);
    assert.match(result.skipped[1].reason, /failed: api-tests/);
    assert.match(result.skipped[2].reason, /deploy concluded cancelled.*replaced it while it was queued/);
  });
});

describe("resolveDeploySha — staging must have deployed and verified the commit", () => {
  // A `stale` plan that ships nothing, including one that couldn't tell what
  // staging serves, skips the verify step and still concludes success.
  it("skips a run that succeeded but shipped and verified nothing", async () => {
    const { git } = makeGit();
    const { validate, asked } = makeValidate();
    const result = await resolve({ git, validate, fetchImpl: api([run(TIP, { verify: "skipped" }), run(MIDDLE)]) });
    assert.equal(result.sha, MIDDLE);
    assert.deepEqual(asked, [MIDDLE]);
    assert.match(result.skipped[0].reason, /shipped and verified nothing.*plan `stale`/);
  });

  // `prune-vercel-staging` is housekeeping beside the deploy: its failure reds
  // the run, and must not read as a failed deploy.
  it("takes a commit whose deploy verified it even when housekeeping reddened the run", async () => {
    const { git } = makeGit();
    const pruneFailed = run(TIP, { conclusion: "failure", prune: "failure" });
    const result = await resolve({ git, validate: makeValidate().validate, fetchImpl: api([pruneFailed]) });
    assert.equal(result.ok, true);
    assert.equal(result.sha, TIP);
  });

  it("refuses a deploy job with no verify step rather than assume it verified", () => {
    const noVerify = run(TIP, { steps: [{ name: "Plan the deploy", conclusion: "success" }] });
    assert.ok(stagingVerdict(noVerify, noVerify.jobs).includes(`no "${STAGING_VERIFY_STEP}" step`));
  });

  it("refuses a completed run with no deploy job", () => {
    const r = run(TIP);
    assert.match(stagingVerdict(r, r.jobs.slice(1)), /lists 0 `deploy` jobs/);
  });

  it("reads a deploy that verified as no objection, whatever the run's own conclusion", () => {
    const r = run(TIP, { conclusion: "failure", prune: "failure" });
    assert.equal(stagingVerdict(r, r.jobs), null);
  });

  it("refuses rather than resolve when a run's jobs can't be read", async () => {
    const { git } = makeGit();
    const result = await resolve({ git, validate: makeValidate().validate, fetchImpl: api([run(TIP)], { failJobs: true }) });
    assert.equal(result.ok, false);
    assert.match(result.reason, /Could not read Deploy staging run \d+: .*HTTP 502/);
  });

  it("refuses rather than resolve when the runs API can't be read", async () => {
    const { git } = makeGit();
    const fetchImpl = async () => ({ ok: false, status: 503, text: async () => "unavailable" });
    const result = await resolve({ git, validate: makeValidate().validate, fetchImpl });
    assert.equal(result.ok, false);
    assert.match(result.reason, /Could not read Deploy staging runs: .*HTTP 503/);
  });

  it("skips a commit with green CI and no staging run, saying why", async () => {
    const { git } = makeGit();
    const result = await resolve({ git, validate: makeValidate().validate, fetchImpl: api([run(MIDDLE)]) });
    assert.equal(result.sha, MIDDLE);
    assert.match(result.skipped[0].reason, /green, but no Deploy staging run names it/);
  });
});

describe("indexStagingRuns — the newest run for a commit speaks for it", () => {
  // Listed newest first, as the API lists them, so taking whichever is listed
  // last would pick the OLDER run.
  it("lets a newer cancelled run win over an older green one", async () => {
    const { git } = makeGit();
    const runs = [
      run(TIP, { id: 2, started: "2026-10-01T11:00:00Z", conclusion: "failure", deploy: "cancelled" }),
      run(TIP, { id: 1, started: "2026-10-01T10:00:00Z" }),
      run(MIDDLE),
    ];
    const result = await resolve({ git, validate: makeValidate().validate, fetchImpl: api(runs) });
    assert.equal(result.sha, MIDDLE);
    assert.match(result.skipped[0].reason, /concluded cancelled/);
  });

  // A re-run keeps its id. An older run re-run after a newer one finished is
  // the commit's latest outcome, so the id alone would hide it.
  it("goes by the latest attempt's start, so a failed re-run of an older run isn't hidden", () => {
    const newer = run(TIP, { id: 200, started: "2026-10-01T11:00:00Z" });
    const reRunOlder = run(TIP, { id: 100, started: "2026-10-01T12:00:00Z", deploy: "failure" });
    assert.equal(indexStagingRuns([newer, reRunOlder]).get(TIP).id, 100);
    assert.equal(indexStagingRuns([reRunOlder, newer]).get(TIP).id, 100);
  });

  it("breaks a tie on start time by the higher id", () => {
    const a = run(TIP, { id: 5, started: "2026-10-01T11:00:00Z" });
    const b = run(TIP, { id: 6, started: "2026-10-01T11:00:00Z" });
    assert.equal(indexStagingRuns([a, b]).get(TIP).id, 6);
    assert.equal(indexStagingRuns([b, a]).get(TIP).id, 6);
  });

  // A skipped run's jobs never ran: its CI didn't succeed on a push to main,
  // which the commit's own required checks report.
  it("ignores a skipped run", async () => {
    const { git } = makeGit();
    const runs = [run(TIP, { id: 2, started: "2026-10-01T13:00:00Z", conclusion: "skipped" }), run(TIP, { id: 1 })];
    const result = await resolve({ git, validate: makeValidate().validate, fetchImpl: api(runs) });
    assert.equal(result.sha, TIP);
    assert.equal(result.stagingRun.id, 1);
    assert.equal(indexStagingRuns([run(MIDDLE, { conclusion: "skipped" })]).size, 0);
  });
});

describe("resolveDeploySha — the floor: an empty sha never resolves a rollback", () => {
  it("walks only the commits above the latest release tag", async () => {
    const { git, calls } = makeGit();
    await resolve({ git, validate: makeValidate().validate, fetchImpl: api([run(TIP)]) });
    const log = calls.find((c) => c[0] === "log");
    assert.ok(log.includes("origin/main"));
    assert.ok(log.includes(`^${FLOOR}`), "the tag's commit and everything behind it are excluded");
    assert.ok(log.includes("--first-parent"));
    assert.deepEqual(calls[0], ["tag", "--list", "v*", "--sort=-version:refname"]);
  });

  // `release.yml` takes the top tag as it is, so a reader that stepped past a
  // stray one would disagree with the next release about what is live.
  it("refuses when the latest v* tag is not a vX.Y.Z release", async () => {
    const { git } = makeGit({ tags: "v1.9.0-rc1\nv0.7.0\n" });
    const result = await resolve({ git, validate: makeValidate().validate, fetchImpl: api([run(TIP)]) });
    assert.equal(result.ok, false);
    assert.match(result.reason, /the latest v\* tag, v1\.9\.0-rc1, is not a vX\.Y\.Z release/);
  });

  it("refuses when there is no release tag at all", async () => {
    const { git } = makeGit({ tags: "" });
    const result = await resolve({ git, validate: makeValidate().validate, fetchImpl: api([]) });
    assert.equal(result.ok, false);
    assert.match(result.reason, /the checkout holds no v\* tag/);
  });

  it("refuses when the latest tag is not on main", async () => {
    const { git } = makeGit({ floorOnMain: false });
    const result = await resolve({ git, validate: makeValidate().validate, fetchImpl: api([]) });
    assert.equal(result.ok, false);
    assert.match(result.reason, /is not an ancestor of origin\/main/);
  });

  it("refuses when main has nothing newer than the tag", async () => {
    const { git } = makeGit({ commits: [] });
    const result = await resolve({ git, validate: makeValidate().validate, fetchImpl: api([]) });
    assert.equal(result.ok, false);
    assert.match(result.reason, /nothing newer than production's v0\.7\.0/);
  });

  it("reads at most `limit` commits and says when there were more", async () => {
    const { git } = makeGit();
    const { validate } = makeValidate({ [TIP]: "red", [MIDDLE]: "red" });
    const result = await resolve({ git, validate, limit: 2, fetchImpl: api([]) });
    assert.equal(result.ok, false);
    assert.equal(result.truncated, true);
    assert.equal(result.skipped.length, 2);
    assert.match(result.reason, /the newest 2 commits above production's v0\.7\.0 \(older ones were not read\)/);
  });
});

describe("fetchStagingRuns — which runs are read", () => {
  // The window has to reach the OLDEST candidate's run: anchored on the tip,
  // an older commit's run falls outside it, reads as "no run", and the
  // fall-back past a tip whose CI is still running never finds anything.
  it("reads runs created since a day before the oldest candidate", async () => {
    const commits = [
      commit(TIP, "feat: newest", "2026-10-03T09:00:00Z"),
      commit(MIDDLE, "fix: middle", "2026-10-02T09:00:00Z"),
      commit(OLDEST, "docs: oldest", "2026-09-30T09:00:00Z"),
    ];
    const { git } = makeGit({ commits });
    const seen = [];
    await resolve({ git, validate: makeValidate().validate, fetchImpl: api([run(TIP)], { seen }) });
    const listing = new URL(seen.find((u) => u.includes("/workflows/")));
    assert.equal(listing.searchParams.get("created"), ">=2026-09-29T09:00:00.000Z");
  });

  it("asks GitHub for main's workflow_run runs of Deploy staging", async () => {
    const seen = [];
    await fetchStagingRuns({ repo: REPO, token: "t", since: "2026-09-30T12:00:00.000Z", fetchImpl: api([], { seen }) });
    assert.equal(seen.length, 1);
    const url = new URL(seen[0]);
    assert.equal(url.pathname, `/repos/${REPO}/actions/workflows/deploy-staging.yml/runs`);
    assert.equal(url.searchParams.get("branch"), "main");
    assert.equal(url.searchParams.get("event"), "workflow_run");
  });

  it("reads each run's jobs for its latest attempt", async () => {
    const seen = [];
    const { git } = makeGit();
    const r = run(TIP);
    await resolve({ git, validate: makeValidate().validate, fetchImpl: api([r], { seen }) });
    const jobs = new URL(seen.find((u) => u.includes("/jobs")));
    assert.equal(jobs.pathname, `/repos/${REPO}/actions/runs/${r.id}/jobs`);
    assert.equal(jobs.searchParams.get("filter"), "latest");
  });

  it("follows pagination until a short page", async () => {
    let calls = 0;
    const page = (n) => Array.from({ length: n }, () => ({ id: 1, display_title: `staging ${TIP}` }));
    const fetchImpl = async () => {
      calls += 1;
      const body = { workflow_runs: calls === 1 ? page(100) : page(3) };
      return { ok: true, status: 200, text: async () => JSON.stringify(body) };
    };
    const runs = await fetchStagingRuns({ repo: REPO, token: "t", fetchImpl });
    assert.equal(calls, 2);
    assert.equal(runs.length, 103);
  });
});

describe("the workflows the resolver reads", () => {
  it("reads the SHA standing alone in a run title", () => {
    assert.equal(stagingRunSha({ display_title: `staging ${TIP}` }), TIP);
    assert.equal(stagingRunSha({ display_title: TIP }), TIP);
  });

  it("reads nothing from a run that predates the title, or an abbreviated SHA", () => {
    assert.equal(stagingRunSha({ display_title: "Deploy staging" }), null);
    assert.equal(stagingRunSha({ display_title: "staging c29a449" }), null);
    assert.equal(stagingRunSha({ display_title: `staging ${TIP}0` }), null, "41 hex is not a SHA");
    assert.equal(stagingRunSha({}), null);
  });

  // `github.event.workflow_run.head_sha` is the commit CI verified, the one
  // `deploy` is called with. The run's own `head_sha` is main's tip when it
  // fired, which is why the title has to carry it.
  it("deploy-staging.yml's run-name carries the deployed commit where the resolver reads it", () => {
    const runName = workflowKeys(STAGING_WORKFLOW).get("run-name");
    assert.equal(typeof runName, "string", "deploy-staging.yml has no run-name");
    const HEAD_SHA = "${{ github.event.workflow_run.head_sha }}";
    assert.ok(runName.includes(HEAD_SHA), `run-name must carry ${HEAD_SHA}`);
    const deploy = workflowJobs(STAGING_WORKFLOW).find((j) => j.jobId === STAGING_DEPLOY_JOB);
    assert.equal(deploy.keys.get("with").get("sha"), HEAD_SHA, "the title names the commit the deploy job is called with");
    assert.equal(stagingRunSha({ display_title: runName.replace(HEAD_SHA, TIP) }), TIP);
  });

  // The jobs API names a called job `<caller> / <callee>`, by each job's `name`
  // or, without one, its id. A rename reads as "not verified" on every commit.
  it("finds the deploy job and its verify step by the names the resolver looks for", () => {
    const deploy = workflowJobs(STAGING_WORKFLOW).find((j) => j.jobId === STAGING_DEPLOY_JOB);
    assert.ok(deploy, `deploy-staging.yml has no job "${STAGING_DEPLOY_JOB}"`);
    assert.equal(deploy.keys.get("uses"), "./.github/workflows/_deploy.yml");
    assert.equal(deploy.keys.has("name"), false, "a name would replace the job id in the jobs API");
    const verify = workflowSteps(SHARED_DEPLOY).filter((s) => s.name === STAGING_VERIFY_STEP);
    assert.equal(verify.length, 1, `_deploy.yml has one step named "${STAGING_VERIFY_STEP}"`);
    // Skipped exactly when the plan ships nothing, which is what makes a
    // skipped verify mean "staging didn't take this commit".
    assert.equal(verify[0].if, "steps.plan.outputs.verify_sha != ''");
  });
});

describe("resolveDeploySha — green is validateDeploySha's verdict", () => {
  // The real validator, not a double, so the resolver can't grow its own
  // notion of green. Its git calls answer as for a merged commit whose
  // workflows can't be read (no narrowing), and the checks API serves one
  // required check per commit.
  it("skips a commit whose required check is still running, as a pasted SHA would be refused", async () => {
    const base = makeGit().git;
    // `cat-file` finds the commit; an empty `ls-tree` means no workflows read.
    const git = (args) => (["cat-file", "ls-tree"].includes(args[0]) ? "" : base(args));
    const checks = {
      [TIP]: [{ name: "api-tests", status: "in_progress", started_at: "2026-10-01T12:00:00Z" }],
      [MIDDLE]: [{ name: "api-tests", status: "completed", conclusion: "success", started_at: "2026-10-01T11:00:00Z" }],
    };
    const actions = api([run(TIP), run(MIDDLE)]);
    const fetchImpl = async (url) => {
      const match = /\/commits\/([0-9a-f]{40})\/check-runs/.exec(url);
      if (!match) return actions(url);
      return { ok: true, status: 200, text: async () => JSON.stringify({ check_runs: checks[match[1]] ?? [] }) };
    };
    const result = await resolve({ git, fetchImpl, required: ["api-tests"] });
    assert.equal(result.ok, true);
    assert.equal(result.sha, MIDDLE);
    assert.match(result.skipped[0].reason, /CI is not green on c+ — still running: api-tests \(in_progress\)/);
  });
});

describe("runCli — what the workflow step hands on", () => {
  const ENV = {
    GITHUB_REPOSITORY: REPO,
    GITHUB_TOKEN: "t",
    GITHUB_OUTPUT: "/out",
    GITHUB_STEP_SUMMARY: "/summary",
  };
  const quietOut = () => {
    const lines = [];
    return { lines, out: { log: (l) => lines.push(l), error: (l) => lines.push(l) } };
  };

  // `deploy-production.yml` reads `steps.resolve.outputs.sha`, and the approver
  // reads the summary: both have to come from this, not only from the library.
  it("writes the pick to GITHUB_OUTPUT as sha= and the summary to the step summary", async () => {
    const writes = [];
    const resolved = {
      ok: true,
      sha: MIDDLE,
      subject: "fix: middle",
      stagingRun: run(MIDDLE),
      floor: { tag: "v0.7.0", sha: FLOOR },
      skipped: [],
    };
    const code = await runCli({
      env: ENV,
      resolve: async () => resolved,
      append: (path, text) => writes.push({ path, text }),
      out: quietOut().out,
    });
    assert.equal(code, 0);
    assert.deepEqual(
      writes.filter((w) => w.path === "/out"),
      [{ path: "/out", text: `sha=${MIDDLE}\n` }],
    );
    assert.match(writes.find((w) => w.path === "/summary").text, new RegExp(`Newest green \`main\` commit: \`${MIDDLE}\``));
  });

  it("writes no sha and fails when nothing resolved, but still leaves the summary", async () => {
    const writes = [];
    const { lines, out } = quietOut();
    const code = await runCli({
      env: ENV,
      resolve: async () => ({ ok: false, reason: "None of the 3 commits…", floor: {}, skipped: [] }),
      append: (path, text) => writes.push({ path, text }),
      out,
    });
    assert.equal(code, 1);
    assert.equal(writes.some((w) => w.path === "/out"), false);
    assert.match(writes.find((w) => w.path === "/summary").text, /production was NOT deployed/);
    assert.ok(lines.includes("::error::None of the 3 commits…"));
  });
});

describe("renderSummary — what the approver reads before approving", () => {
  it("names the commit, its subject, its verified staging run and the floor, then the skipped commits", () => {
    const stagingRun = run(MIDDLE);
    const text = renderSummary({
      ok: true,
      sha: MIDDLE,
      subject: "fix: middle",
      stagingRun,
      floor: { tag: "v0.7.0", sha: FLOOR },
      skipped: [{ sha: TIP, subject: "feat: a | b", reason: "CI is not green" }],
      truncated: false,
      limit: 50,
    });
    assert.match(text, new RegExp(`Newest green \`main\` commit: \`${MIDDLE}\``));
    assert.match(text, /fix: middle/);
    assert.ok(text.includes(`[run ${stagingRun.id}](${stagingRun.html_url}): deployed, and "${STAGING_VERIFY_STEP}" passed`));
    assert.match(text, /`v0\.7\.0` \(`ffffffffffff`\)/);
    assert.match(text, /paste it into `sha`/);
    assert.match(text, /\| `cccccccccccc` \| feat: a \\\| b \| CI is not green \|/, "a pipe in a subject can't break the table");
  });

  it("says plainly that nothing shipped when nothing resolved", () => {
    const text = renderSummary({ ok: false, reason: "None of the 3 commits…", floor: {}, skipped: [] });
    assert.match(text, /No commit resolved: production was NOT deployed/);
    assert.match(text, /None of the 3 commits/);
  });
});
