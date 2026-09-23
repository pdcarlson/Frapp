#!/usr/bin/env node
// Resolves /diff-review's scope to pinned SHAs, and writes its gate marker.
//
//   node scripts/diff-review-scope.mjs [--full]          print the scope as one JSON line
//   node scripts/diff-review-scope.mjs --mark <kind>     write the marker for HEAD (kind: full | delta)
//
// The rules live in .claude/skills/diff-review/SKILL.md (Phase 0 and Phase 4); this script only
// applies them. A branch counts as reviewed up to the newest commit in <merge-base>..HEAD whose
// marker says `full` or `delta`. Nothing else is trusted: not the upstream tip (a push can skip the
// hook), and not an empty marker from an older review. A delta covers only the branch's own commits
// since then (`head ^base ^branchBase`), so what a merge from main brought in stays out of scope.

import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

const MARK_KINDS = new Set(["full", "delta"]);

function git(cwd, ...args) {
  return execFileSync("git", ["-C", cwd, ...args], { encoding: "utf8" }).trim();
}

function lines(text) {
  return text ? text.split("\n").filter(Boolean) : [];
}

function markerDir(root) {
  return path.join(root, ".cache", "diff-review");
}

function markerKind(root, sha) {
  const file = path.join(markerDir(root), sha);
  return existsSync(file) ? readFileSync(file, "utf8").trim() : null;
}

// Files and insertions plus deletions in `git diff --numstat` or `git log --numstat` output.
function tally(numstat) {
  const files = new Set();
  let changed = 0;
  for (const row of lines(numstat)) {
    const [added, deleted, file] = row.split("\t");
    files.add(file);
    changed += (Number(added) || 0) + (Number(deleted) || 0); // binary files report "-"
  }
  return { files: files.size, changedLines: changed };
}

export function resolveScope({ cwd = process.cwd(), full = false, baseRef = "origin/main" } = {}) {
  const root = git(cwd, "rev-parse", "--show-toplevel");
  const head = git(root, "rev-parse", "HEAD");
  const branchBase = git(root, "merge-base", baseRef, "HEAD");
  const dirty = git(root, "status", "--porcelain", "--untracked-files=no") !== "";

  let reviewed = null;
  for (const sha of lines(git(root, "rev-list", `${branchBase}..HEAD`))) {
    if (MARK_KINDS.has(markerKind(root, sha))) {
      reviewed = sha;
      break;
    }
  }

  let mode;
  let base;
  if (head === branchBase) {
    mode = "empty";
    base = branchBase;
  } else if (full || !reviewed) {
    mode = "full";
    base = branchBase;
  } else if (reviewed === head) {
    mode = "none";
    base = head;
  } else {
    mode = "delta";
    base = reviewed;
  }

  let size = { files: 0, changedLines: 0 };
  let merges = 0;
  if (mode === "full") {
    size = tally(git(root, "diff", "--numstat", "--no-renames", base, head));
  } else if (mode === "delta") {
    const own = [head, `^${base}`, `^${branchBase}`];
    size = tally(git(root, "log", "--numstat", "--format=", "--no-merges", "--no-renames", ...own));
    merges = Number(git(root, "rev-list", "--count", "--merges", ...own));
  }

  return { mode, base, head, branchBase, root, ...size, merges, dirty };
}

export function writeMarker({ cwd = process.cwd(), kind }) {
  if (!MARK_KINDS.has(kind)) {
    throw new Error(`marker kind must be one of ${[...MARK_KINDS].join(", ")}; got ${JSON.stringify(kind)}`);
  }
  const root = git(cwd, "rev-parse", "--show-toplevel");
  const head = git(root, "rev-parse", "HEAD");
  mkdirSync(markerDir(root), { recursive: true });
  const file = path.join(markerDir(root), head);
  writeFileSync(file, `${kind}\n`);
  return file;
}

function main(argv) {
  const markAt = argv.indexOf("--mark");
  if (markAt !== -1) {
    console.log(writeMarker({ kind: argv[markAt + 1] }));
    return;
  }
  console.log(JSON.stringify(resolveScope({ full: argv.includes("--full") })));
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  try {
    main(process.argv.slice(2));
  } catch (err) {
    console.error(`diff-review-scope: ${err.message}`);
    process.exit(1);
  }
}
