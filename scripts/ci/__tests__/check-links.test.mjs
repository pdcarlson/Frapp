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
  WORKFLOW_LABEL,
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
  assert.equal(resolveBinary({ exists: () => true, spawn: () => ({ status: 0 }) }), LOCAL_BINARY);
});

test("a cached binary that cannot execute falls through instead of throwing", () => {
  // Trusting existsSync meant a file with a lost mode bit — or an x86_64 binary
  // in a cache shared with an arm64 host — was returned, and execFileSync then
  // threw an uncaught EACCES/ENOEXEC instead of the install message.
  const spawn = (bin) => (bin === LOCAL_BINARY ? { status: 126 } : { status: 0 });
  assert.equal(resolveBinary({ exists: () => true, spawn }), "lychee");
});

test("no usable binary anywhere returns null, so main() can print the fix", () => {
  const enoent = () => ({ error: new Error("spawn ENOENT"), status: null });
  assert.equal(resolveBinary({ exists: () => false, spawn: enoent }), null);
  // Present but broken, and nothing on PATH either.
  assert.equal(resolveBinary({ exists: () => true, spawn: enoent }), null);
});

test("the local binary uses the repo's tooling-cache convention, and is gitignored", () => {
  // install-gitleaks.sh and install-oasdiff.sh both cache under .cache/<tool>/;
  // a second convention would be one more place to look for the same kind of thing.
  assert.match(LOCAL_BINARY, /[\\/]\.cache[\\/]lychee[\\/]lychee$/);
  // The ignore is asserted as the whole-directory `.cache/` rather than a
  // per-tool `.cache/lychee/` line. The five per-tool entries were collapsed
  // because `.cache` itself was not ignored, so the next tool to cache there
  // showed up untracked — which is how that list reached five. The property
  // this test cares about is unchanged: the cached binary is never committable.
  assert.match(readFileSync(".gitignore", "utf8"), /^\.cache\/$/m);
});

test("paths resolve from the repo root, not the cwd", () => {
  // Every doc gate here is cwd-relative and misreports from a subdirectory.
  // This one anchors on import.meta.url instead, like scan-secrets.mjs.
  assert.equal(WORKFLOW.startsWith("/"), true, "WORKFLOW should be absolute");
  assert.equal(LOCAL_BINARY.startsWith("/"), true, "LOCAL_BINARY should be absolute");
  // The label shown to a human stays repo-relative.
  assert.equal(WORKFLOW_LABEL, ".github/workflows/links.yml");
});
