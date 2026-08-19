import { test } from "node:test";
import assert from "node:assert/strict";

// check-docs-impact.mjs is a general-purpose script under scripts/ (a peer of
// the other check-*.mjs gates); its test lives here so the existing
// `test:ci-scripts` glob (scripts/ci/__tests__/*.test.mjs) runs it — hence the
// ../../ reach up.
import { classifyChanges, NON_CODE_PREFIXES } from "../../check-docs-impact.mjs";

/** The gate's verdict, expressed the way main() computes it. */
function fails(changed) {
  const { docsOrSpec, requiresDocs } = classifyChanges(changed);
  return requiresDocs.length > 0 && docsOrSpec.length === 0;
}

// ── The base contract ───────────────────────────────────────────────────────

test("code with no doc touch fails the gate", () => {
  assert.equal(fails(["apps/api/src/main.ts"]), true);
});

test("either prefix satisfies the gate for a code change", () => {
  assert.equal(fails(["apps/api/src/main.ts", "docs/guides/testing.md"]), false);
  assert.equal(fails(["apps/api/src/main.ts", "spec/behavior/tasks.md"]), false);
});

test("a docs-only PR passes", () => {
  assert.equal(fails(["docs/README.md"]), false);
});

test("an empty diff passes", () => {
  assert.equal(fails([]), false);
});

// ── The .buildpad/ exemption ────────────────────────────────────────────────

test(".buildpad/ is the only exempt prefix", () => {
  assert.deepEqual(NON_CODE_PREFIXES, [".buildpad/"]);
});

test("a canvas-sync PR touching only .buildpad/ passes", () => {
  assert.equal(
    fails([".buildpad/blobs/the-idea/the-idea.md", ".buildpad/notes/decided-extract-appsweblibchat-into.md"]),
    false,
  );
});

test("exempt paths are reported separately, not counted as the doc touch", () => {
  const { docsOrSpec, exempt, requiresDocs } = classifyChanges([".buildpad/notes/x.md"]);
  assert.deepEqual(docsOrSpec, []);
  assert.deepEqual(exempt, [".buildpad/notes/x.md"]);
  assert.deepEqual(requiresDocs, []);
});

test(".buildpad/ cannot satisfy the gate for a real code change", () => {
  assert.equal(fails([".buildpad/notes/x.md", "apps/api/src/main.ts"]), true);
});

test("the code change is still named in the failure, the exempt paths are not", () => {
  const { requiresDocs } = classifyChanges([".buildpad/notes/x.md", "apps/api/src/main.ts"]);
  assert.deepEqual(requiresDocs, ["apps/api/src/main.ts"]);
});

test("code plus .buildpad/ plus a doc passes", () => {
  assert.equal(
    fails([".buildpad/notes/x.md", "apps/api/src/main.ts", "spec/behavior/tasks.md"]),
    false,
  );
});

// ── The exemption must not leak ─────────────────────────────────────────────

test("other dotfile directories are still code — .claude/ is not exempt (see #810)", () => {
  assert.equal(fails([".claude/skills/audit/SKILL.md"]), true);
  assert.equal(fails([".github/workflows/ci.yml"]), true);
});

test("the prefix anchors at the repo root, so a nested .buildpad/ is not exempt", () => {
  assert.equal(fails(["apps/web/.buildpad/notes/x.md"]), true);
});

test("a lookalike sibling directory is not exempt", () => {
  assert.equal(fails([".buildpad-scripts/run.mjs"]), true);
});
