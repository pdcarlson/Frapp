import { test } from "node:test";
import assert from "node:assert/strict";

// check-doc-refs.mjs is a general-purpose script under scripts/ (a peer of the
// other check-*.mjs gates); its test lives here so the existing `test:ci-scripts`
// glob (scripts/ci/__tests__/*.test.mjs) runs it — hence the ../../ reach up.
import {
  ALLOWLIST_PATH,
  EXCLUDED,
  EXCLUDED_SEGMENTS,
  extractReferences,
  inScope,
  isExcluded,
  isUrlContext,
  REFERENCE_RE,
} from "../../check-doc-refs.mjs";

// Every case here is a way the gate could pass while asserting nothing. The
// specific failure it exists to prevent already happened once: the spec split in
// epic #432 left `apps/api/README.md` pointing at three files that no longer
// exist, and nothing noticed for months.

// ── Scope: the complement of check-doc-paths ────────────────────────────────

test("the documentation corpus belongs to check-doc-paths, not this gate", () => {
  // Double-checking these would double-report every finding.
  for (const p of [
    "docs/guides/testing.md",
    "spec/behavior/rbac.md",
    ".claude/skills/audit/SKILL.md",
    "AGENTS.md",
    "apps/web/AGENTS.md",
    "README.md",
    "CONTRIBUTING.md",
  ]) {
    assert.equal(inScope(p), false, p);
  }
});

test("source, tests, workflows, migrations and shell are in scope", () => {
  for (const p of [
    "apps/api/README.md",
    "apps/api/src/main.ts",
    "packages/theme/src/signet.spec.ts",
    "supabase/seed.sql",
    "scripts/local-dev-setup.sh",
    ".github/workflows/ci.yml",
    ".claude/commands/next.md",
  ]) {
    assert.equal(inScope(p), true, p);
  }
});

test("nested package READMEs are in scope — check-doc-paths only takes the root one", () => {
  assert.equal(inScope("packages/hooks/README.md"), true);
  assert.equal(inScope("README.md"), false);
});

// ── Exclusions ──────────────────────────────────────────────────────────────

test("the buildpad export, the gitleaks baseline and the sibling allowlist are excluded", () => {
  assert.equal(isExcluded(".buildpad/blobs/x/y.md"), true);
  assert.equal(isExcluded(".gitleaks-baseline.json"), true);
  assert.equal(isExcluded("scripts/doc-paths-allowlist.json"), true);
  assert.equal(isExcluded("apps/api/src/main.ts"), false);
});

test("assertion fixtures are excluded, at any depth", () => {
  // A gate's own test must be free to write `spec/invented/thing.md` and assert
  // that it is rejected. Without this, this very file fails the gate it tests.
  assert.equal(isExcluded("scripts/ci/__tests__/check-docs-structure.test.mjs"), true);
  assert.equal(isExcluded("apps/api/src/foo/__tests__/bar.spec.ts"), true);
  assert.equal(isExcluded("apps/api/src/foo/bar.spec.ts"), false);
});

test("the gate excludes its OWN allowlist, not just the sibling one", () => {
  // Regression: only doc-paths-allowlist.json was excluded at first. Once this
  // gate's own allowlist became a tracked file, every excuse in it — the path
  // AND the path named in its reason prose — was reported as a violation of
  // itself. It is scanned by its own scope, so this is not hypothetical.
  assert.equal(isExcluded(ALLOWLIST_PATH), true);
  assert.equal(EXCLUDED.includes(ALLOWLIST_PATH), true);
});

test("the gate's own source is IN scope, so its comments must name no dead path", () => {
  // Self-scanning is deliberate: a lint that exempts itself is how the example
  // in a comment quietly becomes wrong. Keeping it in scope is what forced the
  // header comments here to describe dead pointers instead of citing them.
  assert.equal(inScope("scripts/check-doc-refs.mjs"), true);
});

test("the exclusion lists are non-empty and anchored", () => {
  assert.ok(EXCLUDED.length > 0);
  assert.deepEqual(EXCLUDED_SEGMENTS, ["__tests__/"]);
  // A prefix match must be anchored at the repo root.
  assert.equal(isExcluded("apps/web/.buildpad/x.md"), false);
});

// ── Extraction ──────────────────────────────────────────────────────────────

test("bare references are found — the whole point of a second extractor", () => {
  // check-doc-paths requires an inline code span. Source files do not use one.
  const text = "-- They document the permission sets defined in spec/behavior.md Section 2.";
  assert.deepEqual(extractReferences(text), [{ token: "spec/behavior.md", line: 1 }]);
});

test("backticked references are found too", () => {
  const found = extractReferences("* documented in `docs/internal/ops/DEPLOYMENT.md`.");
  assert.deepEqual(found, [{ token: "docs/internal/ops/DEPLOYMENT.md", line: 1 }]);
});

test("line numbers are per-occurrence, not first-match", () => {
  const text = ["a spec/one.md", "", "b spec/one.md"].join("\n");
  assert.deepEqual(extractReferences(text), [
    { token: "spec/one.md", line: 1 },
    { token: "spec/one.md", line: 3 },
  ]);
});

test("only docs/ and spec/ roots are extracted", () => {
  assert.deepEqual(extractReferences("see apps/api/README.md and notes.md"), []);
});

test("a directory reference is not a file reference", () => {
  // `spec/behavior/` is a live pointer but resolving it as a file is meaningless.
  assert.deepEqual(extractReferences("- Behavior spec: `spec/behavior/`"), []);
});

test("a nested docs/ segment is not a repo-root reference", () => {
  // `apps/web/docs/guides/testing.md` makes no claim about the root corpus, and
  // resolving the tail against the root would check the wrong file entirely.
  assert.deepEqual(extractReferences("see apps/web/docs/guides/testing.md"), []);
  assert.deepEqual(extractReferences("packages/theme/spec/tokens.md"), []);
});

test("the two hand-written root-relative forms are still caught", () => {
  for (const line of ["./docs/guides/testing.md", "/docs/guides/testing.md"]) {
    assert.deepEqual(
      extractReferences(line).map((r) => r.token),
      ["docs/guides/testing.md"],
      line,
    );
  }
});

// ── URLs ────────────────────────────────────────────────────────────────────

test("a reference inside a URL is not a repo path", () => {
  const line = "  see https://github.com/pdcarlson/Frapp/blob/abc/docs/internal/x.md#L4";
  assert.equal(isUrlContext(line, line.indexOf("docs/internal/x.md")), true);
  assert.deepEqual(extractReferences(line), []);
});

test("a bare path on a line that also holds a URL is still checked", () => {
  // Anchoring on the whitespace-delimited run, not the whole line, is what
  // keeps this from silently excusing a real dead pointer.
  const line = "https://example.com/x see docs/real.md";
  assert.deepEqual(extractReferences(line), [{ token: "docs/real.md", line: 1 }]);
});

// ── Shape ───────────────────────────────────────────────────────────────────

test("the regex is global, so matchAll does not loop forever or skip", () => {
  assert.equal(REFERENCE_RE.global, true);
});

test("the allowlist path is the one the failure message names", () => {
  assert.equal(ALLOWLIST_PATH, "scripts/doc-refs-allowlist.json");
});

// ── Regressions found in review ─────────────────────────────────────────────

test("a URL is bounded by any separator, not just a space", () => {
  // isUrlContext walked back to the nearest SPACE, so a tab, comma or closing
  // quote between a URL and a real dead pointer suppressed the finding.
  for (const sep of ["\t", ",", '"', "'", "`", ")", "]"]) {
    assert.deepEqual(
      extractReferences(`https://a.b/c${sep}docs/real.md`).map((r) => r.token),
      ["docs/real.md"],
      JSON.stringify(sep),
    );
  }
});

test("a genuine permalink is still suppressed", () => {
  assert.deepEqual(extractReferences("https://github.com/o/r/blob/sha/docs/x.md"), []);
});
