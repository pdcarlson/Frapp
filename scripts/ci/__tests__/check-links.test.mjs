import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

// check-links.mjs is a general-purpose script under scripts/ (a peer of the
// other check-*.mjs gates); its test lives here so the existing `test:ci-scripts`
// glob (scripts/ci/__tests__/*.test.mjs) runs it — hence the ../../ reach up.
import {
  LOCAL_BINARY,
  parseWorkflowArgs,
  resolveBinary,
  splitArgs,
  WORKFLOW,
} from "../../check-links.mjs";

// The point of this script is that the flags are NOT copied. These tests pin
// that property: if the parser silently returns nothing, the local check would
// stop matching CI, which is the drift the whole gate exists to prevent.

test("the workflow's real args parse, and carry the flag that matters", () => {
  const args = parseWorkflowArgs(readFileSync(WORKFLOW, "utf8"));
  assert.ok(args, `no args: line found in ${WORKFLOW}`);
  // --include-fragments is the only thing in the repo that checks heading
  // anchors. Losing it would make the gate pass while asserting much less.
  assert.match(args, /--include-fragments/);
  assert.match(args, /--offline/);
  assert.match(args, /--exclude-path spec\/ui\/design-system\/reference/);
  // The source roots must still be passed, or lychee walks nothing.
  assert.match(args, /\bdocs\b/);
  assert.match(args, /\bspec\b/);
});

test("a missing args line returns null rather than a silent empty run", () => {
  assert.equal(parseWorkflowArgs("jobs:\n  link-check:\n    runs-on: ubuntu-latest\n"), null);
  // Unquoted form is deliberately not accepted — guessing is worse than failing.
  assert.equal(parseWorkflowArgs("        args: --offline docs\n"), null);
});

test("args are read from the quoted value, not the key", () => {
  const yaml = ['        with:', '          args: "--offline docs spec"', "          fail: true"].join(
    "\n",
  );
  assert.equal(parseWorkflowArgs(yaml), "--offline docs spec");
});

test("splitArgs produces argv, dropping incidental whitespace", () => {
  assert.deepEqual(splitArgs("--offline   --no-progress docs spec"), [
    "--offline",
    "--no-progress",
    "docs",
    "spec",
  ]);
  assert.deepEqual(splitArgs("   "), []);
});

test("the locally installed binary wins over PATH", () => {
  // A developer with an older lychee on PATH should still get the pinned one.
  assert.equal(resolveBinary({ exists: () => true }), LOCAL_BINARY);
});

test("the local binary lives somewhere gitignored", () => {
  assert.equal(LOCAL_BINARY.startsWith(".tools/"), true);
  assert.match(readFileSync(".gitignore", "utf8"), /^\.tools\/$/m);
});
