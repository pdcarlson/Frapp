import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join, relative, resolve } from "node:path";

import { ALL_REQUIRED_CHECKS } from "../lib/required-checks.mjs";

// `pglite-migrations` is a REQUIRED check (#2538) that is path-gated on PRs by a
// job-level `if:` on `changes.pglite`. A job skipped that way reports Success,
// so a PR that changes a file the check reads, but that the filter misses,
// merges green. The check then first fails on the push to `main`, where
// `validate-deploy-sha.mjs` refuses to deploy that commit and every later one
// until someone fixes it. The first review of #2538 found exactly that gap:
// `apps/api/src/application/services/search.service.ts`, the demo seed's
// `scripts/ci/lib` imports, `.github/environments.json`, the root
// `package.json` and `ci.yml` itself were all unlisted.
//
// So the filter's coverage is derived here from the script, not restated: every
// repo path the check reads by a literal `join(REPO_ROOT, "...")`, every
// relative module it imports (followed transitively), every script it runs via
// `join(process.cwd(), ...)`, and every `new URL("...", import.meta.url)` file
// those modules read. A new input written in one of those forms fails this test
// until the filter lists it. An input read some other way (a computed path) is
// invisible here, so keep to these forms or extend the patterns below.

const REPO = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const ENTRY = "scripts/check-pglite-migrations.mjs";

// Inputs the job depends on that no source line names: the job's own definition,
// the npm script it runs, the lockfile, and the migrations directory it globs.
const STRUCTURAL = [
  ".github/workflows/ci.yml",
  "package.json",
  "package-lock.json",
  "supabase/migrations/0000_example.sql",
];

/** The `changes.pglite` filter's patterns, in order. */
function pgliteFilter() {
  const lines = readFileSync(join(REPO, ".github/workflows/ci.yml"), "utf8").split("\n");
  const start = lines.findIndex((line) => /^\s+pglite:\s*$/.test(line));
  assert.ok(start > 0, "no `pglite:` filter in ci.yml — re-point this test");
  const indent = lines[start].search(/\S/);
  const patterns = [];
  for (const line of lines.slice(start + 1)) {
    if (line.trim() === "" || line.trim().startsWith("#")) continue;
    if (line.search(/\S/) <= indent) break;
    const m = line.match(/^\s*-\s*['"]?([^'"#]+?)['"]?\s*(#.*)?$/);
    if (m) patterns.push(m[1].trim());
  }
  assert.ok(patterns.length > 0, "the `pglite:` filter parsed empty — the parser broke");
  return patterns;
}

/** dorny/paths-filter semantics for the two forms the filter uses. */
function covered(path, patterns) {
  return patterns.some((p) =>
    p.endsWith("/**") ? path.startsWith(p.slice(0, -2)) : path === p,
  );
}

/** Every repo-relative path the check reads, following relative imports. */
function inputs() {
  const seen = new Set();
  const found = new Set(STRUCTURAL);
  const queue = [ENTRY];
  while (queue.length) {
    const file = queue.shift();
    if (seen.has(file)) continue;
    seen.add(file);
    found.add(file);
    const abs = join(REPO, file);
    assert.ok(existsSync(abs), `${file} is referenced but does not exist`);
    const src = readFileSync(abs, "utf8");
    const here = dirname(abs);
    const rel = (p) => relative(REPO, p).split("\\").join("/");

    for (const [, p] of src.matchAll(/join\(\s*REPO_ROOT\s*,\s*"([^"]+)"\s*\)/g)) {
      found.add(p);
    }
    for (const [, args] of src.matchAll(/join\(\s*process\.cwd\(\)\s*,\s*((?:"[^"]+"\s*,?\s*)+)\)/g)) {
      const parts = [...args.matchAll(/"([^"]+)"/g)].map((m) => m[1]);
      queue.push(parts.join("/"));
    }
    for (const [, p] of src.matchAll(/new URL\(\s*"(\.{1,2}\/[^"]+)"\s*,\s*import\.meta\.url\s*\)/g)) {
      found.add(rel(resolve(here, p)));
    }
    for (const [, p] of src.matchAll(/(?:from\s+|import\(\s*)"(\.{1,2}\/[^"]+\.m?js)"/g)) {
      queue.push(rel(resolve(here, p)));
    }
  }
  return [...found];
}

describe("pglite-migrations: required, and its path filter covers what it reads", () => {
  it("is a required check (#2538)", () => {
    assert.ok(
      ALL_REQUIRED_CHECKS.includes("pglite-migrations"),
      "pglite-migrations was dropped from the required roster",
    );
  });

  it("the derivation finds the inputs the first review found missing", () => {
    // Guards the derivation itself: if a pattern stops matching, `inputs()`
    // shrinks and the coverage assertion below passes over nothing.
    const found = inputs();
    for (const expected of [
      "apps/api/src/application/services/search.service.ts",
      "scripts/demo/seed-demo.mjs",
      "scripts/ci/lib/environments.mjs",
      ".github/environments.json",
      "scripts/load-chapter-directory.mjs",
      "scripts/lib/chapter-directory-seed.mjs",
    ]) {
      assert.ok(found.includes(expected), `derivation no longer finds ${expected}`);
    }
  });

  it("every input is matched by `changes.pglite`", () => {
    const patterns = pgliteFilter();
    const missing = inputs().filter((path) => !covered(path, patterns));
    assert.deepEqual(
      missing,
      [],
      "the pglite job would skip on a PR changing these, then fail on main",
    );
  });
});
