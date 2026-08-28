// Regression tests for the `check-changes` path filter in
// .github/workflows/deploy-api.yml.
//
// The filter is inline shell in a workflow file, so it has no unit-test seam of
// its own. These tests extract the step's script straight out of the YAML and
// run it against a stubbed `git`, which is close enough to the real thing to
// catch the failure it is guarding against.
//
// The failure (production promotion #1330): the filter asked
// `echo "$CHANGED" | grep -qE '^apps/api/...'`. `grep -q` exits at its first
// match, closing the pipe while `echo` is still writing; `echo` dies with
// EPIPE, and `set -o pipefail` promotes that to the pipeline's status. A
// SUCCESSFUL match therefore reported failure and the filter answered
// "no API files changed", so `deploy-production` skipped while the workflow
// stayed green.
//
// It is a race, not a certainty — it needs more output than the pipe buffer
// holds AND `grep` to exit before `echo` drains. On the real 1674-path diff it
// reproduced in roughly one run in five. The large fixture below makes it
// deterministic so this suite cannot go quietly flaky.

import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, chmodSync } from "node:fs";
import { tmpdir } from "node:os";

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const WORKFLOW = join(REPO_ROOT, ".github", "workflows", "deploy-api.yml");

// Far more output than any pipe buffer (64KiB) can hold, with an `apps/api/`
// path at the very top so `grep -q` exits almost immediately.
const FLOOD_LINES = 30_000;

/**
 * Pull the `Detect changed paths` step's `run:` block out of the workflow.
 *
 * Deliberately text-based: no YAML parser is a declared dependency of this
 * repo, and the other workflow-reading scripts under scripts/ do the same.
 */
function extractFilterScript() {
  const lines = readFileSync(WORKFLOW, "utf8").split("\n");

  const stepIndex = lines.findIndex((line) => /^\s*- name: Detect changed paths\s*$/.test(line));
  assert.notEqual(stepIndex, -1, "Detect changed paths step not found in deploy-api.yml");

  const runIndex = lines.findIndex((line, i) => i > stepIndex && /^\s*run: \|\s*$/.test(line));
  assert.notEqual(runIndex, -1, "Detect changed paths step has no `run: |` block");

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

  // The step interpolates a GitHub expression into its warning message.
  return body.join("\n").replace(/\$\{\{[^}]*\}\}/g, "deadbeef");
}

let workspace;
let scriptPath;

/**
 * Run the extracted filter with `git diff` stubbed to replay `paths`.
 * Returns the parsed key=value pairs the step wrote to $GITHUB_OUTPUT.
 */
function runFilter({ paths = [], gitFails = false } = {}) {
  const diffFile = join(workspace, "diff.txt");
  const outputFile = join(workspace, `output-${Math.random().toString(36).slice(2)}.txt`);
  writeFileSync(diffFile, paths.length ? `${paths.join("\n")}\n` : "");
  writeFileSync(outputFile, "");

  const stdout = execFileSync("bash", [scriptPath], {
    encoding: "utf8",
    env: {
      ...process.env,
      PATH: `${join(workspace, "bin")}:${process.env.PATH}`,
      GITHUB_OUTPUT: outputFile,
      RUNNER_TEMP: workspace,
      FAKE_DIFF_FILE: diffFile,
      FAKE_DIFF_FAILS: gitFails ? "1" : "0",
    },
  });

  const outputs = Object.fromEntries(
    readFileSync(outputFile, "utf8")
      .split("\n")
      .filter(Boolean)
      .map((line) => line.split("=")),
  );
  return { outputs, stdout };
}

describe("deploy-api check-changes filter", () => {
  before(() => {
    workspace = mkdtempSync(join(tmpdir(), "deploy-api-filter-"));
    scriptPath = join(workspace, "filter.sh");
    writeFileSync(scriptPath, extractFilterScript());

    // `git` stub: replays a canned file list, or fails like an unresolvable
    // HEAD~1 on a shallow checkout.
    mkdirSync(join(workspace, "bin"), { recursive: true });
    const shim = join(workspace, "bin", "git");
    writeFileSync(
      shim,
      [
        "#!/usr/bin/env bash",
        'if [ "$1" = "diff" ]; then',
        '  if [ "${FAKE_DIFF_FAILS:-0}" = "1" ]; then',
        `    echo "fatal: ambiguous argument 'HEAD~1'" >&2`,
        "    exit 128",
        "  fi",
        '  cat "$FAKE_DIFF_FILE"',
        "  exit 0",
        "fi",
        'exec /usr/bin/git "$@"',
        "",
      ].join("\n"),
    );
    chmodSync(shim, 0o755);
  });

  after(() => {
    if (workspace) rmSync(workspace, { recursive: true, force: true });
  });

  it("does not pipe the changed-path list into a short-circuiting grep", () => {
    const script = extractFilterScript();
    assert.doesNotMatch(
      script,
      /echo\s+"\$CHANGED"\s*\|\s*grep\s+-q/,
      "`echo \"$CHANGED\" | grep -q` reintroduces the EPIPE/pipefail false negative " +
        "that made #1330 skip its production API deploy. Grep a file instead.",
    );
  });

  it("detects an API change that sorts early in a very large diff", () => {
    // The exact shape of the #1330 failure: an `apps/api/` match near the top,
    // then far more output than a pipe can buffer.
    const paths = [
      "apps/api/src/main.ts",
      ...Array.from({ length: FLOOD_LINES }, (_, i) => `docs/generated/note-${i}.md`),
      "supabase/migrations/20260827190000_secdef_search_path_pg_temp.sql",
    ];

    const { outputs } = runFilter({ paths });

    assert.equal(outputs["api-changed"], "true");
    assert.equal(outputs["migrations-changed"], "true");
  });

  it("gives the same answer whichever path sorts first", () => {
    const flood = Array.from({ length: FLOOD_LINES }, (_, i) => `docs/generated/note-${i}.md`);

    const apiFirst = runFilter({
      paths: ["apps/api/src/main.ts", ...flood, "supabase/migrations/0001_x.sql"],
    });
    const migrationsFirst = runFilter({
      paths: ["apps/api/zzz.ts", ...flood, "supabase/migrations/0001_x.sql"].sort(),
    });

    assert.deepEqual(apiFirst.outputs, migrationsFirst.outputs);
    assert.equal(apiFirst.outputs["api-changed"], "true");
  });

  it("reports no API change for a docs-only diff", () => {
    const { outputs } = runFilter({ paths: ["docs/a.md", "README.md"] });

    assert.equal(outputs["api-changed"], "false");
    assert.equal(outputs["migrations-changed"], "false");
  });

  it("detects migrations without claiming an API change", () => {
    const { outputs } = runFilter({
      paths: ["supabase/migrations/20260827190000_secdef_search_path_pg_temp.sql"],
    });

    assert.equal(outputs["api-changed"], "false");
    assert.equal(outputs["migrations-changed"], "true");
  });

  it("treats the other deploy-trigger paths as API changes", () => {
    for (const path of [
      "packages/validation/src/index.ts",
      "packages/typescript-config/base.json",
    ]) {
      const { outputs } = runFilter({ paths: [path] });
      assert.equal(outputs["api-changed"], "true", `${path} should trigger the API deploy`);
    }
  });

  it("fails closed when the diff cannot be read", () => {
    // An unreadable diff must assume everything changed: a redundant deploy is
    // cheap, a change that silently never ships is not.
    const { outputs, stdout } = runFilter({ gitFails: true });

    assert.equal(outputs["api-changed"], "true");
    assert.equal(outputs["migrations-changed"], "true");
    assert.match(stdout, /::warning::/);
  });
});
