import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join, relative, resolve } from "node:path";

import { ALL_REQUIRED_CHECKS } from "../lib/required-checks.mjs";
import { SEED_RELATIVE_PATH } from "../../lib/chapter-directory-seed.mjs";

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
// repo path the check reads by `join(REPO_ROOT, ...)`, every relative module it
// imports (followed transitively), every script it runs via
// `join(process.cwd(), ...)`, and every `new URL("...", import.meta.url)` file
// those modules read. Any number of arguments and any quote style count as long
// as each argument is a literal. A `join(REPO_ROOT, ...)` with a computed
// argument fails the test rather than being skipped, because this derivation
// cannot resolve it. A path read through some other computed form (a module
// constant joined onto a local root, say) is invisible here; the one such input
// today, the chapter directory seed, is imported from its module below rather
// than restated.

const REPO = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const ENTRY = "scripts/check-pglite-migrations.mjs";

// Inputs the job depends on that no source line names: the job's own definition,
// the npm script it runs, the lockfile, the migrations directory it globs, and
// the seed CSV `chapter-directory-seed.mjs` reads through its own constant.
const STRUCTURAL = [
  ".github/workflows/ci.yml",
  "package.json",
  "package-lock.json",
  "supabase/migrations/0000_example.sql",
  SEED_RELATIVE_PATH.split("\\").join("/"),
];

/** A single `"..."`, `'...'` or interpolation-free template literal. */
const LITERAL = /^\s*(?:"([^"]*)"|'([^']*)'|`([^`$]*)`)\s*$/;

/**
 * The string values of a comma-separated argument list, or `null` when any
 * argument is not a literal. No argument in these files contains a comma.
 */
function literalArgs(list) {
  const values = [];
  for (const arg of list.split(",")) {
    if (arg.trim() === "") continue;
    const m = arg.match(LITERAL);
    if (!m) return null;
    values.push(m[1] ?? m[2] ?? m[3]);
  }
  return values;
}

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

/**
 * dorny/paths-filter semantics for the two forms the filter uses. A directory
 * input (`join(REPO_ROOT, "supabase", "migrations")`) is covered when a file
 * inside it would be.
 */
function covered(path, patterns) {
  const abs = join(REPO, path);
  const probe = existsSync(abs) && statSync(abs).isDirectory() ? `${path}/x` : path;
  return patterns.some((p) =>
    p.endsWith("/**") ? probe.startsWith(p.slice(0, -2)) : probe === p,
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

    for (const [call, list] of src.matchAll(/join\(\s*REPO_ROOT\s*,([^)]*)\)/g)) {
      const parts = literalArgs(list);
      assert.ok(
        parts,
        `${file}: \`${call}\` builds a path this test cannot resolve — ` +
          "write it with literal arguments, or add it to STRUCTURAL",
      );
      found.add(parts.join("/"));
    }
    for (const [call, list] of src.matchAll(/join\(\s*process\.cwd\(\)\s*,([^)]*)\)/g)) {
      const parts = literalArgs(list);
      assert.ok(parts, `${file}: \`${call}\` runs a script this test cannot resolve`);
      queue.push(parts.join("/"));
    }
    for (const [, q1, q2] of src.matchAll(
      /new URL\(\s*(?:"(\.{1,2}\/[^"]+)"|'(\.{1,2}\/[^']+)')\s*,\s*import\.meta\.url\s*\)/g,
    )) {
      found.add(rel(resolve(here, q1 ?? q2)));
    }
    for (const [, q1, q2] of src.matchAll(
      /(?:from\s+|import\(\s*)(?:"(\.{1,2}\/[^"]+\.m?js)"|'(\.{1,2}\/[^']+\.m?js)')/g,
    )) {
      queue.push(rel(resolve(here, q1 ?? q2)));
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
      "supabase/migrations",
      "supabase/seed/chapter_directory.csv",
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
