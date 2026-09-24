import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, renameSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HOOK = fileURLToPath(new URL("../../../.githooks/pre-push", import.meta.url));
const SCOPE = fileURLToPath(new URL("../../diff-review-scope.mjs", import.meta.url));
let repo;
let head;
let tagObject;
const git = (...args) => execFileSync("git", ["-C", repo, ...args], { encoding: "utf8" }).trim();

before(() => {
  repo = mkdtempSync(path.join(tmpdir(), "review-gate-"));
  git("init", "-q");
  git("config", "user.email", "test@example.com");
  git("config", "user.name", "Test");
  writeFileSync(path.join(repo, "f.txt"), "hello\n");
  git("add", "-A");
  git("commit", "-qm", "init");
  head = git("rev-parse", "HEAD");
  git("tag", "-am", "release", "v1");
  tagObject = git("rev-parse", "v1");
  // The hook falls back to the checkout's own scope script. It stays untracked here, as .cache/ does.
  mkdirSync(path.join(repo, "scripts"));
  copyFileSync(SCOPE, path.join(repo, "scripts", "diff-review-scope.mjs"));
  writeFileSync(path.join(repo, ".git", "info", "exclude"), "scripts/\n.cache/\n");
});

after(() => rmSync(repo, { recursive: true, force: true }));

function run(lines) {
  return spawnSync("bash", [HOOK, "origin", "unused"], {
    cwd: repo,
    input: `${lines.join("\n")}\n`,
    encoding: "utf8",
  });
}

function mark(sha = head) {
  const dir = path.join(repo, ".cache", "diff-review");
  mkdirSync(dir, { recursive: true });
  writeFileSync(path.join(dir, sha), "reviewed\n");
}

function clear() {
  rmSync(path.join(repo, ".cache"), { recursive: true, force: true });
}

test("denies an unreviewed branch update with a nonzero exit", () => {
  clear();
  const result = run([`refs/heads/work ${head} refs/heads/work ${"0".repeat(40)}`]);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /no review evidence/);
  assert.match(result.stderr, /Retrying cannot create review evidence/);
});

test("retrying an unreviewed push never changes the verdict", () => {
  clear();
  for (let attempt = 0; attempt < 6; attempt += 1) assert.equal(run([`refs/heads/work ${head} refs/heads/work ${"0".repeat(40)}`]).status, 1);
});

test("allows the exact pushed commit when its marker exists", () => {
  clear();
  mark();
  assert.equal(run([`refs/heads/work ${head} refs/heads/work ${"0".repeat(40)}`]).status, 0);
});

test("one reviewed ref cannot mask another unreviewed ref in an atomic push", () => {
  clear();
  mark();
  writeFileSync(path.join(repo, "f.txt"), "next\n");
  execFileSync("git", ["-C", repo, "commit", "-qam", "next"]);
  const next = execFileSync("git", ["-C", repo, "rev-parse", "HEAD"], { encoding: "utf8" }).trim();
  assert.equal(run([
    `refs/heads/old ${head} refs/heads/old ${"0".repeat(40)}`,
    `refs/heads/new ${next} refs/heads/new ${"0".repeat(40)}`,
  ]).status, 1);
});

test("allows ref deletion because it publishes no object", () => {
  clear();
  assert.equal(run([`(delete) ${"0".repeat(40)} refs/heads/old ${head}`]).status, 0);
});

test("annotated tags use evidence for the peeled commit, not the tag object", () => {
  clear();
  mark(head);
  assert.notEqual(tagObject, head);
  assert.equal(run([`refs/tags/v1 ${tagObject} refs/tags/v1 ${"0".repeat(40)}`]).status, 0);
});

test("rejects a pushed object that cannot peel to a commit", () => {
  clear();
  const blob = execFileSync("git", ["-C", repo, "hash-object", "f.txt"], { encoding: "utf8" }).trim();
  assert.equal(run([`refs/tags/blob ${blob} refs/tags/blob ${"0".repeat(40)}`]).status, 1);
});

test("without a marker, a commit already on origin/main passes and new work is denied", () => {
  clear();
  git("update-ref", "refs/remotes/origin/main", head);
  try {
    assert.equal(run([`refs/tags/main-tip ${head} refs/tags/main-tip ${"0".repeat(40)}`]).status, 0);
    git("checkout", "-q", "-b", "feature");
    writeFileSync(path.join(repo, "f.txt"), "feature\n");
    git("commit", "-qam", "feature");
    const denied = run([`refs/heads/feature ${git("rev-parse", "HEAD")} refs/heads/feature ${"0".repeat(40)}`]);
    assert.equal(denied.status, 1);
    assert.match(denied.stderr, /unreviewed/);
  } finally {
    git("checkout", "-q", "-");
    git("update-ref", "-d", "refs/remotes/origin/main");
  }
});

test("a clean merge of main on top of a reviewed commit passes without a marker of its own", () => {
  clear();
  const start = git("rev-parse", "HEAD");
  git("checkout", "-q", "-b", "reviewed-branch");
  writeFileSync(path.join(repo, "branch.txt"), "branch\n");
  git("add", "branch.txt");
  git("commit", "-qm", "branch work");
  mark(git("rev-parse", "HEAD"));
  git("checkout", "-q", "-b", "newer-main", start);
  writeFileSync(path.join(repo, "main.txt"), "main\n");
  git("add", "main.txt");
  git("commit", "-qm", "main work");
  git("update-ref", "refs/remotes/origin/main", git("rev-parse", "HEAD"));
  git("checkout", "-q", "reviewed-branch");
  git("merge", "-q", "--no-edit", "newer-main");
  try {
    assert.equal(run([`refs/heads/reviewed-branch ${git("rev-parse", "HEAD")} refs/heads/reviewed-branch ${"0".repeat(40)}`]).status, 0);
  } finally {
    git("checkout", "-q", start);
    git("update-ref", "-d", "refs/remotes/origin/main");
  }
});

test("a check that can't run denies: no node on PATH, or no scope script", () => {
  clear();
  git("update-ref", "refs/remotes/origin/main", head);
  const bin = mkdtempSync(path.join(tmpdir(), "review-gate-bin-"));
  const script = path.join(repo, "scripts", "diff-review-scope.mjs");
  try {
    git("checkout", "-q", "-b", "no-node");
    writeFileSync(path.join(repo, "f.txt"), "no node\n");
    git("commit", "-qam", "no node");
    const update = [`refs/heads/no-node ${git("rev-parse", "HEAD")} refs/heads/no-node ${"0".repeat(40)}`];
    const bash = execFileSync("bash", ["-c", "command -v bash"], { encoding: "utf8" }).trim();
    symlinkSync(execFileSync("bash", ["-c", "command -v git"], { encoding: "utf8" }).trim(), path.join(bin, "git"));
    const noNode = spawnSync(bash, [HOOK, "origin", "unused"], {
      cwd: repo,
      input: `${update[0]}\n`,
      encoding: "utf8",
      env: { ...process.env, PATH: bin },
    });
    assert.equal(noNode.status, 1, noNode.stderr);
    assert.match(noNode.stderr, /no review evidence/);

    renameSync(script, `${script}.away`);
    assert.equal(run(update).status, 1);
  } finally {
    if (existsSync(`${script}.away`)) renameSync(`${script}.away`, script);
    rmSync(bin, { recursive: true, force: true });
    git("checkout", "-q", "-");
    git("update-ref", "-d", "refs/remotes/origin/main");
  }
});
