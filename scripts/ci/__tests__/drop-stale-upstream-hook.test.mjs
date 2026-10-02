import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

// Drives the REAL .claude/hooks/drop-stale-upstream.sh against scratch repos: a bare
// "GitHub" remote and a clone of it standing in for the session. The squash merge, the
// branch deletion and the session's `git checkout -B <branch> origin/main` are done for
// real, so each case ends in the exact state the hook has to judge.
//
// `unpushed()` is how Claude Code's Stop hook counts (its ~/.claude/stop-hook-git-check.sh:
// `origin/<branch>` when it resolves, else `origin/HEAD`, and 0 when the count fails). It
// is restated here, not imported, because that file is the harness's, not this repo's.

const REPO_ROOT = fileURLToPath(new URL("../../../", import.meta.url));
const HOOK = path.join(REPO_ROOT, ".claude/hooks/drop-stale-upstream.sh");

// Only the scratch repos' own config: a developer's global hooksPath or signing setup
// would otherwise run inside these repos.
const GIT_ENV = {
  ...process.env,
  GIT_CONFIG_GLOBAL: "/dev/null",
  GIT_CONFIG_NOSYSTEM: "1",
  GIT_AUTHOR_NAME: "t",
  GIT_AUTHOR_EMAIL: "t@example.com",
  GIT_COMMITTER_NAME: "t",
  GIT_COMMITTER_EMAIL: "t@example.com",
};

function git(cwd, ...args) {
  const r = spawnSync("git", args, { cwd, env: GIT_ENV, encoding: "utf8" });
  assert.equal(r.status, 0, `git ${args.join(" ")} failed: ${r.stderr}`);
  return r.stdout.trim();
}
const resolves = (cwd, ref) =>
  spawnSync("git", ["rev-parse", "-q", "--verify", ref], { cwd, env: GIT_ENV }).status === 0;

function commit(cwd, file, content) {
  writeFileSync(path.join(cwd, file), content);
  git(cwd, "add", file);
  git(cwd, "commit", "-q", "-m", `edit ${file}`);
}

/**
 * A session whose PR branch `claude/fix` was squash-merged on the remote and then
 * deleted there (unless `deleteRemote: false`), after which the session fetched main and
 * reset the branch to it. Main also gained `laterCommits` other commits after the merge.
 */
function mergedAndReset(t, { deleteRemote = true, laterCommits = 1 } = {}) {
  const dir = mkdtempSync(path.join(tmpdir(), "stale-upstream-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const remote = path.join(dir, "remote.git");
  const work = path.join(dir, "work");
  const other = path.join(dir, "other");

  git(dir, "init", "-q", "--bare", "-b", "main", remote);
  git(dir, "clone", "-q", remote, other);
  commit(other, "base.txt", "base\n");
  git(other, "push", "-q", "origin", "main");

  // The session clones one branch. The cloud sandbox's clone ends with no origin/HEAD,
  // which a plain clone would have set, so it is removed to match.
  git(dir, "clone", "-q", "--single-branch", "-b", "main", remote, work);
  if (resolves(work, "refs/remotes/origin/HEAD")) git(work, "symbolic-ref", "--delete", "refs/remotes/origin/HEAD");
  git(work, "config", "remote.origin.fetch", "+refs/heads/*:refs/remotes/origin/*");
  git(work, "checkout", "-q", "-b", "claude/fix");
  commit(work, "fix.txt", "fix\n");
  git(work, "push", "-q", "-u", "origin", "claude/fix");

  // Paul squash-merges on GitHub, which then deletes the branch.
  git(other, "fetch", "-q", "origin", "claude/fix");
  git(other, "merge", "-q", "--squash", "FETCH_HEAD");
  git(other, "commit", "-q", "-m", "fix (#1)");
  for (let i = 0; i < laterCommits; i++) commit(other, `later${i}.txt`, `${i}\n`);
  git(other, "push", "-q", "origin", "main");
  if (deleteRemote) git(other, "push", "-q", "origin", "--delete", "claude/fix");

  // The session's next.md Phase 4 reset.
  git(work, "fetch", "-q", "origin", "main");
  git(work, "checkout", "-q", "-B", "claude/fix", "origin/main");
  return work;
}

function unpushed(cwd) {
  const branch = git(cwd, "branch", "--show-current");
  const upstream = resolves(cwd, `origin/${branch}`) ? `origin/${branch}` : "origin/HEAD";
  const r = spawnSync("git", ["rev-list", `${upstream}..HEAD`, "--count"], { cwd, env: GIT_ENV, encoding: "utf8" });
  return r.status === 0 ? Number(r.stdout.trim()) : 0;
}

function runHook(cwd, command = "git checkout -B claude/fix origin/main") {
  const input = JSON.stringify({ hook_event_name: "PostToolUse", tool_name: "Bash", tool_input: { command }, cwd });
  return spawnSync("bash", [HOOK], { cwd, env: GIT_ENV, input, encoding: "utf8" });
}

test("the squash-merged, deleted branch: the stale ref goes and the Stop hook counts nothing", (t) => {
  const work = mergedAndReset(t, { laterCommits: 2 });
  assert.equal(unpushed(work), 3, "precondition: the squash commit and two later ones read as unpushed");

  const r = runHook(work);
  assert.equal(r.status, 0);
  assert.equal(resolves(work, "refs/remotes/origin/claude/fix"), false);
  assert.equal(unpushed(work), 0);

  const out = JSON.parse(r.stdout);
  assert.equal(out.hookSpecificOutput.hookEventName, "PostToolUse");
  assert.match(out.hookSpecificOutput.additionalContext, /origin\/claude\/fix/);
  assert.match(out.hookSpecificOutput.additionalContext, /3 commit/);
});

test("with origin/HEAD set to main, new work on the reset branch still reads as unpushed", (t) => {
  const work = mergedAndReset(t);
  runHook(work);
  assert.equal(git(work, "symbolic-ref", "refs/remotes/origin/HEAD"), "refs/remotes/origin/main");

  commit(work, "next.txt", "next\n");
  assert.equal(unpushed(work), 1);
});

test("an origin/HEAD that already exists is left as it is", (t) => {
  const work = mergedAndReset(t);
  // Any existing target will do; what matters is that the hook doesn't rewrite it.
  git(work, "fetch", "-q", "origin", "main:refs/remotes/origin/other");
  git(work, "symbolic-ref", "refs/remotes/origin/HEAD", "refs/remotes/origin/other");
  runHook(work);
  assert.equal(git(work, "symbolic-ref", "refs/remotes/origin/HEAD"), "refs/remotes/origin/other");
});

test("a branch that still exists on the remote keeps its tracking ref", (t) => {
  const work = mergedAndReset(t, { deleteRemote: false });
  const r = runHook(work);
  assert.equal(r.status, 0);
  assert.equal(r.stdout, "");
  assert.equal(resolves(work, "refs/remotes/origin/claude/fix"), true);
});

test("a commit of the session's own on top keeps the ref, so the Stop hook still asks for a push", (t) => {
  const work = mergedAndReset(t);
  commit(work, "mine.txt", "mine\n");
  runHook(work);
  assert.equal(resolves(work, "refs/remotes/origin/claude/fix"), true);
  assert.ok(unpushed(work) > 0);
});

test("a remote it can't reach proves nothing, so the ref stays", (t) => {
  const work = mergedAndReset(t);
  git(work, "remote", "set-url", "origin", path.join(work, "..", "nowhere.git"));
  const r = runHook(work);
  assert.equal(r.status, 0);
  assert.equal(resolves(work, "refs/remotes/origin/claude/fix"), true);
});

test("a Bash call that isn't about git does nothing", (t) => {
  const work = mergedAndReset(t);
  const input = JSON.stringify({ hook_event_name: "PostToolUse", tool_name: "Bash", tool_input: { command: "ls" }, cwd: work });
  const r = spawnSync("bash", [HOOK], { cwd: work, env: GIT_ENV, input, encoding: "utf8" });
  assert.equal(r.status, 0);
  assert.equal(resolves(work, "refs/remotes/origin/claude/fix"), true);
});

test("a detached HEAD, and a directory outside any repo, are no-ops", (t) => {
  const work = mergedAndReset(t);
  git(work, "checkout", "-q", "--detach");
  assert.equal(runHook(work).status, 0);
  assert.equal(resolves(work, "refs/remotes/origin/claude/fix"), true);

  const bare = mkdtempSync(path.join(tmpdir(), "stale-upstream-norepo-"));
  t.after(() => rmSync(bare, { recursive: true, force: true }));
  const r = spawnSync("bash", [HOOK], { cwd: bare, env: { ...GIT_ENV, GIT_CEILING_DIRECTORIES: path.dirname(bare) }, input: '{"tool_input":{"command":"git status"}}', encoding: "utf8" });
  assert.equal(r.status, 0);
  assert.equal(r.stdout, "");
});
