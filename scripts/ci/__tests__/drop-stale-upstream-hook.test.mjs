import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, utimesSync, writeFileSync } from "node:fs";
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
 * reset the branch to it (unless `reset: false`). Main also gained `laterCommits` other
 * commits after the merge. The bare remote is `remote.git` beside the returned clone.
 */
function mergedAndReset(t, { deleteRemote = true, laterCommits = 1, reset = true } = {}) {
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
  if (reset) git(work, "checkout", "-q", "-B", "claude/fix", "origin/main");
  return work;
}

function unpushed(cwd) {
  const branch = git(cwd, "branch", "--show-current");
  const upstream = resolves(cwd, `origin/${branch}`) ? `origin/${branch}` : "origin/HEAD";
  const r = spawnSync("git", ["rev-list", `${upstream}..HEAD`, "--count"], { cwd, env: GIT_ENV, encoding: "utf8" });
  return r.status === 0 ? Number(r.stdout.trim()) : 0;
}

function runHook(cwd, command = "git checkout -B claude/fix origin/main", stdout = "") {
  const input = JSON.stringify({
    hook_event_name: "PostToolUse",
    tool_name: "Bash",
    tool_input: { command },
    tool_response: { stdout, stderr: "" },
    cwd,
  });
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
  // It proves the branch is gone, not that its PR merged, and says only that.
  assert.match(out.hookSpecificOutput.additionalContext, /does not show whether/);
});

test("origin/HEAD is never created, so other never-pushed branches aren't affected", (t) => {
  const work = mergedAndReset(t);
  runHook(work);
  assert.equal(resolves(work, "refs/remotes/origin/HEAD"), false);
});

test("before the reset, while HEAD is still the old PR head, the ref stays", (t) => {
  // Fetched main, not yet reset: removing the ref now would make the PR's own commits,
  // which main holds only as a squash, read as unpushed against nothing.
  const work = mergedAndReset(t, { reset: false });
  runHook(work, "git fetch origin main");
  assert.equal(resolves(work, "refs/remotes/origin/claude/fix"), true);
});

test("a branch that still exists on the remote keeps its tracking ref", (t) => {
  const work = mergedAndReset(t, { deleteRemote: false });
  const r = runHook(work);
  assert.equal(r.status, 0);
  assert.equal(r.stdout, "");
  assert.equal(resolves(work, "refs/remotes/origin/claude/fix"), true);
});

test("'still on origin' is remembered for ten minutes, then asked again", (t) => {
  const work = mergedAndReset(t, { deleteRemote: false });
  runHook(work);
  const marker = path.join(work, ".git", "frapp-upstream-still-on-origin");
  assert.match(readFileSync(marker, "utf8"), /^claude\/fix [0-9a-f]{40}\n$/);

  // Deleted on origin now, but the remembered answer is fresh: no network call, ref kept.
  git(path.join(work, ".."), "--git-dir=remote.git", "update-ref", "-d", "refs/heads/claude/fix");
  runHook(work);
  assert.equal(resolves(work, "refs/remotes/origin/claude/fix"), true);

  const old = new Date(Date.now() - 11 * 60 * 1000);
  utimesSync(marker, old, old);
  runHook(work);
  assert.equal(resolves(work, "refs/remotes/origin/claude/fix"), false);
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

test("a Bash command that isn't git does nothing, even when its output mentions git", (t) => {
  const work = mergedAndReset(t);
  const r = runHook(work, "ls -a", ".github\n.gitignore\n");
  assert.equal(r.status, 0);
  assert.equal(resolves(work, "refs/remotes/origin/claude/fix"), true);
});

test("a git command after other shell, with quotes before it, still counts", (t) => {
  const work = mergedAndReset(t);
  runHook(work, 'echo "resetting" && cd . && git checkout -B claude/fix origin/main');
  assert.equal(resolves(work, "refs/remotes/origin/claude/fix"), false);
});

test("settings.json runs the hook after every Bash call", () => {
  const settings = JSON.parse(readFileSync(path.join(REPO_ROOT, ".claude/settings.json"), "utf8"));
  const commands = (settings.hooks.PostToolUse ?? [])
    .filter((entry) => entry.matcher === "Bash")
    .flatMap((entry) => entry.hooks.map((h) => h.command));
  assert.ok(commands.includes("$CLAUDE_PROJECT_DIR/.claude/hooks/drop-stale-upstream.sh"), JSON.stringify(commands));
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
