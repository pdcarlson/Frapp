import { test } from "node:test";
import assert from "node:assert/strict";

// check-docs-structure.mjs is a general-purpose script under scripts/ (a peer of
// the other check-*.mjs gates); its test lives here so the existing
// `test:ci-scripts` glob (scripts/ci/__tests__/*.test.mjs) runs it — hence the
// ../../ reach up.
import {
  bannedToRegExp,
  checkDirectories,
  checkTree,
  classifyPath,
  findStaleLegacy,
  getArg,
  inTree,
  isExempt,
  labelViolations,
} from "../../check-docs-structure.mjs";
import {
  BANNED,
  DIRECTORIES,
  EXEMPT_EXTENSIONS,
  LEGACY_NAMES,
  NAMING_PATTERN,
  ROOT_FILES,
} from "../../ci/lib/docs-structure.mjs";

// A deliberately tiny manifest. Every case below is framed as "a way the gate
// could pass while asserting nothing" — the failure mode the old version
// actually had, where it read only added paths and matched only tree roots.
const OPTS = {
  directories: [
    { dir: "docs/guides", purpose: "guides", index: true },
    { dir: "spec/behavior", purpose: "behavior", index: true },
    { dir: "spec/ui/design-system/reference", purpose: "exports", index: false },
  ],
  rootFiles: ["docs/README.md", "spec/README.md", "spec/engineering.md"],
  legacyNames: ["docs/guides/LEGACY_THING.md"],
  banned: [{ pattern: "docs/archive/", reason: "retired" }],
};

// ── Placement ───────────────────────────────────────────────────────────────

test("a file in a declared directory passes", () => {
  assert.deepEqual(classifyPath("docs/guides/testing.md", OPTS), []);
});

test("an undeclared directory fails — the old gate's central blind spot", () => {
  // /^spec\/[^/]+$/ matched only ROOT files, so `spec/invented/x.md` passed.
  const v = classifyPath("spec/invented/thing.md", OPTS);
  assert.equal(v.length, 1);
  assert.match(v[0], /not a declared documentation home/);
});

test("a nested undeclared directory under a declared parent still fails", () => {
  const v = classifyPath("spec/behavior/deeper/thing.md", OPTS);
  assert.match(v[0], /not a declared documentation home/);
});

test("a stray file at a tree root fails, and names what may sit there", () => {
  const v = classifyPath("spec/stray.md", OPTS);
  assert.equal(v.length, 1);
  assert.match(v[0], /spec\/README\.md, spec\/engineering\.md/);
});

test("the allowed root files pass", () => {
  for (const f of OPTS.rootFiles) assert.deepEqual(classifyPath(f, OPTS), []);
});

// ── Naming ──────────────────────────────────────────────────────────────────

test("SCREAMING_SNAKE_CASE fails unless grandfathered", () => {
  assert.match(classifyPath("docs/guides/NEW_THING.md", OPTS)[0], /filename must be/);
  assert.deepEqual(classifyPath("docs/guides/LEGACY_THING.md", OPTS), []);
});

test("the naming pattern accepts kebab and README and nothing else", () => {
  for (const ok of ["README.md", "a.md", "api-architecture.md", "db-rollback-2.md"]) {
    assert.equal(NAMING_PATTERN.test(ok), true, ok);
  }
  for (const bad of ["Thing.md", "thing_name.md", "THING.md", "-lead.md", "trail-.md", "a--b.md"]) {
    assert.equal(NAMING_PATTERN.test(bad), false, bad);
  }
});

test("a misplaced file is ALSO reported for its name, not just its directory", () => {
  // Reporting only the first problem sends a reviewer round the loop twice.
  const v = classifyPath("docs/invented/BAD_NAME.md", OPTS);
  assert.equal(v.length, 2);
});

test(".dc.html design exports are exempt from the naming rule", () => {
  assert.equal(isExempt("spec/ui/design-system/reference/canvas-screens.dc.html"), true);
  assert.deepEqual(
    classifyPath("spec/ui/design-system/reference/canvas-screens.dc.html", OPTS),
    [],
  );
});

// ── Banned paths ────────────────────────────────────────────────────────────

test("a banned prefix fails even inside a declared tree", () => {
  assert.match(classifyPath("docs/archive/old.md", OPTS)[0], /retired/);
});

test("the ** segment glob matches at any depth, and does not over-match", () => {
  const re = bannedToRegExp("spec/**/chunks/");
  assert.equal(re.test("spec/behavior/chunks/a.md"), true);
  assert.equal(re.test("spec/ui/design-system/chunks/a.md"), true);
  assert.equal(re.test("spec/chunksy/a.md"), false);
  assert.equal(re.test("docs/behavior/chunks/a.md"), false);
});

// ── The legacy ratchet ──────────────────────────────────────────────────────

test("a LEGACY_NAMES entry that matches nothing fails — the list can only shrink", () => {
  // This is what makes a rename self-checking: rename the file, and the gate
  // reds until the entry is deleted in the same commit.
  assert.deepEqual(findStaleLegacy(["docs/guides/testing.md"], ["docs/guides/GONE.md"]), [
    "docs/guides/GONE.md",
  ]);
  assert.deepEqual(findStaleLegacy(["docs/guides/GONE.md"], ["docs/guides/GONE.md"]), []);
});

// ── Directory invariants ────────────────────────────────────────────────────

test("a declared directory holding no file fails — no vacuous pass", () => {
  const { missing } = checkDirectories(["docs/guides/README.md"], OPTS.directories);
  assert.equal(missing.length, 2);
  assert.match(missing[0], /holds no tracked file/);
});

test("a directory declared with an index must carry README.md", () => {
  const tracked = [
    "docs/guides/README.md",
    "spec/behavior/tasks.md",
    "spec/ui/design-system/reference/x.dc.html",
  ];
  const { missingIndex } = checkDirectories(tracked, OPTS.directories);
  assert.deepEqual(missingIndex, ["spec/behavior/ — declared with an index but has no README.md"]);
});

// ── Scope ───────────────────────────────────────────────────────────────────

test("only docs/ and spec/ are in scope", () => {
  assert.equal(inTree("docs/README.md"), true);
  assert.equal(inTree("spec/README.md"), true);
  assert.equal(inTree("apps/api/src/main.ts"), false);
  assert.equal(inTree("AGENTS.md"), false);
  // Not a tree root, merely a prefix of one.
  assert.equal(inTree("docsite/x.md"), false);
});

test("checkTree ignores non-doc paths and counts what it checked", () => {
  const r = checkTree(["apps/api/src/main.ts", "docs/guides/README.md", "spec/behavior/README.md"], {
    ...OPTS,
    directories: [
      { dir: "docs/guides", purpose: "g", index: true },
      { dir: "spec/behavior", purpose: "b", index: true },
    ],
    legacyNames: [],
  });
  assert.equal(r.checked, 2);
  assert.deepEqual(r.violations, []);
  assert.deepEqual(r.missing, []);
});

test("an empty corpus makes EVERY directory look retired — main() guards on this", () => {
  // `git ls-files` is cwd-relative, so running the gate from a subdirectory
  // returns nothing and the manifest looks entirely stale. checkTree cannot tell
  // the difference, so main() checks `checked === 0` and reports where the
  // command was run rather than emitting a false "manifest is stale".
  const r = checkTree(["apps/api/src/main.ts"], OPTS);
  assert.equal(r.checked, 0);
  assert.equal(r.missing.length, OPTS.directories.length);
});

test("getArg reads the workflow's flag form", () => {
  assert.equal(getArg(["node", "s.mjs", "--base", "abc", "--head", "def"], "--base"), "abc");
  assert.equal(getArg(["node", "s.mjs"], "--base"), undefined);
});

// ── The real manifest ───────────────────────────────────────────────────────

test("the shipped manifest is internally coherent", () => {
  assert.ok(DIRECTORIES.length > 0);
  const dirs = DIRECTORIES.map((d) => d.dir);
  assert.equal(new Set(dirs).size, dirs.length, "duplicate directory entry");
  for (const d of DIRECTORIES) {
    assert.ok(d.dir.startsWith("docs/") || d.dir.startsWith("spec/"), d.dir);
    assert.ok(d.purpose && d.purpose.length > 0, `${d.dir} has no purpose`);
  }
  assert.equal(new Set(LEGACY_NAMES).size, LEGACY_NAMES.length, "duplicate legacy entry");
  for (const f of ROOT_FILES) assert.match(f, /^(docs|spec)\/[^/]+$/);
  for (const b of BANNED) assert.ok(b.reason && b.reason.length > 0, b.pattern);
});

test("every legacy entry is a real violation of the naming rule", () => {
  // An entry that would pass anyway is dead weight and hides a real rename.
  for (const p of LEGACY_NAMES) {
    const base = p.slice(p.lastIndexOf("/") + 1);
    assert.equal(NAMING_PATTERN.test(base), false, `${p} does not need grandfathering`);
  }
});

test("every legacy entry sits in a declared directory", () => {
  const dirs = new Set(DIRECTORIES.map((d) => d.dir));
  for (const p of LEGACY_NAMES) {
    assert.equal(dirs.has(p.slice(0, p.lastIndexOf("/"))), true, p);
  }
});

// ── Regressions found in review ─────────────────────────────────────────────

test("a non-Markdown file is told about the FILE TYPE, not the case convention", () => {
  // The two rules shared one message, so `board-export.png` was told its
  // filename "must be kebab-case `.md`" — a convention the name already
  // satisfies, and obeying it literally means renaming a PNG to Markdown.
  const v = classifyPath("spec/ui/design-system/reference/board-export.png", OPTS);
  assert.equal(v.length, 1);
  assert.match(v[0], /only Markdown belongs/);
  assert.match(v[0], /EXEMPT_EXTENSIONS/);
  assert.doesNotMatch(v[0], /kebab-case/);
});

test("a badly named .md file still gets the naming rule", () => {
  assert.match(classifyPath("docs/guides/BAD_NAME.md", OPTS)[0], /filename must be/);
});

test("a directory whose content is all in subdirectories is not 'empty'", () => {
  // Counting only DIRECT children broke the repo's own rule that a topic with
  // 2+ files becomes `<topic>/README.md`: fold the last direct file away and the
  // parent reds, with the only remedy being to undeclare a live directory.
  const dirs = [
    { dir: "spec/behavior", purpose: "b", index: false },
    { dir: "spec/behavior/chat", purpose: "c", index: true },
  ];
  const { missing } = checkDirectories(["spec/behavior/chat/README.md"], dirs);
  assert.deepEqual(missing, []);
});

test("a genuinely empty declared directory still fails, and says what to do", () => {
  const { missing } = checkDirectories(["docs/guides/README.md"], [
    { dir: "docs/guides", purpose: "g", index: true },
    { dir: "docs/gone", purpose: "x", index: false },
  ]);
  assert.equal(missing.length, 1);
  assert.match(missing[0], /drop the entry/);
});

test("checkTree forwards every field main() reads", () => {
  // Only checked/violations/missing were asserted, so renaming `missingIndex` or
  // `stale` in the return object passed the suite and crashed the binary.
  const r = checkTree(["docs/guides/tasks.md"], {
    ...OPTS,
    directories: [{ dir: "docs/guides", purpose: "g", index: true }],
    legacyNames: ["docs/guides/GONE.md"],
  });
  assert.deepEqual(Object.keys(r).sort(), [
    "checked",
    "missing",
    "missingIndex",
    "stale",
    "violations",
  ]);
  assert.deepEqual(r.stale, ["docs/guides/GONE.md"]);
  assert.equal(r.missingIndex.length, 1);
});

test("labelViolations tags only what this change introduced", () => {
  const vs = ["docs/a.md — bad", "docs/b.md — bad"];
  const out = labelViolations(vs, new Set(["docs/a.md"]));
  assert.match(out[0], /\[introduced by this change\]$/);
  assert.doesNotMatch(out[1], /introduced/);
  // No range passed: nothing is tagged, nothing is lost.
  assert.deepEqual(labelViolations(vs), vs);
});

test("every BANNED pattern is a directory prefix ending in /", () => {
  // bannedToRegExp anchors only at the start, so a pattern without the trailing
  // slash has no right boundary: `docs/**` would ban the whole tree.
  for (const b of BANNED) assert.equal(b.pattern.endsWith("/"), true, b.pattern);
});

test("EXEMPT_EXTENSIONS entries are real suffixes", () => {
  for (const e of EXEMPT_EXTENSIONS) assert.equal(e.startsWith("."), true, e);
});
