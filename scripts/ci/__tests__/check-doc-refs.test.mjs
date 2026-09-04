import { test } from "node:test";
import assert from "node:assert/strict";

// check-doc-refs.mjs is a general-purpose script under scripts/ (a peer of the
// other check-*.mjs gates); its test lives here so the existing `test:ci-scripts`
// glob (scripts/ci/__tests__/*.test.mjs) runs it — hence the ../../ reach up.
import {
  ALLOWLIST_PATH,
  BARE_BASENAME_RE,
  basenameIndex,
  blankFencedBlocks,
  scanFile,
  EXCLUDED,
  EXCLUDED_SEGMENTS,
  extractBasenameReferences,
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

test("the gitleaks baseline and the sibling allowlist are excluded", () => {
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

// ── Pass 2: bare filenames (the rename case) ────────────────────────────────
//
// Each case here is a way the second pass could pass while asserting nothing.
// What the pass is for: docs/internal/ci-cd/DOCS_CI.md § References.

test("a bare filename is found — pass 1 cannot see it at all", () => {
  const line = "// see ENV_REFERENCE.md for the full list";
  assert.deepEqual(extractReferences(line), [], "pass 1 must stay blind to this");
  assert.deepEqual(extractBasenameReferences(line), [{ token: "ENV_REFERENCE.md", line: 1 }]);
});

test("a filename inside a full path is NOT double-counted", () => {
  // Pass 1 owns the whole path; matching the tail again would report it twice.
  assert.deepEqual(extractBasenameReferences("docs/internal/environment/ENV_REFERENCE.md"), []);
  assert.deepEqual(extractBasenameReferences("./docs/x.md"), []);
  assert.deepEqual(extractBasenameReferences("/spec/y.md"), []);
});

test("a backslash escape is not a filename starting with a digit", () => {
  // A quoted-path example embeds octal escapes; `\303\211.md` is one token,
  // not a reference to `211.md`. Without the backslash in the lookbehind this
  // gate reported its own source as a dead pointer.
  assert.deepEqual(extractBasenameReferences('"docs/guides/BAD_NAM\\303\\211.md"'), []);
});

test("a token must be whole — a filename is not a suffix of an identifier", () => {
  assert.deepEqual(extractBasenameReferences("some_prefix.md"), [
    { token: "some_prefix.md", line: 1 },
  ]);
  // A dotted property path is not a filename: the segment before it disqualifies it.
  assert.deepEqual(extractBasenameReferences("tokens.spacing.md"), []);
});

test("both naming conventions are matched, since the corpus holds both", () => {
  for (const name of ["ROUTINES.md", "env-reference.md", "README.md", "adr-16.md"]) {
    assert.deepEqual(
      extractBasenameReferences(`cite ${name} here`),
      [{ token: name, line: 1 }],
      `expected to match ${name}`,
    );
  }
});

test("a bare filename inside a URL is not a repo reference", () => {
  // Deliberately a QUERY-STRING url. The obvious fixture — a filename after a
  // path separator — is rejected by the lookbehind before isUrlContext is ever
  // consulted, so it asserts the regex twice and the guard not at all: the guard
  // could be deleted with every test still green.
  assert.deepEqual(extractBasenameReferences("https://example.com/wiki?file=CHANGELOG.md"), []);
  assert.deepEqual(extractBasenameReferences("https://example.com/x?doc=ROUTINES.md&v=1"), []);
  // Same token, no URL: found.
  assert.deepEqual(extractBasenameReferences("file=CHANGELOG.md"), [
    { token: "CHANGELOG.md", line: 1 },
  ]);
});

test("the trailing boundary keeps a longer extension from reading as `.md`", () => {
  // No .mdx or .mdc lives anywhere in the tree today, so this
  // anchor looks decorative. It is not: without it, every reference.mdx in a
  // future Docusaurus or Cursor-rules directory reports as a dead markdown file.
  for (const name of ["reference.mdx", "guide.mdc", "notes.mdown", "sum.md5"]) {
    assert.deepEqual(extractBasenameReferences(`see ${name}`), [], `${name} must not match`);
  }
});

test("a COMPOUND extension does not match its own markdown-looking head", () => {
  // `\b` alone passes the four cases above and still fails these: a template or
  // a backup names a file that EXISTS, so reporting its head as a dead doc
  // leaves no correct edit -- the reference is already right.
  for (const name of ["issue.md.hbs", "CHANGELOG.md.tmpl", "README.md-old"]) {
    assert.deepEqual(extractBasenameReferences(`see ${name}`), [], `${name} must not match`);
  }
  // ...while ordinary trailing punctuation must still terminate a real one.
  for (const s of ["see notes.md here", "(notes.md)", "end notes.md", "notes.md, then"]) {
    assert.deepEqual(
      extractBasenameReferences(s).map((r) => r.token),
      ["notes.md"],
      s,
    );
  }
});

test("fenced worked examples are not references, and line numbers survive", () => {
  // 17 tracked markdown files sit outside the docs corpus and are scanned here
  // -- command files, the PR template, package READMEs. A shell transcript in
  // one of them naming a filename is an example, not a claim.
  const text = ["intro GOOD.md", "```bash", "git mv OLD.md new-name.md", "```", "tail LATER.md"].join(
    "\n",
  );
  assert.deepEqual(extractBasenameReferences(text), [
    { token: "GOOD.md", line: 1 },
    // 5, not 3: blanking the fence must preserve newlines, because this gate
    // reports a LINE. check-doc-paths.mjs reports per file, so it may collapse.
    { token: "LATER.md", line: 5 },
  ]);
});

test("an unterminated fence strips nothing, rather than swallowing the file", () => {
  const text = ["a UNCLOSED.md", "```", "b INSIDE.md"].join("\n");
  assert.deepEqual(
    extractBasenameReferences(text).map((r) => r.token),
    ["UNCLOSED.md", "INSIDE.md"],
  );
});

test("blankFencedBlocks keeps the line count identical", () => {
  const text = ["a", "```", "x", "y", "```", "b"].join("\n");
  assert.equal(blankFencedBlocks(text).split("\n").length, text.split("\n").length);
  assert.ok(!blankFencedBlocks(text).includes("x"));
});

test("line numbers are per-occurrence, like pass 1", () => {
  const text = ["nothing", "cite A_DOC.md", "nothing", "cite B_DOC.md"].join("\n");
  assert.deepEqual(extractBasenameReferences(text), [
    { token: "A_DOC.md", line: 2 },
    { token: "B_DOC.md", line: 4 },
  ]);
});

test("the regex is global, so matchAll does not loop forever or skip", () => {
  assert.ok(BARE_BASENAME_RE.global);
  assert.deepEqual(extractBasenameReferences("A.md and B.md"), [
    { token: "A.md", line: 1 },
    { token: "B.md", line: 1 },
  ]);
});

test("basenameIndex keys on the filename, so a move does not read as a rename", () => {
  // Deliberately weaker than pass 1: a bare filename names no directory, so it
  // cannot say which file it meant. The question is only whether the name lives.
  const idx = basenameIndex(["docs/internal/ops/DEPLOYMENT.md", "spec/README.md", "a/b/c.ts"]);
  assert.ok(idx.has("DEPLOYMENT.md"));
  assert.ok(idx.has("README.md"));
  assert.ok(idx.has("c.ts"));
  assert.ok(!idx.has("MISSING.md"));
  // The same doc moved to another declared home still resolves by name...
  assert.ok(basenameIndex(["docs/DEPLOYMENT.md"]).has("DEPLOYMENT.md"));
  // ...but renamed, it does not. That is the case this pass exists for.
  assert.ok(!basenameIndex(["docs/internal/ops/deployment.md"]).has("DEPLOYMENT.md"));
});

test("a path with no directory part is handled — slice must not eat the name", () => {
  assert.ok(basenameIndex(["AGENTS.md"]).has("AGENTS.md"));
});

// ── The wiring, not just the extractors ─────────────────────────────────────
//
// Every test above exercises a pure function. None of them notices if the
// second pass is never CALLED. That is not hypothetical: with the scan inlined
// in main(), deleting the whole pass-2 loop left all of these green and the
// gate printing success. scanFile() exists to make the wiring assertable.

const DEPS = {
  trackedSet: new Set(["docs/guides/testing.md"]),
  basenames: basenameIndex(["docs/guides/testing.md", "docs/internal/ops/DEPLOYMENT.md"]),
  allowlist: { prefixes: [], paths: [], perFile: [] },
};

test("scanFile reports a dead bare filename — the pass-2 loop must be reached", () => {
  const r = scanFile("apps/api/src/thing.ts", "// see GONE_DOC.md for details", DEPS);
  assert.deepEqual(r.findings, [
    { file: "apps/api/src/thing.ts", line: 1, token: "GONE_DOC.md" },
  ]);
  assert.equal(r.basenameCount, 1);
});

test("scanFile resolves a live bare filename by name alone", () => {
  const r = scanFile("a.ts", "// see DEPLOYMENT.md", DEPS);
  assert.deepEqual(r.findings, []);
  assert.equal(r.basenameCount, 1);
});

test("scanFile still reports a dead PATH — pass 1 is not lost in the refactor", () => {
  const r = scanFile("a.ts", "see spec/behavior/gone.md", DEPS);
  assert.equal(r.findings.length, 1);
  assert.equal(r.findings[0].token, "spec/behavior/gone.md");
  assert.equal(r.referenceCount, 1);
  assert.equal(r.basenameCount, 0, "a full path must not also count as a filename");
});

test("both passes run over the same file, and each counts separately", () => {
  const r = scanFile("a.ts", "docs/guides/testing.md and DEPLOYMENT.md", DEPS);
  assert.deepEqual(r.findings, []);
  assert.equal(r.referenceCount, 1);
  assert.equal(r.basenameCount, 1);
});

test("a pass-2 excuse is consulted BEFORE resolution, so a name collision cannot stale it", () => {
  // The excuse says "this token is not a document reference at all". If
  // resolution were checked first, the day anyone added a file with that
  // basename the entry would stop being used -- and an entry that excuses
  // nothing FAILS the run, so the gate would demand deleting an excuse still
  // covering live tokens. Here `spacing.md` both resolves AND is excused.
  const allowlist = {
    prefixes: [],
    paths: [],
    perFile: [{ file: "ui.tsx", path: "spacing.md", reason: "a design token, not a doc" }],
  };
  const deps = { ...DEPS, basenames: basenameIndex(["spec/ui/spacing.md"]), allowlist };
  const r = scanFile("ui.tsx", "// `spacing.md` is 12", deps);
  assert.deepEqual(r.findings, []);
  assert.deepEqual([...r.used], ["perFile[0]"], "the entry must register as used");
});

test("a pass-2 excuse is scoped to its file, like pass 1", () => {
  const allowlist = {
    prefixes: [],
    paths: [],
    perFile: [{ file: "ui.tsx", path: "spacing.md", reason: "a design token, not a doc" }],
  };
  const deps = { ...DEPS, allowlist };
  assert.deepEqual(scanFile("ui.tsx", "`spacing.md`", deps).findings, []);
  assert.equal(
    scanFile("other.tsx", "`spacing.md`", deps).findings.length,
    1,
    "the same token elsewhere is more likely a real dead pointer",
  );
});
