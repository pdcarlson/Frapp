#!/usr/bin/env node
// Merge main into the current branch, and redo the parts of the merge a person
// shouldn't have to.
//
//   npm run merge:main                 fetch and merge origin/main
//   npm run merge:main -- --continue   after resolving the conflicts it left you
//   npm run merge:main -- --base <ref> merge another ref (default origin/main)
//
// Why this exists. `apps/api/openapi.json` and `packages/api-sdk/src/types.ts`
// are regenerated whole from the API source, so nearly every API PR conflicts in
// them when it merges main, and the conflict is meaningless: the right answer is
// neither side but a fresh export of the merged source. Resolving it by hand
// costs a session a long read of a generated file. This script:
//
//   1. fetches the base and merges it, without committing;
//   2. resolves a conflict in those generated files by taking main's side;
//   3. stops there if any other file conflicts, for the session to resolve, then
//      picks up again at `--continue`;
//   4. regenerates the contract when both sides changed something it is built
//      from (a clean textual merge of two exports is not an export either),
//      running `npm ci` first if the merge changed the lockfile, and commits the
//      merge;
//   5. runs `migration:renumber` against the commit it merged, which does
//      nothing unless the branch adds a migration that main's now sort after.
//      Its renames are left uncommitted, for the session to read and commit.
//
// CI's `check:api-contract` still checks the result against the source, so a
// mistake here fails a check instead of merging.

import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { CONTRACT_ARTIFACTS, isApiRelated, regenerateContract } from "./check-api-contract-drift.mjs";
import { isInvokedDirectly } from "./ci/lib/invoked-directly.mjs";

const REPO_ROOT = fileURLToPath(new URL("..", import.meta.url));

const CONTINUE_HINT = "npm run merge:main -- --continue";
const LOCKFILE = "package-lock.json";

function gitIn(cwd) {
  return (args, { allowFail = false } = {}) => {
    try {
      const out = execFileSync("git", args, {
        cwd,
        encoding: "utf8",
        stdio: ["ignore", "pipe", "pipe"],
      });
      return { ok: true, out: (out ?? "").trim() };
    } catch (error) {
      if (!allowFail) throw error;
      return { ok: false, out: `${error.stdout ?? ""}${error.stderr ?? ""}`.trim() };
    }
  };
}

const lines = (s) => s.split("\n").map((l) => l.trim()).filter(Boolean);

/**
 * Split the merge's unmerged paths into the generated contract files, which this
 * script resolves, and everything else, which the session does.
 */
export function partitionConflicts(unmerged, generated = CONTRACT_ARTIFACTS) {
  const set = new Set(generated);
  return {
    generated: unmerged.filter((f) => set.has(f)),
    other: unmerged.filter((f) => !set.has(f)),
  };
}

/**
 * Whether the merged contract needs a fresh export: both sides changed a file it
 * is built from, or the contract itself (`isApiRelated` covers both). One side
 * alone carries a contract that already matches its own source; two sides can
 * each be right and still merge into a contract neither export would write.
 */
export function needsRegeneration(oursChanged, theirsChanged, related = isApiRelated) {
  return oursChanged.some(related) && theirsChanged.some(related);
}

function mergeInProgress(git) {
  return git(["rev-parse", "-q", "--verify", "MERGE_HEAD"], { allowFail: true }).ok;
}

function unmergedPaths(git) {
  return lines(git(["diff", "--name-only", "--diff-filter=U"]).out);
}

/** Runs the renumber step, and turns a failure into an outcome rather than a stack trace. */
function renumberAfter(sha, { renumber, log }) {
  try {
    renumber(sha);
    return true;
  } catch (error) {
    log(
      "\nThe merge is done, but `migration:renumber` failed. Run `npm run migration:renumber` " +
        "yourself before pushing, or `migration-order` fails in CI.",
    );
    log(String(error?.message ?? error));
    return false;
  }
}

/**
 * Finish a merge whose conflicts are all resolved: regenerate the contract when
 * both sides changed what it is built from, stage it, and commit. Returns the
 * outcome name.
 */
function finish(git, { regenerate, install, generated, related, log }) {
  const ours = git(["rev-parse", "HEAD"]).out;
  const theirs = git(["rev-parse", "MERGE_HEAD"]).out;
  const base = git(["merge-base", ours, theirs]).out;
  const since = (tip) => lines(git(["diff", "--name-only", base, tip]).out);

  if (needsRegeneration(since(ours), since(theirs), related)) {
    log("Both sides changed the API or its contract; regenerating the contract from the merged source.");
    try {
      // The export runs on node_modules, so it has to match the merged lockfile
      // (a generator bump on main changes the output), as CI's `npm ci` makes it.
      if (git(["diff", "--cached", "--name-only", ours, "--", LOCKFILE]).out) {
        log("The merge changed package-lock.json; installing it first.");
        install();
      }
      regenerate();
    } catch (error) {
      log(
        "\nRegenerating the contract failed. Usually the merged source doesn't compile; if main " +
          "changed dependencies, `npm ci` may be what's missing. The merge is still in progress: " +
          `fix it, \`git add\` the fix, then run \`${CONTINUE_HINT}\`.`,
      );
      log(String(error?.message ?? error));
      return "regenerate-failed";
    }
    git(["add", "--", ...generated]);
  }

  // Runs the pre-commit hook (the secret scan), which a clean `git merge` would not.
  const committed = git(["commit", "--no-edit"], { allowFail: true });
  if (!committed.ok) {
    log(
      "\n`git commit` failed, so the merge is still in progress with everything staged. " +
        `Fix what it reports, then run \`${CONTINUE_HINT}\`.`,
    );
    log(committed.out);
    return "commit-failed";
  }
  log(`Committed the merge of ${theirs.slice(0, 12)}.`);
  return "merged";
}

/**
 * The whole command, with its side effects injectable for the test.
 *
 * @param {object} options
 * @param {string} options.cwd the repository
 * @param {string} options.base the ref to merge, e.g. origin/main
 * @param {boolean} options.resume `--continue`: finish a merge this script stopped
 * @param {() => void} options.regenerate rewrites the generated files from source
 * @param {() => void} options.install brings node_modules in line with the lockfile
 * @param {(sha: string) => void} options.renumber moves the branch's migrations
 *   after those of the commit just merged
 * @returns {string} what happened: up-to-date, fast-forward, merged, conflicts,
 *   regenerate-failed, commit-failed, renumber-failed, or refused
 */
export function mergeMain({
  cwd,
  base = "origin/main",
  resume = false,
  regenerate,
  install,
  renumber,
  generated = CONTRACT_ARTIFACTS,
  related = isApiRelated,
  log = console.log,
}) {
  const git = gitIn(cwd);

  if (resume) {
    if (!mergeInProgress(git)) {
      log("No merge in progress, so there is nothing to continue. Run `npm run merge:main`.");
      return "refused";
    }
    const left = unmergedPaths(git);
    if (left.length > 0) {
      log("These files still conflict. Resolve each and `git add` it, then run this again:");
      for (const f of left) log(`  ${f}`);
      return "conflicts";
    }
  } else {
    if (mergeInProgress(git)) {
      log(
        `A merge is already in progress. Resolve it and run \`${CONTINUE_HINT}\`, ` +
          "or abandon it with `git merge --abort`.",
      );
      return "refused";
    }
    const dirty = git(["status", "--porcelain", "--untracked-files=no"]).out;
    if (dirty) {
      log("Commit or stash your changes first; a merge on top of them is hard to undo.");
      log(dirty);
      return "refused";
    }

    const [remote, ...rest] = base.split("/");
    if (rest.length > 0) {
      const fetched = git(["fetch", "--quiet", remote, rest.join("/")], { allowFail: true });
      if (!fetched.ok) log(`Could not fetch ${base}; merging the local ref.\n${fetched.out}`);
    }

    const before = git(["rev-parse", "HEAD"]).out;
    const merged = git(["merge", "--no-commit", "--no-edit", base], { allowFail: true });
    const after = git(["rev-parse", "HEAD"]).out;

    if (!mergeInProgress(git)) {
      if (!merged.ok) {
        // Refused before starting: an untracked file in the way, an unknown ref.
        log(`git merge refused:\n${merged.out}`);
        return "refused";
      }
      if (before === after) {
        log(`Already up to date with ${base}.`);
        return "up-to-date";
      }
      log(`Fast-forwarded to ${base}.`);
      return renumberAfter(after, { renumber, log }) ? "fast-forward" : "renumber-failed";
    }

    const { generated: contract, other } = partitionConflicts(unmergedPaths(git), generated);
    for (const file of contract) {
      git(["checkout", "--theirs", "--", file]);
      git(["add", "--", file]);
    }
    if (contract.length > 0) {
      log(`Took ${base}'s side of ${contract.join(", ")}; it is regenerated before the commit.`);
    }
    if (other.length > 0) {
      log("\nThese files conflict. Resolve each and `git add` it:");
      for (const f of other) log(`  ${f}`);
      log(
        `\nThen run \`${CONTINUE_HINT}\`, not \`git commit\`: it regenerates the API ` +
          "contract from the resolved source before committing.",
      );
      return "conflicts";
    }
  }

  // Read before the commit consumes it: renumber against the commit actually
  // merged, so it neither re-fetches a base that moved meanwhile nor, after
  // `--continue`, guesses which ref the first run merged.
  const merging = git(["rev-parse", "MERGE_HEAD"]).out;
  const outcome = finish(git, { regenerate, install, generated, related, log });
  if (outcome !== "merged") return outcome;
  return renumberAfter(merging, { renumber, log }) ? "merged" : "renumber-failed";
}

function getArg(name) {
  const i = process.argv.indexOf(name);
  return i === -1 ? undefined : process.argv[i + 1];
}

if (isInvokedDirectly(import.meta.url)) {
  const outcome = mergeMain({
    cwd: REPO_ROOT,
    base: getArg("--base") ?? "origin/main",
    resume: process.argv.includes("--continue"),
    regenerate: regenerateContract,
    install: () => execFileSync("npm", ["ci"], { cwd: REPO_ROOT, stdio: "inherit" }),
    renumber: (sha) => {
      // A bare SHA is never fetched. Prints "This branch adds no migrations." and
      // stops when there is nothing to move.
      if (!existsSync(join(REPO_ROOT, "supabase/migrations"))) return;
      execFileSync(process.execPath, [join(REPO_ROOT, "scripts/migration.mjs"), "renumber", "--base", sha], {
        cwd: REPO_ROOT,
        stdio: "inherit",
      });
    },
  });
  process.exit(["up-to-date", "fast-forward", "merged"].includes(outcome) ? 0 : 1);
}
