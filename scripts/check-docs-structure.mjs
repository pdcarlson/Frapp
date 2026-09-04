#!/usr/bin/env node

// Structure lint for docs/ and spec/. Runs alongside check-doc-paths.mjs.
//
// WHOLE-TREE, not diff-scoped. The previous version looked only at paths a PR
// ADDED or renamed (`--diff-filter=AR`), which meant it could never notice a
// file that was already in the wrong place, and its `spec/` rule matched only
// root-level paths — so inventing a new `spec/` subfolder passed. `docs/hooks/`
// and `docs/performance/` reached main that way, unlisted in the placement map
// the script's own comment pointed at.
//
// It now enforces `scripts/ci/lib/docs-structure.mjs` — the placement map as
// data — over every tracked file under docs/ and spec/. That is what makes a
// restructure self-checking: a move to an undeclared home, or to a name that
// breaks the convention, fails here rather than being discovered later by a
// reader who followed a dead link.
//
// See docs/internal/DOCUMENTATION_CONVENTIONS.md for the placement map, and
// docs/internal/ci-cd/DOCS_CI.md for how this fits the other docs gates.

import { execSync } from "node:child_process";
import path from "node:path";
import { pathToFileURL } from "node:url";

import {
  BANNED,
  DIRECTORIES,
  EXEMPT_EXTENSIONS,
  LEGACY_NAMES,
  NAMING_PATTERN,
  NAMING_RULE,
  ROOT_FILES,
} from "./ci/lib/docs-structure.mjs";

export const TREE_ROOTS = ["docs", "spec"];

export function getArg(argv, name) {
  const idx = argv.indexOf(name);
  if (idx === -1) return undefined;
  return argv[idx + 1];
}

// A banned pattern into a regex. Only a leading-segment glob and `*` are
// meaningful; the patterns are directory prefixes, not a general glob language.
export function bannedToRegExp(pattern) {
  const escape = (seg) => seg.replace(/[.+^${}()|[\]\\]/g, "\\$&").replace(/\*/g, "[^/]*");
  const segments = pattern.split("**/").map(escape);
  return new RegExp("^" + segments.join("(?:[^/]+/)*"));
}

export function isExempt(p) {
  return EXEMPT_EXTENSIONS.some((ext) => p.endsWith(ext));
}

export function inTree(p) {
  return TREE_ROOTS.some((r) => p.startsWith(r + "/"));
}

// The single per-path rule set. Returns an array of violation strings; empty
// means the path is fine. A path can break more than one rule and we report all
// of them — a reviewer fixing a misplaced file usually has to rename it too.
export function classifyPath(p, opts = {}) {
  const directories = opts.directories ?? DIRECTORIES;
  const rootFiles = opts.rootFiles ?? ROOT_FILES;
  const legacy = new Set(opts.legacyNames ?? LEGACY_NAMES);
  const banned = opts.banned ?? BANNED;

  const violations = [];

  for (const b of banned) {
    if (bannedToRegExp(b.pattern).test(p)) violations.push(`${p} — ${b.reason}`);
  }

  const dir = path.posix.dirname(p);
  const base = path.posix.basename(p);

  // A file sitting directly at `docs/` or `spec/`.
  if (TREE_ROOTS.includes(dir)) {
    if (!rootFiles.includes(p)) {
      const allowed = rootFiles.filter((f) => f.startsWith(dir + "/")).join(", ");
      violations.push(
        `${p} — new file at ${dir}/ root; only ${allowed} may sit there (hard rule 1)`,
      );
    }
    return violations;
  }

  const known = directories.some((d) => d.dir === dir);
  if (!known) {
    violations.push(
      `${p} — '${dir}/' is not a declared documentation home; add it to DIRECTORIES in scripts/ci/lib/docs-structure.mjs, to the placement map, and to the index README of its parent (see INDEX_DOCS in scripts/check-doc-tables.mjs), or move the file (hard rule 1)`,
    );
    // Naming is still worth reporting, so fall through rather than returning.
  }

  if (!isExempt(p) && !legacy.has(p)) {
    if (!base.endsWith(".md")) {
      // Separated from the naming rule on purpose: telling the author of
      // `board-export.png` that the filename "must be kebab-case `.md`" names a
      // convention the name already satisfies, and the only way to obey it is to
      // rename a PNG to Markdown. The real objection is the file type, and the
      // knob is EXEMPT_EXTENSIONS.
      violations.push(
        `${p} — only Markdown belongs under docs/ and spec/ (plus ${EXEMPT_EXTENSIONS.join(", ")}); ` +
          `if this file type should live here, add its extension to EXEMPT_EXTENSIONS in scripts/ci/lib/docs-structure.mjs`,
      );
    } else if (!NAMING_PATTERN.test(base)) {
      violations.push(`${p} — filename must be ${NAMING_RULE}`);
    }
  }

  return violations;
}

// Legacy entries that no longer match a tracked file. This is the ratchet: the
// list can only shrink, because a rename must delete its entry in the same
// commit or the gate reds.
export function findStaleLegacy(trackedPaths, legacyNames = LEGACY_NAMES) {
  const tracked = new Set(trackedPaths);
  return legacyNames.filter((p) => !tracked.has(p));
}

// Declared directories that hold no tracked file, and directories that owe a
// README.md and lack one. The first is the same anti-vacuous-pass guard
// check-env-slugs.mjs puts on SCAN_ROOTS: a manifest entry matching nothing is
// either a typo or a deletion nobody finished.
export function checkDirectories(trackedPaths, directories = DIRECTORIES) {
  const tracked = new Set(trackedPaths);
  // Nested content counts. Counting only DIRECT children made a parent whose
  // files had all been foldered read as empty — reachable by following this
  // repo's own rule that a topic with 2+ files becomes `<topic>/README.md`, and
  // the only way to satisfy the resulting error would be to undeclare a
  // directory that is plainly still in use.
  const holdsSomething = (dir) =>
    trackedPaths.some((p) => p.startsWith(dir + "/"));

  const missing = [];
  const missingIndex = [];
  for (const d of directories) {
    if (!holdsSomething(d.dir)) {
      missing.push(
        `${d.dir}/ — declared in DIRECTORIES but holds no tracked file; ` +
          `if this change removed its last file, drop the entry from scripts/ci/lib/docs-structure.mjs, the placement map, and its parent's index README (see INDEX_DOCS in scripts/check-doc-tables.mjs)`,
      );
      continue;
    }
    if (d.index && !tracked.has(`${d.dir}/README.md`)) {
      missingIndex.push(`${d.dir}/ — declared with an index but has no README.md`);
    }
  }
  return { missing, missingIndex };
}

/**
 * Tag the violations this change introduced.
 *
 * Pure, and exported, because the `--base`/`--head` flags now have no other
 * purpose — they stopped scoping the check — and the tag is recovered by
 * re-splitting the violation string on the em dash the messages are built with.
 * Left inside main() that coupling was untestable: change the separator and
 * every label silently disappears with the suite green.
 */
export function labelViolations(violations, introduced = new Set()) {
  return violations.map((v) => {
    const p = v.split(" — ")[0];
    return introduced.has(p) ? `${v}  [introduced by this change]` : v;
  });
}

export function checkTree(trackedPaths, opts = {}) {
  const docs = trackedPaths.filter(inTree);
  const violations = [];
  for (const p of docs) violations.push(...classifyPath(p, opts));
  const stale = findStaleLegacy(docs, opts.legacyNames);
  const { missing, missingIndex } = checkDirectories(docs, opts.directories);
  return { violations, stale, missing, missingIndex, checked: docs.length };
}

function git(cmd) {
  return execSync(`git ${cmd}`, { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 }).trim();
}

function main(argv = process.argv) {
  // -z, like the sibling gates: with core.quotePath on (the default) a plain
  // `ls-files` emits a non-ASCII path as `"docs/guides/BAD_NAM\303\211.md"`,
  // quotes included. inTree() then sees a leading `"`, skips the file, and its
  // directory reports as empty — a naming violation missed AND a false "manifest
  // is stale". Not trimming per path matters for the same reason.
  const tracked = git("ls-files -z").split("\0").filter(Boolean);

  // --base/--head stay supported so the workflow keeps one invocation, but they
  // no longer scope the check. They only label which violations this change
  // caused, which is the difference between "fix your change" and "you
  // inherited this".
  const base = getArg(argv, "--base");
  const head = getArg(argv, "--head");
  let introduced = new Set();
  if (base && head) {
    try {
      introduced = new Set(
        git(`diff --name-only --diff-filter=AR ${base}...${head}`)
          .split("\n")
          .map((s) => s.trim())
          .filter(Boolean),
      );
    } catch {
      // A missing ref is not this gate's problem; the whole-tree check still runs.
    }
  }

  const { violations, stale, missing, missingIndex, checked } = checkTree(tracked);

  // `git ls-files` is relative to the cwd, so running this from a subdirectory
  // returns none of the corpus and every declared directory looks retired. That
  // reads as an actionable "the manifest is stale" when the real problem is
  // where the command was run — say so instead of sending someone to edit data
  // that is fine.
  if (checked === 0) {
    console.error(
      "check-docs-structure: no tracked files under docs/ or spec/ — run it from the repo root",
    );
    console.error("(`npm run check:docs-structure` does this for you).");
    return 2;
  }

  if (violations.length || stale.length || missing.length || missingIndex.length) {
    console.error("Docs/spec structure check failed.");
    console.error("");
    if (violations.length) {
      console.error("These paths are not allowed by the structure rules:");
      for (const v of labelViolations(violations, introduced)) console.error(`- ${v}`);
      console.error("");
    }
    if (missing.length) {
      console.error("These declared directories match nothing — the manifest is stale:");
      for (const m of missing) console.error(`- ${m}`);
      console.error("");
    }
    if (missingIndex.length) {
      console.error("These directories owe a README.md:");
      for (const m of missingIndex) console.error(`- ${m}`);
      console.error("");
    }
    if (stale.length) {
      console.error("These LEGACY_NAMES entries no longer match a tracked file — delete them:");
      for (const s of stale) console.error(`- ${s}`);
      console.error("");
    }
    console.error(
      "Fix: place the change in its canonical home per docs/internal/DOCUMENTATION_CONVENTIONS.md,",
    );
    console.error(
      "or update scripts/ci/lib/docs-structure.mjs if the structure itself is meant to change.",
    );
    console.error("Run locally: `npm run check:docs-structure`.");
    return 1;
  }

  console.log(
    `Docs/spec structure check passed (${checked} files across ${DIRECTORIES.length} declared directories).`,
  );
  return 0;
}

const isEntry = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isEntry) process.exit(main());
