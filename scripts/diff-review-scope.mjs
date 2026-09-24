#!/usr/bin/env node
// Resolves /diff-review's scope to pinned SHAs, writes its gate marker, and tells the pre-push hook
// whether a commit carries anything nobody has reviewed.
//
//   node scripts/diff-review-scope.mjs [--full]       print the scope as one JSON line
//   node scripts/diff-review-scope.mjs --mark         write the marker for HEAD, once its review is done
//   node scripts/diff-review-scope.mjs --check <sha>  exit 0 when <sha> needs no review (.githooks/pre-push)
//
// What each scope means for the reviewer is in .claude/skills/diff-review/SKILL.md; this script
// only applies the rules. A branch is reviewed up to the newest commit R in <merge-base>..HEAD that
// has a marker. What is left is the difference between HEAD and R with the current main merged in
// cleanly (`git merge-tree`). So merging main adds nothing to review, while a fix commit, a conflict
// resolution or an edit hidden in a merge commit does. When R and main don't merge cleanly, or the
// branch has no marker (its first review, or after a rebase), the whole branch is reviewed.

import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

// A re-review this size or larger is new work, so it gets the workflow; below it, the agent
// reviews inline.
export const INLINE_MAX_LINES = 300;

// Regenerated wholesale by tooling; their churn says nothing about how much there is to review.
const GENERATED = new Set(["package-lock.json", "openapi.json"]);

function git(cwd, ...args) {
  return execFileSync("git", ["-C", cwd, ...args], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
}

function succeeds(cwd, ...args) {
  try {
    git(cwd, ...args);
    return true;
  } catch {
    return false;
  }
}

function markerPath(root, sha) {
  return path.join(root, ".cache", "diff-review", sha);
}

// Files, and insertions plus deletions outside the generated files.
function size(root, from, to) {
  let files = 0;
  let changedLines = 0;
  for (const row of git(root, "diff", "--numstat", "--no-renames", from, to).split("\n").filter(Boolean)) {
    const [added, deleted, file] = row.split("\t");
    files++;
    if (!GENERATED.has(path.basename(file))) changedLines += (Number(added) || 0) + (Number(deleted) || 0); // binary: "-"
  }
  return { files, changedLines };
}

// R with main merged in, as a tree: what HEAD would be if nothing but main had landed since R.
// Null when the two conflict.
function reviewedOnMain(root, reviewed, branchBase) {
  if (succeeds(root, "merge-base", "--is-ancestor", branchBase, reviewed)) return reviewed;
  try {
    return git(root, "merge-tree", "--write-tree", reviewed, branchBase).split("\n")[0];
  } catch {
    return null;
  }
}

export function resolveScope({ cwd = process.cwd(), full = false, head: headRef = "HEAD", baseRef = "origin/main" } = {}) {
  const root = git(cwd, "rev-parse", "--show-toplevel");
  const head = git(root, "rev-parse", `${headRef}^{commit}`);
  const branchBase = git(root, "merge-base", baseRef, head);
  const dirty = git(root, "status", "--porcelain", "--untracked-files=no") !== "";
  const reviewed = git(root, "rev-list", `${branchBase}..${head}`).split("\n").find((sha) => sha && existsSync(markerPath(root, sha))) ?? null;
  const scope = (mode, review, base, counts = { files: 0, changedLines: 0 }) => ({ mode, review, base, head, branchBase, reviewed, root, ...counts, dirty });

  if (head === branchBase) return scope("empty", null, head);
  if (reviewed === head && !full) return scope("none", null, head);
  const onMain = reviewed && !full ? reviewedOnMain(root, reviewed, branchBase) : null;
  if (!onMain) return scope("full", "workflow", branchBase, size(root, branchBase, head));
  if (succeeds(root, "diff", "--quiet", onMain, head)) return scope("none", null, head);
  const counts = size(root, onMain, head);
  return scope("delta", counts.changedLines >= INLINE_MAX_LINES ? "workflow" : "inline", onMain, counts);
}

export function writeMarker({ cwd = process.cwd() } = {}) {
  const root = git(cwd, "rev-parse", "--show-toplevel");
  const file = markerPath(root, git(root, "rev-parse", "HEAD"));
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, "reviewed\n");
  return file;
}

// The pre-push hook's fallback when <sha> has no marker of its own: a commit already on main, or
// one with nothing new since a reviewed commit but merges of main, publishes nothing unreviewed.
export function checkCommit({ cwd = process.cwd(), sha, baseRef = "origin/main" }) {
  const scope = resolveScope({ cwd, head: sha, baseRef });
  if (scope.mode === "empty") return { ok: true, reason: `already on ${baseRef}` };
  if (scope.mode === "none") return { ok: true, reason: `nothing but merges of ${baseRef} since reviewed ${scope.reviewed}` };
  return { ok: false, reason: `${scope.files} file(s), ${scope.changedLines} line(s) unreviewed (${scope.mode})` };
}

function main(argv) {
  if (argv.includes("--mark")) {
    console.log(writeMarker());
    return 0;
  }
  const checkAt = argv.indexOf("--check");
  if (checkAt !== -1) {
    const { ok, reason } = checkCommit({ sha: argv[checkAt + 1] });
    console.error(`review-gate: ${argv[checkAt + 1]}: ${reason}`);
    return ok ? 0 : 1;
  }
  console.log(JSON.stringify(resolveScope({ full: argv.includes("--full") })));
  return 0;
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  try {
    process.exit(main(process.argv.slice(2)));
  } catch (err) {
    console.error(`diff-review-scope: ${err.message}`);
    process.exit(1);
  }
}
