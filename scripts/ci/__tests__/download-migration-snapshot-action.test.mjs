// Behaviour tests for the find step of
// .github/actions/download-migration-snapshot/action.yml (#2518).
//
// The step is inline shell in a composite action, so it has no unit-test seam
// of its own. These tests extract its script straight out of the YAML (the
// same text-based way deploy-api-check-changes.test.mjs does) and run it
// against a stubbed `gh` that answers from fixtures. What they pin:
//
//   - the MIGRATION_SNAPSHOT_STAGING_DEPLOY export the drift gate reads, in
//     every mode. The gate treats an unset value as "overtaken", so an edit that
//     dropped or reordered the export would turn every real failed apply into
//     `stale` while the gate's own tests stayed green;
//   - that `use` counts only Deploy API (the only workflow that migrates
//     staging) and reports one still in flight;
//   - that a failed deploy lookup is a warning in `use` (the required gates on
//     main use it) and an error in `wait`;
//   - that every Actions API read retries a transient error, so one blip does
//     not fail the step, and does not retry a 4xx.
//
// `sleep` is stubbed to return at once, so retries cost nothing. The `wait`
// branch that polls is still not exercised: its deadline is wall-clock.

import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const ACTION = join(REPO_ROOT, ".github", "actions", "download-migration-snapshot", "action.yml");
const REPO = "example/repo";
const RUN_STARTED = "2026-09-23T12:00:00Z";

// The step needs bash and jq, as the runner provides. Off CI a missing jq
// skips the suite; on CI it fails, so the check can't quietly stop running.
const hasJq = spawnSync("jq", ["--version"]).status === 0;
const skip = !hasJq && !process.env.CI ? "jq is not installed" : false;

/**
 * The `Find the newest snapshot published from main` step's literal `run:`
 * block.
 *
 * The search is bounded by the step. An unbounded forward search binds to a
 * later step's script when this one's block header changes, and every case
 * then fails for a reason that isn't there (the trap
 * `helpers/workflow-yaml.mjs` describes). That helper reads workflow jobs, not
 * a composite action's `runs.steps`, so the bounded reader stays here. A
 * folded (`>`) block would change the script's lines, so only `|` is accepted.
 */
function extractFindScript() {
  const lines = readFileSync(ACTION, "utf8").split("\n");
  const stepIndex = lines.findIndex((line) => /^\s*- name: Find the newest snapshot published from main\s*$/.test(line));
  assert.notEqual(stepIndex, -1, "find step not found in download-migration-snapshot/action.yml");
  const stepIndent = lines[stepIndex].match(/^\s*/)[0].length;
  let stepEnd = lines.findIndex(
    (line, i) => i > stepIndex && line.trim() !== "" && line.match(/^\s*/)[0].length <= stepIndent,
  );
  if (stepEnd === -1) stepEnd = lines.length;
  const runIndex = lines.findIndex((line, i) => i > stepIndex && i < stepEnd && /^\s*run:\s*\|[-+]?\s*$/.test(line));
  assert.notEqual(runIndex, -1, "the find step has no literal `run: |` block of its own");

  const runIndent = lines[runIndex].match(/^\s*/)[0].length;
  const body = [];
  for (let i = runIndex + 1; i < stepEnd; i += 1) {
    const line = lines[i];
    if (line.trim() === "") {
      body.push("");
      continue;
    }
    if (line.match(/^\s*/)[0].length <= runIndent) break;
    body.push(line.slice(runIndent + 2));
  }
  const script = body.join("\n");
  assert.doesNotMatch(script, /\$\{\{/, "the find script should take its inputs from env, not expressions");
  return script;
}

// `gh api PATH [--jq EXPR]`, answered from ROUTES: one
// `<regex>\t<file>[\t<failFirst>]` per line, first match wins. A route with
// failFirst fails that many calls before it answers, like a transient 5xx. No
// match, or a route to a missing file, fails every time, like an unreachable
// API. Every requested path is logged to GH_CALLS.
const FAKE_GH = `#!/usr/bin/env bash
[ "$1" = api ] || exit 2
shift; path="$1"; shift
expr=""
if [ "\${1:-}" = "--jq" ]; then expr="$2"; fi
echo "$path" >> "$GH_CALLS"
n=0
while IFS=$'\\t' read -r pattern file fail_first; do
  n=$((n + 1))
  [ -n "$pattern" ] || continue
  if [[ "$path" =~ $pattern ]]; then
    count_file="$FIXTURES/.route-$n"
    # Errors in gh's own words: gh 2.63.0 prints the body on stdout and the
    # status on stderr. HTTP404 always fails. HTTP429 fails once, then serves
    # the fixture named in the third column.
    if [ "$file" = HTTP404 ]; then
      echo '{"message":"Not Found","status":"404"}'
      echo 'gh: Not Found (HTTP 404)' >&2
      exit 1
    fi
    if [ "$file" = HTTP429 ]; then
      if [ ! -f "$count_file" ]; then
        echo 1 > "$count_file"
        echo '{"message":"API rate limit exceeded","status":"429"}'
        echo 'gh: API rate limit exceeded (HTTP 429)' >&2
        exit 1
      fi
      file="$fail_first"
    elif [ -n "$fail_first" ]; then
      count=$(cat "$count_file" 2>/dev/null || echo 0)
      if [ "$count" -lt "$fail_first" ]; then
        echo $((count + 1)) > "$count_file"
        echo '{"message":"Server Error"}'
        echo 'gh: Server Error (HTTP 502)' >&2
        exit 1
      fi
    fi
    [ -f "$FIXTURES/$file" ] || exit 1
    if [ -n "$expr" ]; then jq -r "$expr" "$FIXTURES/$file"; else cat "$FIXTURES/$file"; fi
    exit $?
  fi
done < "$ROUTES"
exit 1
`;

let workspace;
let scriptPath;
let binDir;

function run({ onStale, fixtures, routes }) {
  const dir = mkdtempSync(join(workspace, "case-"));
  for (const [name, body] of Object.entries(fixtures)) {
    writeFileSync(join(dir, name), JSON.stringify(body));
  }
  writeFileSync(join(dir, "routes.tsv"), routes.map((route) => route.join("\t")).join("\n") + "\n");
  for (const f of ["env", "output", "calls", "sleeps"]) writeFileSync(join(dir, f), "");

  const result = spawnSync("bash", [scriptPath], {
    encoding: "utf8",
    env: {
      PATH: `${binDir}:${process.env.PATH}`,
      HOME: process.env.HOME ?? "",
      RUNNER_TEMP: dir,
      GITHUB_ENV: join(dir, "env"),
      GITHUB_OUTPUT: join(dir, "output"),
      GITHUB_SERVER_URL: "https://github.example",
      GH_TOKEN: "unused",
      REPO,
      ON_STALE: onStale,
      FIXTURES: dir,
      ROUTES: join(dir, "routes.tsv"),
      GH_CALLS: join(dir, "calls"),
      SLEEPS: join(dir, "sleeps"),
    },
  });
  const env = Object.fromEntries(
    readFileSync(join(dir, "env"), "utf8")
      .split("\n")
      .filter(Boolean)
      .map((line) => line.split(/=(.*)/s).slice(0, 2)),
  );
  return {
    status: result.status,
    stdout: result.stdout,
    stderr: result.stderr,
    env,
    output: readFileSync(join(dir, "output"), "utf8"),
    calls: readFileSync(join(dir, "calls"), "utf8").split("\n").filter(Boolean),
    sleeps: readFileSync(join(dir, "sleeps"), "utf8").split("\n").filter(Boolean),
  };
}

// One trusted publisher run whose commit is on main.
const PUBLISHER = {
  "publisher.json": {
    workflow_runs: [
      {
        id: 7001,
        head_sha: "pubsha",
        head_branch: "main",
        event: "workflow_run",
        run_started_at: RUN_STARTED,
        head_repository: { full_name: REPO },
      },
    ],
  },
  "main-ref.json": { object: { sha: "mainsha" } },
  "compare.json": { status: "ahead" },
  "none.json": { workflow_runs: [] },
};
const PUBLISHER_ROUTES = [
  ["/git/ref/heads/main$", "main-ref.json"],
  ["/actions/workflows/migration-snapshot\\.yml/runs", "publisher.json"],
  ["/compare/pubsha\\.\\.\\.mainsha$", "compare.json"],
];

const deployRun = (id, updatedAt) => ({ id, updated_at: updatedAt, head_repository: { full_name: REPO } });
const jobs = (...completed) => ({ jobs: completed.map((completed_at) => ({ completed_at })) });

describe("download-migration-snapshot find step", { skip }, () => {
  before(() => {
    workspace = mkdtempSync(join(tmpdir(), "download-snapshot-"));
    binDir = join(workspace, "bin");
    spawnSync("mkdir", ["-p", binDir]);
    writeFileSync(join(binDir, "gh"), FAKE_GH);
    chmodSync(join(binDir, "gh"), 0o755);
    // Retries back off with `sleep`; the stub makes them instant and logs each
    // delay to SLEEPS, so the backoff itself is asserted.
    writeFileSync(join(binDir, "sleep"), '#!/usr/bin/env bash\necho "$1" >> "$SLEEPS"\nexit 0\n');
    chmodSync(join(binDir, "sleep"), 0o755);
    scriptPath = join(workspace, "find.sh");
    writeFileSync(scriptPath, extractFindScript());
  });
  after(() => rmSync(workspace, { recursive: true, force: true }));

  it("use: exports the finish time of a Deploy API run that finished after the snapshot", () => {
    const r = run({
      onStale: "use",
      fixtures: {
        ...PUBLISHER,
        "api-completed.json": { workflow_runs: [deployRun(11, "2026-09-23T12:10:00Z")] },
        "jobs-11.json": jobs("2026-09-23T12:05:00Z", "2026-09-23T12:08:00Z"),
      },
      routes: [
        ...PUBLISHER_ROUTES,
        ["/deploy-api\\.yml/runs.*status=completed", "api-completed.json"],
        ["/runs/11/jobs", "jobs-11.json"],
      ],
    });
    assert.equal(r.status, 0, r.stderr + r.stdout);
    assert.equal(r.env.MIGRATION_SNAPSHOT_STAGING_DEPLOY, "2026-09-23T12:08:00Z");
    assert.match(r.output, /run-id=7001/);
  });

  it("use: exports `running` while a Deploy API run is in flight", () => {
    const r = run({
      onStale: "use",
      fixtures: { ...PUBLISHER, "api-running.json": { workflow_runs: [deployRun(12, "2026-09-23T12:20:00Z")] } },
      routes: [
        ...PUBLISHER_ROUTES,
        ["/deploy-api\\.yml/runs.*status=completed", "none.json"],
        ["/deploy-api\\.yml/runs.*status=in_progress", "api-running.json"],
      ],
    });
    assert.equal(r.status, 0, r.stderr + r.stdout);
    assert.equal(r.env.MIGRATION_SNAPSHOT_STAGING_DEPLOY, "running");
  });

  it("use: exports `none`, and never counts Deploy production, which does not touch staging", () => {
    const r = run({
      onStale: "use",
      fixtures: {
        ...PUBLISHER,
        "prod-completed.json": { workflow_runs: [deployRun(13, "2026-09-23T12:30:00Z")] },
        "jobs-13.json": jobs("2026-09-23T12:29:00Z"),
      },
      routes: [
        ...PUBLISHER_ROUTES,
        ["/deploy-api\\.yml/runs", "none.json"],
        ["/deploy-production\\.yml/runs", "prod-completed.json"],
        ["/runs/13/jobs", "jobs-13.json"],
      ],
    });
    assert.equal(r.status, 0, r.stderr + r.stdout);
    assert.equal(r.env.MIGRATION_SNAPSHOT_STAGING_DEPLOY, "none");
    assert.equal(r.calls.some((path) => path.includes("deploy-production")), false);
  });

  it("use: a failed lookup exports `unknown` with a warning, and does not fail the step", () => {
    const r = run({ onStale: "use", fixtures: PUBLISHER, routes: PUBLISHER_ROUTES });
    assert.equal(r.status, 0, r.stderr + r.stdout);
    assert.equal(r.env.MIGRATION_SNAPSHOT_STAGING_DEPLOY, "unknown");
    assert.match(r.stdout, /::warning::Could not read the recent deploy-api\.yml runs/);
    // Three attempts before it gives up.
    assert.equal(r.calls.filter((path) => path.includes("deploy-api.yml/runs")).length, 3);
  });

  it("use: a failed in-progress lookup exports `unknown` too, never `none`", () => {
    // `none` would tell the gate the snapshot is current while a Deploy API run
    // may be applying the very migration it lacks.
    const r = run({
      onStale: "use",
      fixtures: PUBLISHER,
      routes: [...PUBLISHER_ROUTES, ["/deploy-api\\.yml/runs.*status=completed", "none.json"]],
    });
    assert.equal(r.status, 0, r.stderr + r.stdout);
    assert.equal(r.env.MIGRATION_SNAPSHOT_STAGING_DEPLOY, "unknown");
    assert.match(r.stdout, /::warning::Could not read in-progress Deploy API runs/);
  });

  it("retries a transient error on every read instead of failing the step", () => {
    // Each route fails twice, then answers: the third attempt must succeed.
    // Two cases, because the jobs read runs only when a newer deploy exists,
    // and the in-progress read only when none does.
    const newer = run({
      onStale: "use",
      fixtures: {
        ...PUBLISHER,
        "api-completed.json": { workflow_runs: [deployRun(16, "2026-09-23T12:10:00Z")] },
        "jobs-16.json": jobs("2026-09-23T12:08:00Z"),
      },
      routes: [
        ["/git/ref/heads/main$", "main-ref.json", "2"],
        ["/actions/workflows/migration-snapshot\\.yml/runs", "publisher.json", "2"],
        ["/compare/pubsha\\.\\.\\.mainsha$", "compare.json", "2"],
        ["/deploy-api\\.yml/runs.*status=completed", "api-completed.json", "2"],
        ["/runs/16/jobs", "jobs-16.json", "2"],
      ],
    });
    assert.equal(newer.status, 0, newer.stderr + newer.stdout);
    assert.equal(newer.env.MIGRATION_SNAPSHOT_STAGING_DEPLOY, "2026-09-23T12:08:00Z");
    assert.equal(newer.calls.filter((path) => path.includes("/runs/16/jobs")).length, 3);

    const current = run({
      onStale: "use",
      fixtures: PUBLISHER,
      routes: [
        ...PUBLISHER_ROUTES,
        ["/deploy-api\\.yml/runs.*status=completed", "none.json"],
        ["/deploy-api\\.yml/runs.*status=in_progress", "none.json", "2"],
      ],
    });
    assert.equal(current.status, 0, current.stderr + current.stdout);
    assert.equal(current.env.MIGRATION_SNAPSHOT_STAGING_DEPLOY, "none");
    assert.match(current.output, /run-id=7001/);
  });

  it("does not retry a 4xx other than 429: sending the same request again cannot fix it", () => {
    const r = run({
      onStale: "use",
      fixtures: PUBLISHER,
      routes: [["/actions/workflows/migration-snapshot\\.yml/runs", "HTTP404"], ...PUBLISHER_ROUTES],
    });
    assert.equal(r.status, 1);
    assert.match(r.stdout, /Does the job grant 'actions: read'/);
    assert.match(r.stderr, /HTTP 404/);
    assert.equal(r.calls.filter((path) => path.includes("migration-snapshot.yml/runs")).length, 1);
  });

  it("gives up after three attempts on a read that keeps failing", () => {
    const r = run({
      onStale: "use",
      fixtures: PUBLISHER,
      routes: [["/git/ref/heads/main$", "main-ref.json", "3"], ...PUBLISHER_ROUTES.slice(1)],
    });
    assert.equal(r.status, 1);
    assert.match(r.stdout, /::error::Could not read refs\/heads\/main/);
    assert.equal(r.calls.filter((path) => path.endsWith("/git/ref/heads/main")).length, 3);
    // lib/http.mjs's backoff: 1s, then 5s, and no sleep after the last attempt.
    assert.deepEqual(r.sleeps, ["1", "5"]);
  });

  it("retries a 429, which is a rate limit, not a wrong request", () => {
    const r = run({
      onStale: "use",
      fixtures: PUBLISHER,
      routes: [
        ["/git/ref/heads/main$", "HTTP429", "main-ref.json"],
        ...PUBLISHER_ROUTES.slice(1),
        ["/deploy-api\\.yml/runs", "none.json"],
      ],
    });
    assert.equal(r.status, 0, r.stderr + r.stdout);
    assert.equal(r.calls.filter((path) => path.endsWith("/git/ref/heads/main")).length, 2);
    assert.deepEqual(r.sleeps, ["1"]);
  });

  it("use: a Deploy API run from another repository (a fork's `main`) is not counted", () => {
    const r = run({
      onStale: "use",
      fixtures: {
        ...PUBLISHER,
        "api-completed.json": {
          workflow_runs: [{ ...deployRun(14, "2026-09-23T12:10:00Z"), head_repository: { full_name: "fork/repo" } }],
        },
      },
      routes: [...PUBLISHER_ROUTES, ["/deploy-api\\.yml/runs", "api-completed.json"]],
    });
    assert.equal(r.status, 0, r.stderr + r.stdout);
    assert.equal(r.env.MIGRATION_SNAPSHOT_STAGING_DEPLOY, "none");
  });

  it("wait: exports `none` once no deploy has finished since and none is running", () => {
    const r = run({
      onStale: "wait",
      fixtures: {
        ...PUBLISHER,
        // Finished before the snapshot's run started: not newer.
        "api-completed.json": { workflow_runs: [deployRun(15, "2026-09-23T11:50:00Z")] },
      },
      routes: [
        ...PUBLISHER_ROUTES,
        ["/deploy-api\\.yml/runs.*status=completed", "api-completed.json"],
        ["/deploy-api\\.yml/runs.*status=in_progress", "none.json"],
        ["/deploy-production\\.yml/runs", "none.json"],
      ],
    });
    assert.equal(r.status, 0, r.stderr + r.stdout);
    assert.equal(r.env.MIGRATION_SNAPSHOT_STAGING_DEPLOY, "none");
    assert.ok(r.calls.some((path) => path.includes("deploy-production")), "wait must count Deploy production");
  });

  it("wait: a failed lookup fails the step instead of passing an unproven snapshot", () => {
    const r = run({ onStale: "wait", fixtures: PUBLISHER, routes: PUBLISHER_ROUTES });
    assert.equal(r.status, 1);
    assert.match(r.stdout, /::error::Could not read the recent deploy-api\.yml runs/);
    assert.equal(r.env.MIGRATION_SNAPSHOT_STAGING_DEPLOY, undefined);
  });

  it("fails when no publisher run on main exists at all", () => {
    const r = run({
      onStale: "use",
      fixtures: { ...PUBLISHER, "publisher.json": { workflow_runs: [] } },
      routes: PUBLISHER_ROUTES,
    });
    assert.equal(r.status, 1);
    assert.match(r.stdout, /No successful Migration snapshot run from main/);
  });
});
