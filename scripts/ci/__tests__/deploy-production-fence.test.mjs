// The replay/apply fence in `.github/workflows/deploy-production.yml`.
//
// The fence is inline shell in a workflow file, so it has no unit-test seam of
// its own. These tests extract the step's script straight out of the YAML — the
// same approach `deploy-api-check-changes.test.mjs` uses — and run it against
// real directory state in a throwaway git repo.
//
// ── What it is protecting ───────────────────────────────────────────────────
// `check-migration-replay.mjs` MOVES pending migrations into
// `supabase/.migrations-replay-parked/` and restores them in a `finally`. A
// `finally` survives a thrown error; it does not survive SIGKILL — job
// cancellation, a runner timeout, the OOM killer.
//
// In `migration-drift-gate.yml` that is harmless: a throwaway runner that never
// speaks to production. In `deploy-production.yml` the very next step runs
// `supabase db push` against the real database, and `run-migration.mjs` counts
// the BASELINE files still on disk, sees a non-zero total, does not bail, pushes
// NOTHING, and prints "Migrations applied successfully".
//
// A production deploy reporting "migrations applied" having applied zero is
// worse than one that fails, which is why this fence exists and why it is its
// own step rather than a line inside a larger one.

import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const WORKFLOW = join(REPO_ROOT, ".github", "workflows", "deploy-production.yml");

const STEP_NAME = "Fence — the working tree must be intact before anything is applied";

/** Pull a named step's `run:` block out of the workflow, as text. */
function extractStepScript(stepName) {
  const lines = readFileSync(WORKFLOW, "utf8").split("\n");

  const stepIndex = lines.findIndex((line) =>
    line.trim() === `- name: ${stepName}`,
  );
  assert.notEqual(stepIndex, -1, `step "${stepName}" not found in deploy-production.yml`);

  const runIndex = lines.findIndex((line, i) => i > stepIndex && /^\s*run: \|\s*$/.test(line));
  assert.notEqual(runIndex, -1, `step "${stepName}" has no \`run: |\` block`);

  const runIndent = lines[runIndex].match(/^\s*/)[0].length;
  const body = [];
  for (let i = runIndex + 1; i < lines.length; i += 1) {
    const line = lines[i];
    if (line.trim() === "") {
      body.push("");
      continue;
    }
    const indent = line.match(/^\s*/)[0].length;
    if (indent <= runIndent) break;
    body.push(line.slice(runIndent + 2));
  }
  return body.join("\n");
}

let workspace;
let scriptPath;

/**
 * A throwaway git repo holding a committed `supabase/migrations/` tree, so
 * `git status --porcelain -- supabase/` is meaningful.
 */
function makeRepo() {
  const dir = mkdtempSync(join(tmpdir(), "fence-"));
  mkdirSync(join(dir, "supabase", "migrations"), { recursive: true });
  for (const name of ["20260101000000_a.sql", "20260102000000_b.sql"]) {
    writeFileSync(join(dir, "supabase", "migrations", name), "select 1;\n");
  }
  const git = (...args) => execFileSync("git", args, { cwd: dir, stdio: "pipe" });
  git("init", "-q");
  git("config", "user.email", "t@example.com");
  git("config", "user.name", "t");
  git("add", "-A");
  git("commit", "-qm", "seed");
  return dir;
}

/** Run the extracted fence in `dir`. Returns `{ code, output }`. */
function runFence(dir, env = {}) {
  try {
    const output = execFileSync("bash", [scriptPath], {
      cwd: dir,
      encoding: "utf8",
      stdio: "pipe",
      env: { ...process.env, SUPABASE_DB_PASSWORD: "hunter2", ...env },
    });
    return { code: 0, output };
  } catch (error) {
    return {
      code: error.status ?? 1,
      output: `${error.stdout ?? ""}${error.stderr ?? ""}`,
    };
  }
}

before(() => {
  workspace = mkdtempSync(join(tmpdir(), "fence-script-"));
  scriptPath = join(workspace, "fence.sh");
  writeFileSync(scriptPath, extractStepScript(STEP_NAME));
});

after(() => {
  rmSync(workspace, { recursive: true, force: true });
});

describe("the replay/apply fence", () => {
  // The negative control, and it matters more than the positive ones: a fence
  // that always fails would pass every test below while blocking every deploy.
  it("passes on a clean tree", () => {
    const dir = makeRepo();
    try {
      const { code, output } = runFence(dir);
      assert.equal(code, 0, output);
      assert.match(output, /Fence holds/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("fails when the parked directory survived the replay", () => {
    const dir = makeRepo();
    try {
      // What a SIGKILL between `parkPending` and `restoreParked` leaves behind.
      mkdirSync(join(dir, "supabase", ".migrations-replay-parked"));
      writeFileSync(
        join(dir, "supabase", ".migrations-replay-parked", "20260102000000_b.sql"),
        "select 1;\n",
      );
      rmSync(join(dir, "supabase", "migrations", "20260102000000_b.sql"));

      const { code, output } = runFence(dir);
      assert.equal(code, 1);
      assert.match(output, /migrations-replay-parked still exists/);
      assert.match(output, /incomplete set/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  // The nastier half. If something removed the parked directory but the files
  // never came back, the first check passes and only the `git status` check
  // catches it — as ` D supabase/migrations/*.sql` deletions. This is why the
  // status check is scoped to `supabase/`, not just the parked path.
  it("fails when migrations are missing even though the parked directory is gone", () => {
    const dir = makeRepo();
    try {
      rmSync(join(dir, "supabase", "migrations", "20260102000000_b.sql"));

      const { code, output } = runFence(dir);
      assert.equal(code, 1);
      assert.match(output, /working tree under supabase\/ is dirty/);
      assert.match(output, /20260102000000_b\.sql/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("fails on any other dirt under supabase/", () => {
    const dir = makeRepo();
    try {
      writeFileSync(join(dir, "supabase", "config.toml"), "rewritten\n");
      const { code, output } = runFence(dir);
      assert.equal(code, 1);
      assert.match(output, /working tree under supabase\/ is dirty/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  // Asserted BEFORE `supabase stop`, so a missing secret fails while the stack
  // a re-run would need is still up.
  it("fails when SUPABASE_DB_PASSWORD is empty", () => {
    const dir = makeRepo();
    try {
      const { code, output } = runFence(dir, { SUPABASE_DB_PASSWORD: "" });
      assert.equal(code, 1);
      assert.match(output, /SUPABASE_DB_PASSWORD is not set/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("the confirmation-phrase step", () => {
  const CONFIRM_STEP = "Verify confirmation phrase";

  function runConfirm(confirm) {
    const path = join(workspace, "confirm.sh");
    writeFileSync(path, extractStepScript(CONFIRM_STEP).replace(/\$\{\{[^}]*\}\}/g, ""));
    try {
      const output = execFileSync("bash", [path], {
        encoding: "utf8",
        stdio: "pipe",
        env: { ...process.env, CONFIRM: confirm },
      });
      return { code: 0, output };
    } catch (error) {
      return { code: error.status ?? 1, output: `${error.stdout ?? ""}${error.stderr ?? ""}` };
    }
  }

  it("accepts the exact phrase", () => assert.equal(runConfirm("DEPLOY TO PRODUCTION").code, 0));
  it("rejects a near miss", () => assert.equal(runConfirm("deploy to production").code, 1));
  it("rejects trailing whitespace", () => assert.equal(runConfirm("DEPLOY TO PRODUCTION ").code, 1));
  it("rejects an empty confirmation", () => assert.equal(runConfirm("").code, 1));

  // The step is first in the job precisely so a typo costs nothing: it must not
  // reference a secret, or the run has already asked for one before failing.
  it("references no secret, so a typo costs nothing", () => {
    const source = extractStepScript(CONFIRM_STEP);
    assert.ok(!/secrets\./.test(source));
  });
});
