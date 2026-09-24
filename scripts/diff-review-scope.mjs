#!/usr/bin/env node
// Resolves /diff-review's scope to pinned SHAs, writes its gate marker, and tells the pre-push hook
// whether a commit carries anything nobody has reviewed.
//
//   node scripts/diff-review-scope.mjs [--full]       print the scope as one JSON line
//   node scripts/diff-review-scope.mjs --mark         write the marker for HEAD, once its review is done
//   node scripts/diff-review-scope.mjs --check <sha>  exit 0 when <sha> needs no review (.githooks/pre-push)
//
// What each scope means for the reviewer is in .claude/skills/diff-review/SKILL.md; this script
// only applies the rules. A branch is reviewed up to the newest marked commit R on its own
// first-parent line since it left main. What is left is the difference between HEAD and R with the
// current main merged in cleanly (`git merge-tree`). So merging main adds nothing to review, while a
// fix commit or an edit hidden in a merge commit does. A branch with no marked commit (its first
// review, or after a rebase) is reviewed whole, and so is one whose reviewed work conflicts with main:
// a resolution can leave no trace in any diff (keep main's side of a modify/delete conflict, and
// merge-tree's tree already holds that file, with no markers).

import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

// A re-review this size or larger is new work, so it gets the workflow; below it, the agent
// reviews inline.
export const INLINE_MAX_LINES = 300;

// Spelled out because a local branch or tag named `origin/main` would otherwise win the lookup.
const MAIN = "refs/remotes/origin/main";

// Regenerated wholesale by tooling; their churn says nothing about how much there is to review.
const GENERATED = new Set(["package-lock.json", "openapi.json"]);

// What --mark writes. `full` and `delta` are what the 2026-09-23 script wrote for the same kind of
// review. Empty markers predate both and were written by `touch`, after reviews that could have
// covered only part of the branch, so they are not evidence of one.
const TRUSTED = new Set(["reviewed", "full", "delta"]);

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

function trusted(root, sha) {
  const file = markerPath(root, sha);
  return existsSync(file) && TRUSTED.has(readFileSync(file, "utf8").trim());
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
  } catch (err) {
    if (err.status === 1) return null; // conflicts
    throw new Error(`git merge-tree --write-tree failed (it needs git 2.38 or newer; pass --full to review the whole branch): ${String(err.stderr).trim()}`);
  }
}

export function resolveScope({ cwd = process.cwd(), full = false, head: headRef = "HEAD", baseRef = MAIN } = {}) {
  const root = git(cwd, "rev-parse", "--show-toplevel");
  const head = git(root, "rev-parse", "--verify", `${headRef}^{commit}`);
  const branchBase = git(root, "merge-base", baseRef, head);
  const dirty = git(root, "status", "--porcelain", "--untracked-files=no") !== "";
  // First parents only: a marker on another branch merged in reviewed that branch, not this one.
  const reviewed = git(root, "rev-list", "--first-parent", `${branchBase}..${head}`).split("\n").find((sha) => sha && trusted(root, sha)) ?? null;
  const scope = (mode, review, base, counts = { files: 0, changedLines: 0 }) => ({ mode, review, base, head, branchBase, reviewed, root, ...counts, dirty });

  if (head === branchBase) return scope("empty", null, head);
  if (reviewed === head && !full) return scope("none", null, head);
  const base = reviewed && !full ? reviewedOnMain(root, reviewed, branchBase) : null;
  if (!base) return scope("full", "workflow", branchBase, size(root, branchBase, head));
  if (succeeds(root, "diff", "--quiet", base, head)) return scope("none", null, head);
  const counts = size(root, base, head);
  return scope("delta", counts.changedLines >= INLINE_MAX_LINES ? "workflow" : "inline", base, counts);
}

export function writeMarker({ cwd = process.cwd() } = {}) {
  const root = git(cwd, "rev-parse", "--show-toplevel");
  const file = markerPath(root, git(root, "rev-parse", "HEAD"));
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, "reviewed\n");
  return file;
}

// The pre-push hook's question for each pushed tip. It passes a commit this review marked, one
// already on main, and one with nothing new since a reviewed commit but clean merges of main.
export function checkCommit({ cwd = process.cwd(), sha, baseRef = MAIN }) {
  if (!sha) throw new Error("--check needs the SHA of the commit being pushed");
  const root = git(cwd, "rev-parse", "--show-toplevel");
  if (trusted(root, git(root, "rev-parse", "--verify", `${sha}^{commit}`))) return { ok: true, reason: "reviewed" };
  const scope = resolveScope({ cwd, head: sha, baseRef });
  if (scope.mode === "empty") return { ok: true, reason: `already on ${baseRef}` };
  if (scope.mode === "none") return { ok: true, reason: `nothing but clean merges of ${baseRef} since reviewed ${scope.reviewed}` };
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
