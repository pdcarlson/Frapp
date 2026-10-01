import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { chmodSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { WORKFLOW_DIR, stepsRunning, workflowFiles, workflowSteps } from "./helpers/workflow-yaml.mjs";

// scripts/ci/supabase-start-disposable.sh (#2609): the one way a CI job starts
// the disposable Supabase stack it applies migrations to. It's shell, so this
// drives bash with a stub `supabase` first on PATH. What a real start needs (a
// Docker daemon, a dozen image pulls) no CI job here has; the retry decision is
// the part that can silently regress, into a required check that goes red on
// every ghcr.io rate limit again, or one that retries a real failure away.

const SCRIPT = fileURLToPath(new URL("../supabase-start-disposable.sh", import.meta.url));
const EXCLUDED = "-x studio,imgproxy,edge-runtime,logflare,vector,pooler,mailpit";

// How `supabase start` really ends when the throttle outlasts its own retries
// (#2609, job 107337795105): the rate limit is the second-to-last line, and the
// CLI's --debug hint follows it. A window narrower than the last three lines
// would miss it.
const RATE_LIMITED = [
  "Retrying after 4s: ghcr.io/supabase/postgres:17.6.1.093",
  "Stopping containers...",
  "failed to display json stream: toomanyrequests: retry-after: 140.786µs, allowed: 44000/minute",
  "Try rerunning the command with --debug to troubleshoot the error.",
].join("\n");
// What the CLI prints when it recovered from a rate limit and then failed on
// something else: the throttle is in the log, but not in its last lines.
const RECOVERED_THEN_BROKEN = [
  "failed to display json stream: toomanyrequests: retry-after: 533.878µs, allowed: 44000/minute",
  "Retrying after 4s: ghcr.io/supabase/postgres:17.6.1.093",
  "Pulled ghcr.io/supabase/postgres:17.6.1.093",
  "Applying migration 20260101000000_broken.sql...",
  "ERROR: syntax error at or near \"tabel\" (SQLSTATE 42601)",
  "At statement 0: create tabel broken ();",
  "Try rerunning the command with --debug to troubleshoot the error.",
].join("\n");

/**
 * Run the script with a stub `supabase` that answers each `start` from
 * `outcomes` in turn: `"ok"` succeeds, anything else is printed and fails.
 * Every call the stub receives is recorded, one line each, and so is every
 * `sleep`, which a stub on PATH answers at once. `delay` sets
 * SUPABASE_START_RETRY_DELAY; `null` leaves it unset, so the script's own
 * default applies.
 */
function run(outcomes, { delay = "0" } = {}) {
  const dir = mkdtempSync(join(tmpdir(), "supabase-start-"));
  try {
    for (const [i, outcome] of outcomes.entries()) writeFileSync(join(dir, `out.${i + 1}`), outcome);
    const stub = join(dir, "supabase");
    writeFileSync(
      stub,
      [
        "#!/usr/bin/env bash",
        `echo "$*" >> "${dir}/calls"`,
        'if [ "$1" != start ]; then exit 0; fi',
        `n=$(( $(cat "${dir}/starts" 2>/dev/null || echo 0) + 1 )); echo "$n" > "${dir}/starts"`,
        `out="${dir}/out.$n"`,
        '[ -f "$out" ] || { echo "stub: no outcome for start #$n"; exit 97; }',
        'if [ "$(cat "$out")" = ok ]; then echo "Started supabase local development setup."; exit 0; fi',
        'cat "$out"; exit 1',
      ].join("\n"),
    );
    chmodSync(stub, 0o755);
    const sleep = join(dir, "sleep");
    writeFileSync(sleep, `#!/usr/bin/env bash\necho "$*" >> "${dir}/sleeps"\n`);
    chmodSync(sleep, 0o755);
    const env = { ...process.env, PATH: `${dir}:${process.env.PATH}` };
    delete env.SUPABASE_START_RETRY_DELAY;
    if (delay !== null) env.SUPABASE_START_RETRY_DELAY = delay;
    const res = spawnSync("bash", [SCRIPT], { encoding: "utf8", env });
    const lines = (name) => {
      try {
        return readFileSync(join(dir, name), "utf8").trim().split("\n");
      } catch {
        return []; // Never called: the assertion on the list says so.
      }
    };
    return { status: res.status, output: res.stdout + res.stderr, calls: lines("calls"), sleeps: lines("sleeps") };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

describe("supabase-start-disposable.sh", () => {
  it("starts once when the first start succeeds, with the exclusion list", () => {
    const { status, calls } = run(["ok"]);
    assert.equal(status, 0);
    assert.deepEqual(calls, [`start ${EXCLUDED}`]);
  });

  it("retries a ghcr.io rate limit, stopping cleanly between attempts, then succeeds", () => {
    const { status, calls, output } = run([RATE_LIMITED, RATE_LIMITED, "ok"]);
    assert.equal(status, 0, output);
    assert.deepEqual(calls, [
      `start ${EXCLUDED}`,
      "stop --no-backup",
      `start ${EXCLUDED}`,
      "stop --no-backup",
      `start ${EXCLUDED}`,
    ]);
    assert.match(output, /::warning::ghcr\.io rate-limited an image pull \(attempt 1\/4\)/);
  });

  // Retrying a throttled registry at once would only be throttled again.
  it("backs off 60 s, then 120 s, then 180 s by default", () => {
    const { status, sleeps, output } = run([RATE_LIMITED, RATE_LIMITED, RATE_LIMITED, "ok"], { delay: null });
    assert.equal(status, 0, output);
    assert.deepEqual(sleeps, ["60", "120", "180"]);
    assert.match(output, /retrying in 60s/);
  });

  it("gives up after four rate-limited attempts, and says so", () => {
    const { status, calls, output } = run([RATE_LIMITED, RATE_LIMITED, RATE_LIMITED, RATE_LIMITED]);
    assert.equal(status, 1);
    assert.equal(calls.filter((c) => c.startsWith("start")).length, 4);
    assert.match(output, /::error::ghcr\.io still rate-limited image pulls after 4 attempts/);
  });

  it("fails at once on any other error, without a retry", () => {
    const { status, calls, output } = run(["Error: port 54322 is already allocated"]);
    assert.equal(status, 1);
    assert.deepEqual(calls, [`start ${EXCLUDED}`]);
    assert.match(output, /::error::supabase start failed \(attempt 1\/4\), not on a registry rate limit/);
  });

  // A whole-log grep would retry this, and a broken migration would cost a
  // required check six extra minutes before failing the same way.
  it("does not retry a failure after a rate limit the CLI recovered from", () => {
    const { status, calls } = run([RECOVERED_THEN_BROKEN, "ok"]);
    assert.equal(status, 1);
    assert.deepEqual(calls, [`start ${EXCLUDED}`]);
  });
});

// Any invocation that starts containers, however it's spelled: a version pin,
// global flags before the subcommand, or `db start`, which pulls the same
// ghcr.io Postgres image.
const DIRECT_START = /(?<![\w./-])supabase(?:@\S+)?\s(?:[^\n#]*\s)?start(?![\w-])/;

describe("every CI start of the disposable stack goes through the script", () => {
  it("the direct-start pattern catches every spelling, and nothing else", () => {
    for (const line of [
      "supabase start -x studio",
      "npx --yes supabase@2.77.0 start",
      "supabase --workdir . start",
      "supabase db start",
      "run: supabase start",
    ]) {
      assert.match(line, DIRECT_START, line);
    }
    for (const line of [
      'bash "$TRUSTED_CI/supabase-start-disposable.sh"',
      "bash scripts/ci/supabase-start-disposable.sh",
      "supabase stop --no-backup",
      "supabase db push --local",
    ]) {
      assert.doesNotMatch(line, DIRECT_START, line);
    }
  });

  it("no workflow runs `supabase start` itself", () => {
    for (const file of workflowFiles()) {
      for (const step of workflowSteps(join(WORKFLOW_DIR, file))) {
        assert.doesNotMatch(
          step.body,
          DIRECT_START,
          `${file} "${step.name}" starts a Supabase stack directly; call scripts/ci/supabase-start-disposable.sh (#2609)`,
        );
      }
    }
  });

  it("no composite action runs `supabase start` itself", () => {
    const actions = join(WORKFLOW_DIR, "..", "actions");
    for (const name of readdirSync(actions, { withFileTypes: true }).filter((e) => e.isDirectory())) {
      const code = readFileSync(join(actions, name.name, "action.yml"), "utf8")
        .split("\n")
        .filter((line) => !/^\s*#/.test(line))
        .join("\n");
      assert.doesNotMatch(
        code,
        DIRECT_START,
        `.github/actions/${name.name} starts a Supabase stack directly; call scripts/ci/supabase-start-disposable.sh (#2609)`,
      );
    }
  });

  it("both callers use it: the migration-replay check and the production rehearsal", () => {
    const callers = stepsRunning("scripts/ci/supabase-start-disposable.sh").map((s) => `${s.workflowFile}:${s.jobId}`);
    assert.deepEqual(callers.sort(), ["_deploy.yml:deploy", "migration-drift-gate.yml:migration-replay"]);
  });
});
