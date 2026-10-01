// Pins `resolve-deploy-sha.mjs` (#3114): what an empty `sha` on Deploy
// production resolves to. The four cases the issue names are the first four
// below; the rest are the floor that keeps an empty input from resolving a
// rollback, and the run title it reads the deployed commit out of.
//
// Production's own wiring of the step (`deploy-production.yml`) is pinned in
// `deploy-production-fence.test.mjs`, with the rest of the validate job.

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import {
  fetchStagingRuns,
  indexStagingRuns,
  renderSummary,
  resolveDeploySha,
  stagingRunSha,
  stagingVerdict,
} from "../resolve-deploy-sha.mjs";
import { workflowKeys } from "./helpers/workflow-yaml.mjs";

const STAGING_WORKFLOW = join(
  dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
  "..",
  ".github",
  "workflows",
  "deploy-staging.yml",
);

const sha = (digit) => digit.repeat(40);
const FLOOR = sha("f");
const TIP = sha("c");
const MIDDLE = sha("b");
const OLDEST = sha("a");
const REPO = "owner/repo";

const commit = (s, subject) => ({ sha: s, date: "2026-10-01T12:00:00Z", subject });
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

let nextId = 1000;
const run = (deployed, { status = "completed", conclusion = "success", id = nextId++ } = {}) => ({
  id,
  status,
  conclusion: status === "completed" ? conclusion : null,
  display_title: `staging ${deployed}`,
  html_url: `https://github.com/${REPO}/actions/runs/${id}`,
});

function runsFetch(runs, seen = []) {
  return async (url) => {
    seen.push(url);
    return { ok: true, status: 200, text: async () => JSON.stringify({ workflow_runs: runs }) };
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
    const result = await resolve({ git, validate, fetchImpl: runsFetch([run(TIP), run(MIDDLE)]) });
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
    const result = await resolve({ git, validate, fetchImpl: runsFetch([run(MIDDLE)]) });
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
    const failed = run(TIP, { conclusion: "failure" });
    const result = await resolve({ git, validate, fetchImpl: runsFetch([failed, run(MIDDLE)]) });
    assert.equal(result.ok, true);
    assert.equal(result.sha, MIDDLE);
    assert.deepEqual(asked, [MIDDLE], "a failed staging run settles it without asking CI");
    assert.match(result.skipped[0].reason, /Deploy staging run concluded failure/);
    assert.match(result.skipped[0].reason, new RegExp(failed.html_url));
  });

  it("fails, naming every commit and why, when nothing in range is eligible", async () => {
    const { git } = makeGit();
    const { validate } = makeValidate({ [MIDDLE]: "CI is not green — failed: api-tests (failure)" });
    const runs = [run(TIP, { status: "in_progress" }), run(OLDEST, { conclusion: "cancelled" })];
    const result = await resolve({ git, validate, fetchImpl: runsFetch(runs) });
    assert.equal(result.ok, false);
    assert.match(result.reason, /None of the 3 commits above production's v0\.7\.0/);
    assert.match(result.reason, /paste its SHA/);
    assert.deepEqual(
      result.skipped.map((c) => c.sha),
      [TIP, MIDDLE, OLDEST],
    );
    assert.match(result.skipped[0].reason, /still in_progress/);
    assert.match(result.skipped[1].reason, /failed: api-tests/);
    assert.match(result.skipped[2].reason, /concluded cancelled.*replaced it while it was queued/);
  });
});

describe("resolveDeploySha — the floor: an empty sha never resolves a rollback", () => {
  it("walks only the commits above the newest release tag", async () => {
    const { git, calls } = makeGit();
    await resolve({ git, validate: makeValidate().validate, fetchImpl: runsFetch([run(TIP)]) });
    const log = calls.find((c) => c[0] === "log");
    assert.ok(log.includes("origin/main"));
    assert.ok(log.includes(`^${FLOOR}`), "the tag's commit and everything behind it are excluded");
    assert.ok(log.includes("--first-parent"));
  });

  it("finds the tag by version, as release.yml does, ignoring tags that are not releases", async () => {
    const { git, calls } = makeGit({ tags: "vercel-preview\nv0.7.0\nv0.6.0\n" });
    const result = await resolve({ git, validate: makeValidate().validate, fetchImpl: runsFetch([run(TIP)]) });
    assert.equal(result.floor.tag, "v0.7.0");
    assert.deepEqual(calls[0], ["tag", "--list", "v*", "--sort=-version:refname"]);
  });

  it("refuses when there is no release tag at all", async () => {
    const { git } = makeGit({ tags: "" });
    const result = await resolve({ git, validate: makeValidate().validate, fetchImpl: runsFetch([]) });
    assert.equal(result.ok, false);
    assert.match(result.reason, /No vX\.Y\.Z tag/);
  });

  it("refuses when the newest tag is not on main", async () => {
    const { git } = makeGit({ floorOnMain: false });
    const result = await resolve({ git, validate: makeValidate().validate, fetchImpl: runsFetch([]) });
    assert.equal(result.ok, false);
    assert.match(result.reason, /is not an ancestor of origin\/main/);
  });

  it("refuses when main has nothing newer than the tag", async () => {
    const { git } = makeGit({ commits: [] });
    const result = await resolve({ git, validate: makeValidate().validate, fetchImpl: runsFetch([]) });
    assert.equal(result.ok, false);
    assert.match(result.reason, /nothing newer than production's v0\.7\.0/);
  });

  it("reads at most `limit` commits and says when there were more", async () => {
    const { git } = makeGit();
    const { validate } = makeValidate({ [TIP]: "red", [MIDDLE]: "red" });
    const result = await resolve({ git, validate, limit: 2, fetchImpl: runsFetch([]) });
    assert.equal(result.ok, false);
    assert.equal(result.truncated, true);
    assert.equal(result.skipped.length, 2);
    assert.match(result.reason, /the newest 2 commits above production's v0\.7\.0 \(older ones were not read\)/);
  });
});

describe("resolveDeploySha — what counts as staging success", () => {
  it("skips a commit with green CI and no staging run, saying why", async () => {
    const { git } = makeGit();
    const result = await resolve({ git, validate: makeValidate().validate, fetchImpl: runsFetch([run(MIDDLE)]) });
    assert.equal(result.sha, MIDDLE);
    assert.match(result.skipped[0].reason, /green, but no Deploy staging run names it/);
  });

  it("lets the newest run for a commit win over an older green one", async () => {
    const { git } = makeGit();
    const runs = [run(TIP, { id: 1, conclusion: "success" }), run(TIP, { id: 2, conclusion: "cancelled" }), run(MIDDLE)];
    const result = await resolve({ git, validate: makeValidate().validate, fetchImpl: runsFetch(runs) });
    assert.equal(result.sha, MIDDLE);
    assert.match(result.skipped[0].reason, /concluded cancelled/);
  });

  it("refuses rather than resolves when the runs API can't be read", async () => {
    const { git } = makeGit();
    const fetchImpl = async () => ({ ok: false, status: 503, text: async () => "unavailable" });
    const result = await resolve({ git, validate: makeValidate().validate, fetchImpl });
    assert.equal(result.ok, false);
    assert.match(result.reason, /Could not read Deploy staging runs: .*HTTP 503/);
  });

  // A fork's pull request from a branch named `main` gets a Deploy staging run
  // too, all jobs skipped, titled with whatever commit it carries. Newest, it
  // would shadow the real run; ignored, CI's verdict speaks for the commit.
  it("ignores a skipped run, so it can't shadow the real one", async () => {
    const { git } = makeGit();
    const runs = [run(TIP, { id: 1 }), run(TIP, { id: 2, conclusion: "skipped" })];
    const result = await resolve({ git, validate: makeValidate().validate, fetchImpl: runsFetch(runs) });
    assert.equal(result.sha, TIP);
    assert.equal(result.stagingRun.id, 1);
    assert.equal(indexStagingRuns([run(MIDDLE, { conclusion: "skipped" })]).size, 0);
  });

  it("reads a green run as no objection, and no run as none either", () => {
    assert.equal(stagingVerdict(run(TIP)), null);
    assert.equal(stagingVerdict(undefined), null);
    assert.match(stagingVerdict(run(TIP, { conclusion: "timed_out" })), /concluded timed_out/);
  });

  it("asks GitHub for main's workflow_run runs, created since the oldest candidate", async () => {
    const seen = [];
    await fetchStagingRuns({ repo: REPO, token: "t", since: "2026-09-30T12:00:00.000Z", fetchImpl: runsFetch([], seen) });
    assert.equal(seen.length, 1);
    const url = new URL(seen[0]);
    assert.equal(url.pathname, `/repos/${REPO}/actions/workflows/deploy-staging.yml/runs`);
    assert.equal(url.searchParams.get("branch"), "main");
    assert.equal(url.searchParams.get("event"), "workflow_run");
    assert.equal(url.searchParams.get("created"), ">=2026-09-30T12:00:00.000Z");
  });

  it("follows pagination until a short page", async () => {
    let calls = 0;
    const page = (n) => Array.from({ length: n }, () => run(TIP));
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

describe("the run title is how a staging run names its commit", () => {
  it("reads the SHA standing alone in the title", () => {
    assert.equal(stagingRunSha({ display_title: `staging ${TIP}` }), TIP);
    assert.equal(stagingRunSha({ display_title: TIP }), TIP);
  });

  it("reads nothing from a run that predates the title, or an abbreviated SHA", () => {
    assert.equal(stagingRunSha({ display_title: "Deploy staging" }), null);
    assert.equal(stagingRunSha({ display_title: "staging c29a449" }), null);
    assert.equal(stagingRunSha({ display_title: `staging ${TIP}0` }), null, "41 hex is not a SHA");
    assert.equal(stagingRunSha({}), null);
  });

  it("indexes only runs that name a commit", () => {
    const index = indexStagingRuns([run(TIP), { id: 1, display_title: "Deploy staging" }]);
    assert.deepEqual([...index.keys()], [TIP]);
  });

  // `github.event.workflow_run.head_sha` is the commit CI verified, the one
  // `deploy` is called with. The run's own `head_sha` is main's tip when it
  // fired, which is why the title has to carry it.
  it("deploy-staging.yml's run-name carries the deployed commit where the resolver reads it", () => {
    const runName = workflowKeys(STAGING_WORKFLOW).get("run-name");
    assert.equal(typeof runName, "string", "deploy-staging.yml has no run-name");
    const HEAD_SHA = "${{ github.event.workflow_run.head_sha }}";
    assert.ok(runName.includes(HEAD_SHA), `run-name must carry ${HEAD_SHA}`);
    const deployedWith = readFileSync(STAGING_WORKFLOW, "utf8").match(/^\s+sha: (.+)$/m)?.[1];
    assert.equal(deployedWith, HEAD_SHA, "the title names the commit the deploy job is called with");
    assert.equal(stagingRunSha({ display_title: runName.replace(HEAD_SHA, TIP) }), TIP);
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
    const fetchImpl = async (url) => {
      const match = /\/commits\/([0-9a-f]{40})\/check-runs/.exec(url);
      const body = match ? { check_runs: checks[match[1]] ?? [] } : { workflow_runs: [run(TIP), run(MIDDLE)] };
      return { ok: true, status: 200, text: async () => JSON.stringify(body) };
    };
    const result = await resolve({ git, fetchImpl, required: ["api-tests"] });
    assert.equal(result.ok, true);
    assert.equal(result.sha, MIDDLE);
    assert.match(result.skipped[0].reason, /CI is not green on c+ — still running: api-tests \(in_progress\)/);
  });
});

describe("renderSummary — what the approver reads before approving", () => {
  it("names the commit, its subject, its staging run and the floor, then the skipped commits", () => {
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
    assert.match(text, new RegExp(`\\[run ${stagingRun.id}\\]\\(${stagingRun.html_url}\\)`));
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
