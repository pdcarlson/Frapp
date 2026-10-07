import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join, posix } from "node:path";

// The PGlite gate (`scripts/pglite/`) runs a tier only when `run.mjs` imports
// it: each tier's body executes on import, and `run.mjs` lists them by hand,
// in order, as awaited dynamic imports (#3226). A tier file that is never
// imported, or whose import line is deleted or commented out, stops running
// without failing anything: the job reports fewer assertions and stays green.
// Worse, `chat-read-surface-ledger.spec.ts` resolves a `{ pglite: '<name>' }`
// proof by finding that `name:` in any module under `scripts/pglite/`, so it
// would keep vouching for a scenario that no longer runs.
//
// So: every tier is imported by `run.mjs` itself, and every module under
// `scripts/pglite/` is reachable from `run.mjs`, which together make "named in
// `scripts/pglite/`" mean "runs in CI".

const REPO = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const HARNESS = "scripts/pglite";
const ENTRY = "run.mjs";

/** `src` with whole-line `//` comments and block comments removed. */
function stripComments(src) {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .split("\n")
    .filter((line) => !line.trimStart().startsWith("//"))
    .join("\n");
}

/** The relative specifiers a module imports, statically or dynamically. */
function relativeImports(src) {
  const code = stripComments(src);
  const found = [];
  for (const m of code.matchAll(/(?:\bfrom\s*|\bimport\s*\(\s*)["'](\.{1,2}\/[^"']+)["']/g)) {
    found.push(m[1]);
  }
  return found;
}

/** Every `.mjs` under the harness, relative to it, `/`-separated. */
function harnessModules() {
  return readdirSync(join(REPO, HARNESS), { recursive: true, encoding: "utf8" })
    .map((rel) => rel.split("\\").join("/"))
    .filter((rel) => rel.endsWith(".mjs"))
    .sort();
}

/** Every harness module reachable from the entry, following relative imports. */
function reachable() {
  const seen = new Set();
  const queue = [ENTRY];
  while (queue.length) {
    const rel = queue.shift();
    if (seen.has(rel)) continue;
    seen.add(rel);
    const src = readFileSync(join(REPO, HARNESS, rel), "utf8");
    for (const spec of relativeImports(src)) {
      const target = posix.normalize(posix.join(posix.dirname(rel), spec));
      // Imports that leave the harness (`../../demo/seed-demo.mjs`) are its
      // inputs, which `pglite-filter-coverage.test.mjs` owns, not its modules.
      if (!target.startsWith("../")) queue.push(target);
    }
  }
  return seen;
}

describe("pglite harness: every tier runs", () => {
  it("run.mjs imports every tier itself", () => {
    const imported = new Set(
      relativeImports(readFileSync(join(REPO, HARNESS, ENTRY), "utf8")).map((spec) =>
        posix.normalize(spec),
      ),
    );
    const tiers = harnessModules().filter((rel) => rel.startsWith("tiers/"));
    assert.ok(tiers.length > 0, "found no tiers — re-point this test");
    const unregistered = tiers.filter((rel) => !imported.has(rel));
    assert.deepEqual(
      unregistered,
      [],
      "these tiers never run: add an `await import(\"./tiers/<name>.mjs\")` line to scripts/pglite/run.mjs, in order",
    );
  });

  it("every module under scripts/pglite is reachable from run.mjs", () => {
    const live = reachable();
    const orphans = harnessModules().filter((rel) => !live.has(rel));
    assert.deepEqual(orphans, [], "nothing imports these, so nothing in them runs");
  });
});

describe("relativeImports reads only live code", () => {
  it("finds static and dynamic forms", () => {
    const src = [
      'import { db } from "./harness.mjs";',
      'await import("./tiers/a.mjs");',
      "const x = await import('../x.mjs');",
      'import { readFileSync } from "node:fs";',
    ].join("\n");
    assert.deepEqual(relativeImports(src), ["./harness.mjs", "./tiers/a.mjs", "../x.mjs"]);
  });

  it("ignores an import that is commented out", () => {
    const src = [
      '// await import("./tiers/off.mjs");',
      '/* await import("./tiers/also-off.mjs"); */',
      'await import("./tiers/on.mjs");',
    ].join("\n");
    assert.deepEqual(relativeImports(src), ["./tiers/on.mjs"]);
  });
});
