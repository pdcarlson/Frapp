import { test } from "node:test";
import assert from "node:assert/strict";

// check-doc-paths.mjs is a general-purpose script under scripts/ (a peer of the
// other check-*.mjs gates); its test lives here so the existing `test:ci-scripts`
// glob (scripts/ci/__tests__/*.test.mjs) runs it — hence the ../../ reach up.
import {
  inScope,
  stripFencedBlocks,
  isNotAPath,
  normalizeCitation,
  extractCitations,
  makeResolver,
  validateAllowlist,
  matchAllowlist,
  findStaleEntries,
} from "../../check-doc-paths.mjs";

// ── Scope ───────────────────────────────────────────────────────────────────

test("docs, spec, skills, AGENTS.md and the root contract files are in scope", () => {
  for (const p of [
    "docs/guides/testing.md",
    "spec/behavior/points.md",
    ".claude/skills/audit/SKILL.md",
    "AGENTS.md",
    "apps/web/AGENTS.md",
    "README.md",
    "CONTRIBUTING.md",
  ]) {
    assert.equal(inScope(p), true, p);
  }
});

test("source files and non-contract READMEs stay out of scope", () => {
  for (const p of ["apps/api/src/main.ts", "packages/ui/README.md", "docs/guides/img.png"]) {
    assert.equal(inScope(p), false, p);
  }
});

test("design-system/reference is excluded, matching the Links gate", () => {
  assert.equal(inScope("spec/ui/design-system/reference/export.md"), false);
});

// ── Fenced blocks are examples, not citations ───────────────────────────────

test("fenced blocks are stripped so worked examples never produce findings", () => {
  const text = ["Real `apps/api/src/main.ts`.", "```bash", "cat `made/up/file.ts`", "```", "Tail."].join(
    "\n",
  );
  const stripped = stripFencedBlocks(text);
  assert.ok(stripped.includes("apps/api/src/main.ts"));
  assert.ok(!stripped.includes("made/up/file.ts"));
});

test("tilde fences are stripped too", () => {
  assert.ok(!stripFencedBlocks("~~~\n`x/y.ts`\n~~~").includes("x/y.ts"));
});

// ── Noise classes ───────────────────────────────────────────────────────────

test("globs, placeholders and prose elisions are not paths", () => {
  for (const t of [
    "*.spec.ts",
    "spec/behavior/<topic>.md",
    "apps/api/.../sentry-scrubbing.ts",
    "YYYYMMDDHHMMSS_snake_case_name.sql",
    ".d.ts",
    "https://example.com/a.json",
  ]) {
    assert.equal(isNotAPath(t), true, t);
  }
});

test("the placeholder rule stays narrow enough to keep SCREAMING_SNAKE_CASE docs in scope", () => {
  // This repo names real docs in caps; suppressing them would silently gut the lint.
  for (const t of [
    "docs/internal/environment/ENV_REFERENCE.md",
    "docs/internal/ci-cd/GITHUB_PM.md",
    "AGENTS.md",
  ]) {
    assert.equal(isNotAPath(t), false, t);
  }
});

test("real paths are recognised as paths", () => {
  for (const t of ["apps/api/src/main.ts", "./scripts/setup.sh", "/.gitleaks.toml"]) {
    assert.equal(isNotAPath(t), false, t);
  }
});

// ── Normalisation ───────────────────────────────────────────────────────────

test("leading / and ./ both normalise to the repo-root form", () => {
  assert.equal(normalizeCitation("/.gitleaks.toml"), ".gitleaks.toml");
  assert.equal(normalizeCitation("./scripts/setup.sh"), "scripts/setup.sh");
  assert.equal(normalizeCitation("scripts/setup.sh"), "scripts/setup.sh");
});

// ── Extraction ──────────────────────────────────────────────────────────────

test("extraction dedupes within a file and keeps only path-shaped tokens", () => {
  const text = "`a/b.ts` and `a/b.ts` and `*.ts` and `npm run lint` and `c/d.sql`";
  assert.deepEqual(extractCitations(text), ["a/b.ts", "c/d.sql"]);
});

// ── Resolution ──────────────────────────────────────────────────────────────

const TRACKED = [
  "apps/api/src/main.ts",
  "docs/internal/environment/ENV_REFERENCE.md",
  "docs/guides/testing.md",
  "scripts/setup.sh",
  ".gitleaks.toml",
  "packages/ui/src/index.ts",
  "packages/hooks/src/index.ts",
];

test("a citation resolves against the repo root", () => {
  const { resolves } = makeResolver(TRACKED);
  assert.equal(resolves("apps/api/src/main.ts", "docs/guides/testing.md"), true);
});

test("a citation resolves relative to the citing file's own directory", () => {
  const { resolves } = makeResolver(["docs/guides/testing.md", "docs/guides/sibling.md"]);
  assert.equal(resolves("sibling.md", "docs/guides/testing.md"), true);
});

test("a bare filename resolves by trailing-segment match", () => {
  const { resolves } = makeResolver(TRACKED);
  assert.equal(resolves("main.ts", "docs/guides/testing.md"), true);
  assert.equal(resolves("src/main.ts", "docs/guides/testing.md"), true);
});

test("a moved doc no longer resolves at its old path", () => {
  const { resolves } = makeResolver(TRACKED);
  assert.equal(resolves("docs/internal/ENV_REFERENCE.md", "CONTRIBUTING.md"), false);
});

test("leading-slash and ./ citations resolve", () => {
  const { resolves } = makeResolver(TRACKED);
  assert.equal(resolves("/.gitleaks.toml", "docs/guides/testing.md"), true);
  assert.equal(resolves("./scripts/setup.sh", "docs/guides/testing.md"), true);
});

test("a move suggestion is offered only when exactly one file shares the basename", () => {
  const { suggestMove } = makeResolver(TRACKED);
  assert.equal(
    suggestMove("docs/internal/ENV_REFERENCE.md"),
    "docs/internal/environment/ENV_REFERENCE.md",
  );
  // Two index.ts files — an ambiguous guess would be worse than none.
  assert.equal(suggestMove("src/index.ts"), null);
  assert.equal(suggestMove("totally/unknown.ts"), null);
});

// ── Allowlist ───────────────────────────────────────────────────────────────

test("entries without a reason are rejected", () => {
  const errs = validateAllowlist({ paths: [{ path: "a/b.ts" }, { path: "c.ts", reason: "  " }] });
  assert.equal(errs.length, 2);
  assert.ok(errs[0].includes("reason"));
});

test("a perFile entry without a file is rejected", () => {
  const errs = validateAllowlist({ perFile: [{ path: "a/b.ts", reason: "ok" }] });
  assert.ok(errs.some((e) => e.includes('missing "file"')));
});

test("a valid allowlist produces no errors", () => {
  assert.deepEqual(
    validateAllowlist({
      prefixes: [{ prefix: "node_modules/", reason: "installed dependency" }],
      paths: [{ path: "dist/index.js", reason: "build output" }],
      perFile: [{ file: "AGENTS.md", path: "TECH-DEBT.md", reason: "must not exist" }],
    }),
    [],
  );
});

const ALLOWLIST = {
  prefixes: [{ prefix: "node_modules/", reason: "installed dependency" }],
  paths: [{ path: "dist/index.js", reason: "build output" }],
  perFile: [{ file: "spec/ui/mobile/screens.md", path: "(tabs)/chat.tsx", reason: "removals table" }],
};

test("prefix and global path entries match", () => {
  assert.equal(matchAllowlist(ALLOWLIST, "node_modules/next/dist/x.js", "AGENTS.md"), "prefixes[0]");
  assert.equal(matchAllowlist(ALLOWLIST, "dist/index.js", "docs/guides/testing.md"), "paths[0]");
});

test("perFile entries are scoped to their file", () => {
  // Deliberate in the removals table…
  assert.equal(
    matchAllowlist(ALLOWLIST, "(tabs)/chat.tsx", "spec/ui/mobile/screens.md"),
    "perFile[0]",
  );
  // …and still a genuine bug anywhere else. This scoping is the point.
  assert.equal(matchAllowlist(ALLOWLIST, "(tabs)/chat.tsx", "spec/ui/mobile/navigation.md"), null);
});

test("an unmatched citation is not excused", () => {
  assert.equal(matchAllowlist(ALLOWLIST, "some/other.ts", "AGENTS.md"), null);
});

test("entries that excused nothing are reported stale so the list self-cleans", () => {
  const stale = findStaleEntries(ALLOWLIST, new Set(["prefixes[0]"]));
  assert.equal(stale.length, 2);
  assert.ok(stale.some((s) => s.includes("dist/index.js")));
  assert.ok(stale.some((s) => s.includes("spec/ui/mobile/screens.md")));
});

test("a fully exercised allowlist reports nothing stale", () => {
  assert.deepEqual(
    findStaleEntries(ALLOWLIST, new Set(["prefixes[0]", "paths[0]", "perFile[0]"])),
    [],
  );
});
