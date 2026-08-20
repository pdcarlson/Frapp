import { test } from "node:test";
import assert from "node:assert/strict";

// check-docs-impact.mjs is a general-purpose script under scripts/ (a peer of
// the other check-*.mjs gates); its test lives here so the existing
// `test:ci-scripts` glob (scripts/ci/__tests__/*.test.mjs) runs it — hence the
// ../../ reach up.
import {
  classifyChanges,
  EXEMPT_LABEL,
  hasExemptLabel,
  NON_CODE_PREFIXES,
  parseLabels,
} from "../../check-docs-impact.mjs";

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

// ── The no-doc-change-needed label waiver ───────────────────────────────────
//
// The waiver is what makes a pure-code PR mergeable at all: the gate is
// required under `enforce_admins: true`, so a change with no docs impact is
// otherwise permanently blocked rather than merely red.

test("the label waives the gate", () => {
  assert.equal(hasExemptLabel([EXEMPT_LABEL]), true);
  assert.equal(hasExemptLabel(["area:ci", EXEMPT_LABEL, "P2"]), true);
});

test("surrounding whitespace does not defeat the label", () => {
  assert.equal(hasExemptLabel([` ${EXEMPT_LABEL} `]), true);
});

test("no labels, unrelated labels, and near-misses do not waive the gate", () => {
  assert.equal(hasExemptLabel([]), false);
  assert.equal(hasExemptLabel(["area:ci", "P2"]), false);
  assert.equal(hasExemptLabel(["no-doc-change"]), false);
  assert.equal(hasExemptLabel(["No-Doc-Change-Needed"]), false);
  assert.equal(hasExemptLabel(["skip-docs-check"]), false);
});

test("a non-array label value never waives the gate", () => {
  assert.equal(hasExemptLabel(undefined), false);
  assert.equal(hasExemptLabel(null), false);
  assert.equal(hasExemptLabel(EXEMPT_LABEL), false);
  assert.equal(hasExemptLabel({ 0: EXEMPT_LABEL }), false);
});

test("parseLabels reads the JSON array GitHub Actions passes through env", () => {
  assert.deepEqual(parseLabels('["area:ci","P2"]'), ["area:ci", "P2"]);
  // toJSON() renders multi-line; JSON.parse handles it, so the env value is
  // usable verbatim without trimming in the workflow.
  assert.deepEqual(parseLabels('[\n  "area:ci",\n  "P2"\n]'), ["area:ci", "P2"]);
});

test("an absent or unparseable label value is treated as no labels, never as a waiver", () => {
  assert.deepEqual(parseLabels(undefined), []);
  assert.deepEqual(parseLabels(""), []);
  assert.deepEqual(parseLabels("   "), []);
  assert.deepEqual(parseLabels("not json"), []);
  // A push build has no PR payload, so `toJSON(...)` renders `null`.
  assert.deepEqual(parseLabels("null"), []);
  assert.equal(hasExemptLabel(parseLabels("not json")), false);
});

test("the waiver is a fixed name, so the workflow and the docs cannot drift from it", () => {
  assert.equal(EXEMPT_LABEL, "no-doc-change-needed");
});
