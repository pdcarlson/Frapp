import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { INLINE_MAX_LINES, checkCommit, resolveScope, writeMarker } from "../../diff-review-scope.mjs";

// Each test builds a throwaway repo: `main` is the fork point, mirrored to refs/remotes/origin/main
// so the default baseRef resolves, and the feature branch adds commits on top.
function repo() {
  const dir = mkdtempSync(path.join(tmpdir(), "diff-review-scope-"));
  const git = (...args) => execFileSync("git", ["-C", dir, ...args], { encoding: "utf8" }).trim();
  git("init", "-q", "-b", "main");
  git("config", "user.email", "t@example.com");
  git("config", "user.name", "t");
  const commit = (file, body) => {
    mkdirSync(path.dirname(path.join(dir, file)), { recursive: true });
    writeFileSync(path.join(dir, file), body);
    git("add", "-A");
    git("commit", "-q", "-m", `edit ${file}`);
    return git("rev-parse", "HEAD");
  };
  // Lands a commit on main and publishes it as origin/main, leaving the feature branch checked out.
  const advanceMain = (file, body) => {
    git("checkout", "-q", "main");
    const sha = commit(file, body);
    git("update-ref", "refs/remotes/origin/main", sha);
    git("checkout", "-q", "feature");
    return sha;
  };
  const mark = (sha = git("rev-parse", "HEAD")) => {
    mkdirSync(path.join(dir, ".cache", "diff-review"), { recursive: true });
    writeFileSync(path.join(dir, ".cache", "diff-review", sha), "reviewed\n");
    return sha;
  };
  writeFileSync(path.join(dir, ".gitignore"), ".cache/\n"); // as in the real repo: markers are never committed
  const base = commit("README.md", "base\n");
  git("update-ref", "refs/remotes/origin/main", base);
  git("checkout", "-q", "-b", "feature");
  return { dir, git, commit, advanceMain, mark, base, cleanup: () => rmSync(dir, { recursive: true, force: true }) };
}

const lines = (n) => Array.from({ length: n }, (_, i) => `${i}\n`).join("");

test("a branch with no marker gets a full workflow review from its fork point", (t) => {
  const r = repo();
  t.after(r.cleanup);
  r.commit("a.txt", "1\n2\n3\n");
  const head = r.commit("b.txt", "x\n");
  const scope = resolveScope({ cwd: r.dir });
  assert.equal(scope.mode, "full");
  assert.equal(scope.review, "workflow");
  assert.equal(scope.base, r.base);
  assert.equal(scope.head, head);
  assert.equal(scope.reviewed, null);
  assert.equal(scope.files, 2);
  assert.equal(scope.changedLines, 4);
  assert.equal(scope.dirty, false);
});

test("a small fix after a review is an inline delta of just the new commits", (t) => {
  const r = repo();
  t.after(r.cleanup);
  r.commit("a.txt", "1\n");
  const reviewed = r.mark(r.commit("b.txt", "1\n2\n"));
  r.commit("a.txt", "1\nfix\n");
  const scope = resolveScope({ cwd: r.dir });
  assert.equal(scope.mode, "delta");
  assert.equal(scope.review, "inline");
  assert.equal(scope.base, reviewed);
  assert.equal(scope.reviewed, reviewed);
  assert.equal(scope.branchBase, r.base);
  assert.equal(scope.files, 1);
  assert.equal(scope.changedLines, 1);

  const fixed = r.mark();
  r.commit("b.txt", "1\n2\n3\n");
  assert.equal(resolveScope({ cwd: r.dir }).base, fixed, "the newest marker wins");
});

test(`a re-review of ${INLINE_MAX_LINES} lines or more goes back to the workflow`, (t) => {
  const r = repo();
  t.after(r.cleanup);
  r.mark(r.commit("a.txt", "1\n"));
  r.commit("big.txt", lines(INLINE_MAX_LINES - 1));
  assert.equal(resolveScope({ cwd: r.dir }).review, "inline");
  r.commit("big.txt", lines(INLINE_MAX_LINES));
  const scope = resolveScope({ cwd: r.dir });
  assert.equal(scope.mode, "delta");
  assert.equal(scope.review, "workflow");
});

test("generated files count as files but not toward changedLines", (t) => {
  const r = repo();
  t.after(r.cleanup);
  r.mark(r.commit("a.txt", "1\n"));
  r.commit("package-lock.json", lines(2000));
  r.commit("apps/api/openapi.json", lines(2000));
  r.commit("a.txt", "1\n2\n");
  const scope = resolveScope({ cwd: r.dir });
  assert.equal(scope.files, 3);
  assert.equal(scope.changedLines, 1);
  assert.equal(scope.review, "inline");
});

test("a marked HEAD needs no review, and --full overrides the marker", (t) => {
  const r = repo();
  t.after(r.cleanup);
  r.mark(r.commit("a.txt", "1\n"));
  assert.equal(resolveScope({ cwd: r.dir }).mode, "none");
  const scope = resolveScope({ cwd: r.dir, full: true });
  assert.equal(scope.mode, "full");
  assert.equal(scope.base, r.base);
});

test("a branch with no commits of its own is empty, and dirty tracks uncommitted edits", (t) => {
  const r = repo();
  t.after(r.cleanup);
  assert.equal(resolveScope({ cwd: r.dir }).mode, "empty");
  writeFileSync(path.join(r.dir, "README.md"), "changed\n");
  assert.equal(resolveScope({ cwd: r.dir }).dirty, true);
});

test("a clean merge of main after a review leaves nothing to review", (t) => {
  const r = repo();
  t.after(r.cleanup);
  r.mark(r.commit("a.txt", "1\n2\n3\n"));
  const newMain = r.advanceMain("m.txt", "main\n");
  r.git("merge", "-q", "--no-edit", "origin/main");
  const scope = resolveScope({ cwd: r.dir });
  assert.equal(scope.mode, "none");
  assert.equal(scope.branchBase, newMain);
});

test("after a clean merge, only the branch's own later change is reviewed", (t) => {
  const r = repo();
  t.after(r.cleanup);
  r.mark(r.commit("a.txt", "1\n2\n3\n"));
  r.advanceMain("m.txt", lines(500));
  r.git("merge", "-q", "--no-edit", "origin/main");
  r.commit("a.txt", "1\n2\nfix\n");
  const scope = resolveScope({ cwd: r.dir });
  assert.equal(scope.mode, "delta");
  assert.equal(scope.review, "inline");
  assert.equal(scope.files, 1, "main's 500-line file is not in the delta");
  assert.equal(scope.changedLines, 2);
  const diff = execFileSync("git", ["-C", r.dir, "diff", "--name-only", scope.base, scope.head], { encoding: "utf8" }).trim();
  assert.equal(diff, "a.txt", "base is a tree the reviewer can diff against");
});

test("an edit hidden inside a merge commit is still reviewed", (t) => {
  const r = repo();
  t.after(r.cleanup);
  r.mark(r.commit("a.txt", "1\n"));
  r.advanceMain("m.txt", "main\n");
  r.git("merge", "-q", "--no-commit", "origin/main");
  writeFileSync(path.join(r.dir, "a.txt"), "1\nsneaky\n");
  r.git("add", "-A");
  r.git("commit", "-q", "--no-edit");
  const scope = resolveScope({ cwd: r.dir });
  assert.equal(scope.mode, "delta");
  assert.equal(scope.files, 1);
  assert.equal(scope.changedLines, 1);
});

test("when the reviewed work conflicts with main, the whole branch is reviewed again", (t) => {
  const r = repo();
  t.after(r.cleanup);
  r.mark(r.commit("README.md", "branch\n"));
  const newMain = r.advanceMain("README.md", "main\n");
  assert.throws(() => r.git("merge", "-q", "--no-edit", "origin/main"));
  writeFileSync(path.join(r.dir, "README.md"), "resolved\n");
  r.git("add", "-A");
  r.git("commit", "-q", "--no-edit");
  const scope = resolveScope({ cwd: r.dir });
  assert.equal(scope.mode, "full");
  assert.equal(scope.base, newMain);
});

test("markers on commits outside <merge-base>..HEAD (a rebase) don't count", (t) => {
  const r = repo();
  t.after(r.cleanup);
  r.mark(r.commit("a.txt", "1\n"));
  const newMain = r.advanceMain("main.txt", "m\n");
  r.git("checkout", "-q", "-b", "rebased", "origin/main");
  r.commit("a.txt", "1\n");
  const scope = resolveScope({ cwd: r.dir });
  assert.equal(scope.mode, "full");
  assert.equal(scope.base, newMain);
});

test("writeMarker records HEAD", (t) => {
  const r = repo();
  t.after(r.cleanup);
  const head = r.commit("a.txt", "1\n");
  const file = writeMarker({ cwd: r.dir });
  assert.equal(path.basename(file), head);
  assert.equal(readFileSync(file, "utf8"), "reviewed\n");
  assert.equal(resolveScope({ cwd: r.dir }).mode, "none");
});

test("checkCommit passes commits on main and clean merges, and refuses unreviewed work", (t) => {
  const r = repo();
  t.after(r.cleanup);
  assert.equal(checkCommit({ cwd: r.dir, sha: r.base }).ok, true, "already on origin/main");

  const own = r.commit("a.txt", "1\n");
  assert.equal(checkCommit({ cwd: r.dir, sha: own }).ok, false, "a first review is owed");
  r.mark(own);

  r.advanceMain("m.txt", "main\n");
  r.git("merge", "-q", "--no-edit", "origin/main");
  const merge = r.git("rev-parse", "HEAD");
  assert.equal(checkCommit({ cwd: r.dir, sha: merge }).ok, true, "a clean merge of main carries the review");

  const fix = r.commit("a.txt", "1\n2\n");
  const verdict = checkCommit({ cwd: r.dir, sha: fix });
  assert.equal(verdict.ok, false);
  assert.match(verdict.reason, /1 file\(s\), 1 line\(s\) unreviewed/);
});
