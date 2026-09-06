import { strict as assert } from "node:assert";
import { readFileSync, readdirSync } from "node:fs";
import { join, relative } from "node:path";
import test from "node:test";

/**
 * Pins that `npm run test:ci-scripts` actually collects every suite in this
 * directory, and that it keeps the one invocation form portable across the
 * Node majors this repo runs on.
 *
 * WHY THE SUFFIX HERE IS `.test`, NOT THE REPO'S `.spec`. Node's built-in
 * runner collects by pattern, and its default is
 * `**\/{test,test\/**\/*,test-*,*[._-]test}.{js,mjs,cjs,ts,mts,cts}` — there is
 * no `.spec` form in it. So a `foo.spec.mjs` added here is picked up by no
 * pattern-based invocation, and by this script's glob least of all. (Run
 * directly by path it executes fine on both majors, which is exactly why the
 * gap is easy to talk yourself out of.) Renaming this directory to the repo
 * convention would silently disable every suite in it.
 *
 * WHY THE GLOB IS UNQUOTED, AND STAYS THAT WAY. `npm` runs scripts through
 * `sh` — dash on CI's Ubuntu — which expands `*` but does not brace-expand.
 * All three tempting rewrites are worse, and none of them is portable:
 *
 *   - `node --test scripts/ci/__tests__/` — Node 20 recurses into the
 *     directory; Node 22+ stopped treating a positional as a directory and
 *     throws `MODULE_NOT_FOUND`. CI pins Node 20, so this stays green in CI
 *     and breaks every local run.
 *   - `"scripts/ci/__tests__/*.test.mjs"` quoted, so Node globs it — the
 *     inverse: fine on Node 22, and on Node 20 a literal path that fails with
 *     `Could not find '…'`.
 *   - `*.{test,spec}.mjs` — dash leaves the braces alone and hands the literal
 *     to Node. Node 22's own glob engine then expands it and quietly collects
 *     more than intended; Node 20 exits 1 with `Could not find '…'`. Loud in
 *     one place, over-matching in the other.
 *
 * Unquoted `*.test.mjs` is the only form that works on both, because the shell
 * expands it to explicit paths first and explicit paths are honoured by every
 * version.
 *
 * The collection test below asserts the PROPERTY (everything suite-shaped in
 * this tree is actually run) rather than the proxy (filenames end in
 * `.test.mjs`), because the proxy passes cleanly on `check-foo.test.js`, on
 * `nested/deep.test.mjs`, and on `test-foo.mjs` — three files the script's
 * glob silently drops.
 */

const repoRoot = join(import.meta.dirname, "..", "..", "..");
const testsDir = join(repoRoot, "scripts", "ci", "__tests__");

const TEST_EXTENSIONS = ["js", "mjs", "cjs", "ts", "mts", "cts"];

/**
 * Files that look like a suite to a reader or to Node, but are deliberately
 * not one. Keep this empty unless a file genuinely earns a place: the point of
 * the assertion is that additions here are a conscious act.
 */
const NON_SUITE_FILES = new Set();

/** Node's own default matcher, plus the `.spec` form the repo uses elsewhere. */
function looksLikeASuite(basename) {
  const ext = TEST_EXTENSIONS.find((candidate) =>
    basename.endsWith(`.${candidate}`),
  );
  if (!ext) return false;
  const stem = basename.slice(0, -(ext.length + 1));
  return (
    stem === "test" ||
    stem.startsWith("test-") ||
    /[._-]test$/.test(stem) ||
    /(^|[._-])spec$/.test(stem)
  );
}

function walk(dir) {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) return walk(full);
    return entry.isFile() ? [full] : [];
  });
}

/** What `scripts/ci/__tests__/*.test.mjs` expands to: depth 1, `.test.mjs` only. */
function collectedByTheScript() {
  return new Set(
    readdirSync(testsDir, { withFileTypes: true })
      .filter((entry) => entry.isFile() && entry.name.endsWith(".test.mjs"))
      .map((entry) => join(testsDir, entry.name)),
  );
}

test("test:ci-scripts keeps the one invocation form that works on Node 20 and 22", () => {
  const { scripts } = JSON.parse(
    readFileSync(join(repoRoot, "package.json"), "utf8"),
  );
  const script = scripts["test:ci-scripts"];

  // Token-based rather than string equality, so that adding a flag such as
  // `--test-reporter=spec` stays legal while none of the three unsafe
  // rewrites can slip through: the bare-directory form loses the glob token,
  // and the quoted and brace forms are caught by the character check below.
  assert.ok(
    script.split(/\s+/).includes("scripts/ci/__tests__/*.test.mjs"),
    `test:ci-scripts no longer passes the bare glob \`scripts/ci/__tests__/*.test.mjs\` ` +
      `(found: ${script}). The directory form breaks on Node 22 — read the notes ` +
      `at the top of this file before changing it.`,
  );

  const unportable = [...script].filter((char) => '{}"\''.includes(char));
  assert.deepEqual(
    unportable,
    [],
    `test:ci-scripts must not quote or brace-expand its glob (found: ${script}). ` +
      `Quoting breaks on Node 20; braces over-match on Node 22 and fail on Node 20.`,
  );
});

test("every suite-shaped file in this directory is one the script actually runs", () => {
  const collected = collectedByTheScript();

  const skipped = walk(testsDir)
    .filter((file) => {
      const name = file.slice(file.lastIndexOf("/") + 1);
      return looksLikeASuite(name) && !NON_SUITE_FILES.has(name);
    })
    .filter((file) => !collected.has(file))
    .map((file) => relative(repoRoot, file))
    .sort();

  assert.deepEqual(
    skipped,
    [],
    `these files look like suites and \`npm run test:ci-scripts\` never runs them: ` +
      `${skipped.join(", ")}. Its glob is \`scripts/ci/__tests__/*.test.mjs\` — one ` +
      `directory deep, \`.test.mjs\` only — so rename them to \`*.test.mjs\` here, or ` +
      `add a genuine non-suite file to NON_SUITE_FILES.`,
  );
});
