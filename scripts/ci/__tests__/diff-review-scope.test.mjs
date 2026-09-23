import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { resolveScope, writeMarker } from "../../diff-review-scope.mjs";

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
  writeFileSync(path.join(dir, ".gitignore"), ".cache/\n"); // as in the real repo: markers are never committed
  const base = commit("README.md", "base\n");
  git("update-ref", "refs/remotes/origin/main", base);
  git("checkout", "-q", "-b", "feature");
  return { dir, git, commit, base, cleanup: () => rmSync(dir, { recursive: true, force: true }) };
}

const mark = (dir, sha, kind) => {
  mkdirSync(path.join(dir, ".cache", "diff-review"), { recursive: true });
  writeFileSync(path.join(dir, ".cache", "diff-review", sha), kind);
};

test("a branch with no markers gets a full review from its fork point", (t) => {
  const r = repo();
  t.after(r.cleanup);
  r.commit("a.txt", "1\n2\n3\n");
  const head = r.commit("b.txt", "x\n");
  const scope = resolveScope({ cwd: r.dir });
  assert.equal(scope.mode, "full");
  assert.equal(scope.base, r.base);
  assert.equal(scope.head, head);
  assert.equal(scope.files, 2);
  assert.equal(scope.changedLines, 4);
  assert.equal(scope.dirty, false);
});

test("commits after a full or delta marker get a delta review of just those commits", (t) => {
  const r = repo();
  t.after(r.cleanup);
  r.commit("a.txt", "1\n");
  const reviewed = r.commit("b.txt", "1\n2\n");
  mark(r.dir, reviewed, "full\n");
  r.commit("a.txt", "1\nfix\n");
  const scope = resolveScope({ cwd: r.dir });
  assert.equal(scope.mode, "delta");
  assert.equal(scope.base, reviewed);
  assert.equal(scope.branchBase, r.base);
  assert.equal(scope.files, 1);
  assert.equal(scope.changedLines, 1);

  const fixed = r.git("rev-parse", "HEAD");
  mark(r.dir, fixed, "delta\n");
  r.commit("b.txt", "1\n2\n3\n");
  assert.equal(resolveScope({ cwd: r.dir }).base, fixed, "a delta marker chains");
});

test("only full and delta markers count; other kinds and legacy empty markers don't", (t) => {
  const r = repo();
  t.after(r.cleanup);
  const first = r.commit("a.txt", "1\n");
  mark(r.dir, first, "target\n");
  const second = r.commit("b.txt", "1\n");
  mark(r.dir, second, "");
  r.commit("c.txt", "1\n");
  const scope = resolveScope({ cwd: r.dir });
  assert.equal(scope.mode, "full");
  assert.equal(scope.base, r.base);
});

test("markers on commits outside <merge-base>..HEAD (a rebase) don't count", (t) => {
  const r = repo();
  t.after(r.cleanup);
  const old = r.commit("a.txt", "1\n");
  mark(r.dir, old, "full\n");
  r.git("checkout", "-q", "main");
  const newMain = r.commit("main.txt", "m\n");
  r.git("update-ref", "refs/remotes/origin/main", newMain);
  r.git("checkout", "-q", "-b", "rebased");
  r.commit("a.txt", "1\n");
  const scope = resolveScope({ cwd: r.dir });
  assert.equal(scope.mode, "full");
  assert.equal(scope.base, newMain);
});

test("a marked HEAD needs no review, and --full overrides a marker", (t) => {
  const r = repo();
  t.after(r.cleanup);
  const head = r.commit("a.txt", "1\n");
  mark(r.dir, head, "full\n");
  assert.equal(resolveScope({ cwd: r.dir }).mode, "none");
  assert.equal(resolveScope({ cwd: r.dir, full: true }).mode, "full");
});

test("a branch with no commits of its own is empty, and dirty tracks uncommitted edits", (t) => {
  const r = repo();
  t.after(r.cleanup);
  assert.equal(resolveScope({ cwd: r.dir }).mode, "empty");
  writeFileSync(path.join(r.dir, "README.md"), "changed\n");
  assert.equal(resolveScope({ cwd: r.dir }).dirty, true);
});

test("writeMarker records the kind for HEAD and rejects anything else", (t) => {
  const r = repo();
  t.after(r.cleanup);
  const head = r.commit("a.txt", "1\n");
  const file = writeMarker({ cwd: r.dir, kind: "delta" });
  assert.equal(path.basename(file), head);
  assert.equal(readFileSync(file, "utf8"), "delta\n");
  assert.throws(() => writeMarker({ cwd: r.dir, kind: "" }), /marker kind/);
  assert.throws(() => writeMarker({ cwd: r.dir, kind: "skip" }), /marker kind/);
  assert.throws(() => writeMarker({ cwd: r.dir, kind: "target" }), /marker kind/, "a partial review is never push evidence");
});

test("a delta after merging main counts only the branch's own commits, and reports the merge", (t) => {
  const r = repo();
  t.after(r.cleanup);
  r.commit("shared.txt", "1\nbranch\n3\n4\n5\n");
  const reviewed = r.git("rev-parse", "HEAD");
  mark(r.dir, reviewed, "full\n");
  r.git("checkout", "-q", "main");
  r.commit("shared-main.txt", "main only\n");
  const newMain = r.commit("README.md", "base\nmain edit\n");
  r.git("update-ref", "refs/remotes/origin/main", newMain);
  r.git("checkout", "-q", "feature");
  r.git("merge", "-q", "--no-edit", "main");
  r.commit("fix.txt", "fix\n");
  const scope = resolveScope({ cwd: r.dir });
  assert.equal(scope.mode, "delta");
  assert.equal(scope.base, reviewed);
  assert.equal(scope.branchBase, newMain);
  assert.equal(scope.merges, 1);
  assert.equal(scope.files, 1, "main's files stay out of the fix round");
  assert.equal(scope.changedLines, 1);
});
