// scripts/merge-main.mjs (`npm run merge:main`), run against a throwaway git
// repository with a bare origin. Regeneration is stubbed with a function that
// derives the "contract" from the files in src/, which is all the script needs
// to tell a fresh export from either side's stale one.
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import { CONTRACT_ARTIFACTS } from "../../check-api-contract-drift.mjs";
import { mergeMain, partitionConflicts } from "../../merge-main.mjs";

const [OPENAPI, TYPES] = CONTRACT_ARTIFACTS;

function git(cwd, ...args) {
  return execFileSync("git", args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
}

function write(cwd, file, text) {
  mkdirSync(dirname(join(cwd, file)), { recursive: true });
  writeFileSync(join(cwd, file), text);
}

/** The stub generator: one line per endpoint file in src/, as an export would list them. */
function regenerateIn(cwd) {
  const endpoints = readdirSync(join(cwd, "src")).sort();
  write(cwd, OPENAPI, `${JSON.stringify({ paths: endpoints }, null, 2)}\n`);
  write(cwd, TYPES, endpoints.map((e) => `export type ${e.replace(".txt", "")} = unknown;`).join("\n") + "\n");
}

function commitAll(cwd, message) {
  git(cwd, "add", "-A");
  git(cwd, "commit", "-q", "-m", message);
}

/** A bare origin with main, and a clone on `feature` branched from it. */
function setup(t) {
  const root = mkdtempSync(join(tmpdir(), "merge-main-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const origin = join(root, "origin.git");
  const work = join(root, "work");
  const seed = join(root, "seed");
  git(root, "init", "-q", "--bare", "-b", "main", origin);
  git(root, "init", "-q", "-b", "main", seed);
  configure(seed);
  write(seed, "src/health.txt", "health\n");
  write(seed, "README.md", "one\ntwo\nthree\n");
  regenerateIn(seed);
  commitAll(seed, "seed");
  git(seed, "remote", "add", "origin", origin);
  git(seed, "push", "-q", "origin", "main");
  git(root, "clone", "-q", origin, work);
  configure(work);
  git(work, "checkout", "-q", "-b", "feature");
  return { seed, work };
}

function configure(repo) {
  git(repo, "config", "user.name", "Test");
  git(repo, "config", "user.email", "test@example.com");
  git(repo, "config", "commit.gpgsign", "false");
  git(repo, "config", "core.hooksPath", "/dev/null");
}

/** Lands a commit on origin/main from the seed clone. */
function landOnMain(seed, edit, message) {
  git(seed, "pull", "-q", "origin", "main");
  edit(seed);
  commitAll(seed, message);
  git(seed, "push", "-q", "origin", "main");
}

function run(work, overrides = {}) {
  const calls = { regenerate: 0, renumber: 0 };
  const output = [];
  const outcome = mergeMain({
    cwd: work,
    regenerate: () => {
      calls.regenerate += 1;
      regenerateIn(work);
    },
    renumber: () => {
      calls.renumber += 1;
    },
    log: (line) => output.push(line),
    ...overrides,
  });
  return { outcome, calls, output: output.join("\n") };
}

function inMerge(work) {
  try {
    git(work, "rev-parse", "-q", "--verify", "MERGE_HEAD");
    return true;
  } catch {
    return false;
  }
}

const addEndpoint = (name) => (cwd) => {
  write(cwd, `src/${name}.txt`, `${name}\n`);
  regenerateIn(cwd);
};

test("partitionConflicts separates the generated contract from the rest", () => {
  assert.deepEqual(partitionConflicts([OPENAPI, "apps/api/src/a.ts", TYPES]), {
    generated: [OPENAPI, TYPES],
    other: ["apps/api/src/a.ts"],
  });
});

test("a conflict only in the generated contract is regenerated and committed", (t) => {
  const { seed, work } = setup(t);
  landOnMain(seed, addEndpoint("events"), "main adds events");
  addEndpoint("tasks")(work);
  commitAll(work, "branch adds tasks");

  const { outcome, calls } = run(work);

  assert.equal(outcome, "merged");
  assert.equal(inMerge(work), false);
  assert.equal(git(work, "status", "--porcelain"), "");
  assert.equal(git(work, "rev-list", "--parents", "-n", "1", "HEAD").split(" ").length, 3);
  assert.deepEqual(JSON.parse(readFileSync(join(work, OPENAPI), "utf8")).paths, [
    "events.txt",
    "health.txt",
    "tasks.txt",
  ]);
  assert.doesNotMatch(readFileSync(join(work, TYPES), "utf8"), /<<<<<<<|>>>>>>>/);
  assert.deepEqual(calls, { regenerate: 1, renumber: 1 });
});

test("another conflict stops the merge, and --continue regenerates once it's resolved", (t) => {
  const { seed, work } = setup(t);
  landOnMain(
    seed,
    (cwd) => {
      addEndpoint("events")(cwd);
      write(cwd, "README.md", "one\nmain\nthree\n");
    },
    "main",
  );
  addEndpoint("tasks")(work);
  write(work, "README.md", "one\nbranch\nthree\n");
  commitAll(work, "branch");

  const first = run(work);
  assert.equal(first.outcome, "conflicts");
  assert.match(first.output, /README\.md/);
  assert.match(first.output, /--continue/);
  assert.equal(first.calls.regenerate, 0);
  assert.equal(inMerge(work), true);
  // The generated files are resolved (main's side) and staged; only README is left.
  assert.deepEqual(
    git(work, "diff", "--name-only", "--diff-filter=U").split("\n").filter(Boolean),
    ["README.md"],
  );

  const early = run(work, { resume: true });
  assert.equal(early.outcome, "conflicts");
  assert.equal(inMerge(work), true);

  write(work, "README.md", "one\nmain\nbranch\nthree\n");
  git(work, "add", "README.md");
  const done = run(work, { resume: true });

  assert.equal(done.outcome, "merged");
  assert.equal(inMerge(work), false);
  assert.deepEqual(done.calls, { regenerate: 1, renumber: 1 });
  assert.deepEqual(JSON.parse(readFileSync(join(work, OPENAPI), "utf8")).paths, [
    "events.txt",
    "health.txt",
    "tasks.txt",
  ]);
});

test("a clean merge where only main changed the contract does not regenerate", (t) => {
  const { seed, work } = setup(t);
  landOnMain(seed, addEndpoint("events"), "main adds events");
  write(work, "notes.txt", "branch work\n");
  commitAll(work, "branch, no API change");

  const { outcome, calls } = run(work);

  assert.equal(outcome, "merged");
  assert.equal(inMerge(work), false);
  assert.deepEqual(calls, { regenerate: 0, renumber: 1 });
});

test("a failed regeneration leaves the merge in progress for --continue", (t) => {
  const { seed, work } = setup(t);
  landOnMain(seed, addEndpoint("events"), "main adds events");
  addEndpoint("tasks")(work);
  commitAll(work, "branch adds tasks");

  const failed = run(work, {
    regenerate: () => {
      throw new Error("TS2304: Cannot find name 'Foo'");
    },
  });
  assert.equal(failed.outcome, "regenerate-failed");
  assert.match(failed.output, /TS2304/);
  assert.equal(inMerge(work), true);
  assert.equal(failed.calls.renumber, 0);

  const done = run(work, { resume: true });
  assert.equal(done.outcome, "merged");
  assert.equal(inMerge(work), false);
});

test("an up-to-date branch is left alone", (t) => {
  const { work } = setup(t);
  const { outcome, calls } = run(work);
  assert.equal(outcome, "up-to-date");
  assert.deepEqual(calls, { regenerate: 0, renumber: 0 });
});

test("a branch with no commits of its own fast-forwards", (t) => {
  const { seed, work } = setup(t);
  landOnMain(seed, addEndpoint("events"), "main adds events");
  const { outcome, calls } = run(work);
  assert.equal(outcome, "fast-forward");
  assert.equal(git(work, "rev-parse", "HEAD"), git(work, "rev-parse", "origin/main"));
  assert.deepEqual(calls, { regenerate: 0, renumber: 1 });
});

test("uncommitted changes, or --continue with no merge, are refused", (t) => {
  const { seed, work } = setup(t);
  landOnMain(seed, addEndpoint("events"), "main adds events");
  write(work, "README.md", "edited\n");
  assert.equal(run(work).outcome, "refused");
  assert.equal(inMerge(work), false);

  git(work, "checkout", "-q", "--", "README.md");
  assert.equal(run(work, { resume: true }).outcome, "refused");
});
