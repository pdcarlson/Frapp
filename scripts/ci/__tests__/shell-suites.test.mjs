// Runs every `*.test.sh` in the repo, each as its own case (#802).
//
// `scripts/lib/local-postgres-acl.test.sh` sat for two months with nothing
// executing it, the same shape as #766 and #775: a suite that passes locally
// and rots because no job runs it. Hanging shell suites off this file puts them
// in the required `ci-scripts-tests` job, which already runs on every PR, rather
// than in a second mechanism beside `node:test`.
//
// The convention is the filename: a `*.test.sh` anywhere in the tree is a
// suite, it runs under `bash` from the repo root, and a non-zero exit fails it.
// Discovery reads `git ls-files`, tracked plus untracked-but-not-ignored and
// still on disk, so a new suite runs locally before it is committed and nothing
// under `node_modules` is ever picked up.
//
// A suite here must stay hermetic: this job has no `npm ci`, no Docker and no
// database. `local-postgres-acl.test.sh` stubs `docker` and writes only into a
// `mktemp` dir that it removes on exit, which is the bar.

import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { join } from "node:path";

import { REPO_ROOT } from "./helpers/doc-sections.mjs";

/** Every `*.test.sh` git can see, repo-relative and sorted. */
function shellSuites() {
  const listed = spawnSync(
    "git",
    [
      "ls-files",
      "--cached",
      "--others",
      "--exclude-standard",
      "-z",
      "--",
      "*.test.sh",
    ],
    { cwd: REPO_ROOT, encoding: "utf8" },
  );
  assert.equal(listed.status, 0, `git ls-files failed: ${listed.stderr}`);
  // `--cached` still lists a suite deleted or renamed but not yet staged, so
  // keep only what is on disk.
  return [...new Set(listed.stdout.split("\0").filter(Boolean))]
    .filter((path) => existsSync(join(REPO_ROOT, path)))
    .sort();
}

const suites = shellSuites();

test("discovery finds the shell suites", () => {
  // A broken pattern would otherwise collect nothing and pass, which is the
  // silent skip this file exists to end.
  assert.ok(
    suites.includes("scripts/lib/local-postgres-acl.test.sh"),
    `discovery missed local-postgres-acl.test.sh (found: ${suites.join(", ") || "nothing"})`,
  );
});

for (const suite of suites) {
  test(`bash ${suite}`, () => {
    const run = spawnSync("bash", [suite], {
      cwd: REPO_ROOT,
      encoding: "utf8",
      timeout: 60_000,
    });
    assert.equal(
      run.error,
      undefined,
      `${suite} did not run: ${run.error?.message}`,
    );
    assert.equal(
      run.status,
      0,
      `${suite} exited ${run.status ?? run.signal}\n${run.stdout}${run.stderr}`,
    );
  });
}
