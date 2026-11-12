// scripts/merge-main.mjs (`npm run merge:main`), run against a throwaway git
// repository with a bare origin. Regeneration is stubbed with a function that
// derives the "contract" from the endpoint files, which is all the script needs
// to tell a fresh export from either side's stale one.
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { chmodSync, mkdtempSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import { CONTRACT_ARTIFACTS } from "../../check-api-contract-drift.mjs";
import { mergeMain, needsRegeneration, partitionConflicts } from "../../merge-main.mjs";

const [OPENAPI, TYPES] = CONTRACT_ARTIFACTS;
// Real API source paths, so the script's real isApiRelated decides what counts.
const SRC = "apps/api/src/endpoints";

function git(cwd, ...args) {
  return execFileSync("git", args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
}

function write(cwd, file, text) {
  mkdirSync(dirname(join(cwd, file)), { recursive: true });
  writeFileSync(join(cwd, file), text);
}

/** The stub generator: one line per endpoint file, as an export would list them. */
function regenerateIn(cwd) {
  const endpoints = readdirSync(join(cwd, SRC)).sort();
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
  for (const name of ["health", "members", "roles", "status"]) write(seed, `${SRC}/${name}.txt`, `${name}\n`);
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
  git(repo, "config", "core.hooksPath", "/nonexistent-hooks");
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
  const order = [];
  const output = [];
  const outcome = mergeMain({
    cwd: work,
    regenerate: () => {
      calls.regenerate += 1;
      order.push("regenerate");
      regenerateIn(work);
    },
    install: () => order.push("install"),
    renumber: (sha) => {
      calls.renumber += 1;
      order.push(`renumber ${sha}`);
    },
    log: (line) => output.push(line),
    ...overrides,
  });
  return { outcome, calls, order, output: output.join("\n") };
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
  write(cwd, `${SRC}/${name}.txt`, `${name}\n`);
  regenerateIn(cwd);
};

const pathsIn = (cwd) => JSON.parse(readFileSync(join(cwd, OPENAPI), "utf8")).paths;
const SEEDED = ["health.txt", "members.txt", "roles.txt", "status.txt"];
// "item" and "jobs" sort next to each other, so their contract lines conflict;
// "audit" and "tasks" land at opposite ends, so theirs merge cleanly.
const CONFLICTING = [...SEEDED.slice(0, 1), "item.txt", "jobs.txt", ...SEEDED.slice(1)];

/** main and the branch each add an endpoint, regenerating their own contract. */
function divergeOnContract(seed, work, mainName = "item", branchName = "jobs") {
  landOnMain(seed, addEndpoint(mainName), `main adds ${mainName}`);
  addEndpoint(branchName)(work);
  commitAll(work, `branch adds ${branchName}`);
}

test("partitionConflicts separates the generated contract from the rest", () => {
  assert.deepEqual(partitionConflicts([OPENAPI, "apps/api/src/a.ts", TYPES]), {
    generated: [OPENAPI, TYPES],
    other: ["apps/api/src/a.ts"],
  });
});

test("needsRegeneration wants an API-side change on both sides", () => {
  const dto = "apps/api/src/interface/dtos/task.dto.ts";
  const shared = "packages/validation/src/limits.ts";
  assert.equal(needsRegeneration([dto, OPENAPI], [shared]), true, "main moved a value the branch's DTO uses");
  assert.equal(needsRegeneration([OPENAPI], [OPENAPI]), true);
  assert.equal(needsRegeneration(["apps/web/app/page.tsx"], [dto, OPENAPI]), false, "only main touched the API");
  assert.equal(needsRegeneration([dto, OPENAPI], ["README.md"]), false, "only the branch touched the API");
});

test("a conflict only in the generated contract is regenerated and committed", (t) => {
  const { seed, work } = setup(t);
  divergeOnContract(seed, work);
  assert.ok(git(seed, "show", `HEAD:${OPENAPI}`).includes("item"));

  const { outcome, calls, order, output } = run(work);

  assert.equal(outcome, "merged");
  assert.match(output, /Took origin\/main's side/, "the setup must really conflict");
  assert.equal(inMerge(work), false);
  assert.equal(git(work, "status", "--porcelain"), "");
  assert.equal(git(work, "rev-list", "--parents", "-n", "1", "HEAD").split(" ").length, 3);
  assert.deepEqual(pathsIn(work), CONFLICTING);
  assert.doesNotMatch(readFileSync(join(work, TYPES), "utf8"), /<<<<<<<|>>>>>>>/);
  assert.deepEqual(calls, { regenerate: 1, renumber: 1 });
  // Renumber is pinned to the commit merged, not a fresh fetch of the base.
  assert.equal(order.at(-1), `renumber ${git(work, "rev-parse", "origin/main")}`);
});

test("a clean textual merge of two contracts is still regenerated", (t) => {
  const { seed, work } = setup(t);
  divergeOnContract(seed, work, "audit", "tasks");

  const { outcome, calls, output } = run(work);

  assert.equal(outcome, "merged");
  assert.doesNotMatch(output, /Took origin\/main's side/, "the setup must merge cleanly");
  assert.equal(calls.regenerate, 1);
  assert.deepEqual(pathsIn(work), ["audit.txt", ...SEEDED, "tasks.txt"]);
});

test("another conflict stops the merge, and --continue regenerates once it's resolved", (t) => {
  const { seed, work } = setup(t);
  landOnMain(
    seed,
    (cwd) => {
      addEndpoint("item")(cwd);
      write(cwd, "README.md", "one\nmain\nthree\n");
    },
    "main",
  );
  addEndpoint("jobs")(work);
  write(work, "README.md", "one\nbranch\nthree\n");
  commitAll(work, "branch");

  const first = run(work);
  assert.equal(first.outcome, "conflicts");
  assert.match(first.output, /README\.md/);
  assert.match(first.output, /--continue/);
  assert.equal(first.calls.regenerate, 0);
  assert.equal(inMerge(work), true);
  // The generated files are resolved to main's side, without markers, and staged;
  // only README is left.
  assert.deepEqual(
    git(work, "diff", "--name-only", "--diff-filter=U").split("\n").filter(Boolean),
    ["README.md"],
  );
  for (const file of CONTRACT_ARTIFACTS) {
    assert.equal(readFileSync(join(work, file), "utf8"), readFileSync(join(seed, file), "utf8"), file);
  }

  const early = run(work, { resume: true });
  assert.equal(early.outcome, "conflicts");
  assert.equal(inMerge(work), true);

  write(work, "README.md", "one\nmain\nbranch\nthree\n");
  git(work, "add", "README.md");
  const done = run(work, { resume: true, base: "origin/elsewhere" });

  assert.equal(done.outcome, "merged");
  assert.equal(inMerge(work), false);
  assert.deepEqual(done.calls, { regenerate: 1, renumber: 1 });
  assert.deepEqual(pathsIn(work), CONFLICTING);
  // --continue renumbers against what the first run merged, whatever --base says now.
  assert.equal(done.order.at(-1), `renumber ${git(work, "rev-parse", "origin/main")}`);
});

test("a merge that changes the lockfile installs it before regenerating", (t) => {
  const { seed, work } = setup(t);
  landOnMain(
    seed,
    (cwd) => {
      addEndpoint("item")(cwd);
      write(cwd, "package-lock.json", '{"generator":"2"}\n');
    },
    "main bumps the generator",
  );
  addEndpoint("jobs")(work);
  commitAll(work, "branch adds jobs");

  const { outcome, order } = run(work);

  assert.equal(outcome, "merged");
  assert.deepEqual(order.slice(0, 2), ["install", "regenerate"]);
});

test("a clean merge where only main changed the contract does not regenerate", (t) => {
  const { seed, work } = setup(t);
  landOnMain(seed, addEndpoint("item"), "main adds item");
  write(work, "notes.txt", "branch work\n");
  commitAll(work, "branch, no API change");

  const { outcome, calls } = run(work);

  assert.equal(outcome, "merged");
  assert.equal(inMerge(work), false);
  assert.deepEqual(calls, { regenerate: 0, renumber: 1 });
});

test("a failed regeneration leaves the merge in progress for --continue", (t) => {
  const { seed, work } = setup(t);
  divergeOnContract(seed, work);

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

test("a commit the pre-commit hook refuses leaves the merge in progress for --continue", (t) => {
  const { seed, work } = setup(t);
  divergeOnContract(seed, work);
  const hooks = join(work, "..", "hooks");
  write(hooks, "pre-commit", "#!/bin/sh\necho 'secret found' >&2\nexit 1\n");
  chmodSync(join(hooks, "pre-commit"), 0o755);
  git(work, "config", "core.hooksPath", hooks);

  const refused = run(work);
  assert.equal(refused.outcome, "commit-failed");
  assert.match(refused.output, /secret found/);
  assert.equal(inMerge(work), true);
  assert.equal(refused.calls.renumber, 0);

  git(work, "config", "core.hooksPath", "/nonexistent-hooks");
  assert.equal(run(work, { resume: true }).outcome, "merged");
  assert.equal(inMerge(work), false);
});

test("a failed renumber is reported after the merge is committed", (t) => {
  const { seed, work } = setup(t);
  divergeOnContract(seed, work);
  const { outcome, output } = run(work, {
    renumber: () => {
      throw new Error("renumber exploded");
    },
  });
  assert.equal(outcome, "renumber-failed");
  assert.match(output, /npm run migration:renumber/);
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
  landOnMain(seed, addEndpoint("item"), "main adds item");
  const { outcome, calls, order } = run(work);
  assert.equal(outcome, "fast-forward");
  assert.equal(git(work, "rev-parse", "HEAD"), git(work, "rev-parse", "origin/main"));
  assert.deepEqual(calls, { regenerate: 0, renumber: 1 });
  assert.deepEqual(order, [`renumber ${git(work, "rev-parse", "origin/main")}`]);
});

test("uncommitted changes, or --continue with no merge, are refused", (t) => {
  const { seed, work } = setup(t);
  landOnMain(seed, addEndpoint("item"), "main adds item");
  write(work, "README.md", "edited\n");
  assert.equal(run(work).outcome, "refused");
  assert.equal(inMerge(work), false);

  git(work, "checkout", "-q", "--", "README.md");
  assert.equal(run(work, { resume: true }).outcome, "refused");
});
