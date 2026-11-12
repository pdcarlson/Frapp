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
//   4. regenerates the contract whenever both sides changed it since they split
//      (a clean textual merge of two exports is not an export either), and
//      commits the merge;
//   5. runs `migration:renumber`, which does nothing unless the branch adds a
//      migration that main's now sort after. Its renames are left uncommitted,
//      for the session to read and commit.
//
// CI's `check:api-contract` still checks the result against the source, so a
// mistake here fails a check instead of merging.

import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { CONTRACT_ARTIFACTS, regenerateContract } from "./check-api-contract-drift.mjs";
import { isInvokedDirectly } from "./ci/lib/invoked-directly.mjs";

const REPO_ROOT = fileURLToPath(new URL("..", import.meta.url));

const CONTINUE_HINT = "npm run merge:main -- --continue";

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

/** Whether `files` changed between `from` and `to` (both commits). */
function changed(git, from, to, files) {
  return git(["diff", "--name-only", from, to, "--", ...files]).out !== "";
}

function mergeInProgress(git) {
  return git(["rev-parse", "-q", "--verify", "MERGE_HEAD"], { allowFail: true }).ok;
}

function unmergedPaths(git) {
  return lines(git(["diff", "--name-only", "--diff-filter=U"]).out);
}

/**
 * Finish a merge whose conflicts are all resolved: regenerate the contract when
 * both sides changed it, stage it, and commit. Returns the outcome name.
 */
function finish(git, { regenerate, generated, log }) {
  const ours = git(["rev-parse", "HEAD"]).out;
  const theirs = git(["rev-parse", "MERGE_HEAD"]).out;
  const base = git(["merge-base", ours, theirs]).out;
  if (changed(git, base, ours, generated) && changed(git, base, theirs, generated)) {
    log("Both sides changed the API contract; regenerating it from the merged source.");
    try {
      regenerate();
    } catch (error) {
      log(
        "\nRegenerating the contract failed, so the merged source doesn't compile. " +
          `The merge is still in progress: fix the error, \`git add\` the fix, then run \`${CONTINUE_HINT}\`.`,
      );
      log(String(error?.message ?? error));
      return "regenerate-failed";
    }
    git(["add", "--", ...generated]);
  }
  git(["commit", "--no-edit"]);
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
 * @param {() => void} options.renumber moves the branch's migrations after the base's
 * @returns {string} what happened: up-to-date, fast-forward, merged, conflicts,
 *   regenerate-failed, or refused
 */
export function mergeMain({
  cwd,
  base = "origin/main",
  resume = false,
  regenerate,
  renumber,
  generated = CONTRACT_ARTIFACTS,
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
      renumber();
      return "fast-forward";
    }

    const { generated: contract, other } = partitionConflicts(unmergedPaths(git), generated);
    for (const file of contract) {
      git(["checkout", "--theirs", "--", file]);
      git(["add", "--", file]);
    }
    if (contract.length > 0) {
      log(`Took ${base}'s side of ${contract.join(", ")}; it is regenerated below.`);
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

  const outcome = finish(git, { regenerate, generated, log });
  if (outcome === "merged") renumber();
  return outcome;
}

function getArg(name) {
  const i = process.argv.indexOf(name);
  return i === -1 ? undefined : process.argv[i + 1];
}

if (isInvokedDirectly(import.meta.url)) {
  const base = getArg("--base") ?? "origin/main";
  const outcome = mergeMain({
    cwd: REPO_ROOT,
    base,
    resume: process.argv.includes("--continue"),
    regenerate: regenerateContract,
    renumber: () => {
      // Prints "This branch adds no migrations." and stops when there is nothing to move.
      if (!existsSync(join(REPO_ROOT, "supabase/migrations"))) return;
      execFileSync(process.execPath, [join(REPO_ROOT, "scripts/migration.mjs"), "renumber", "--base", base], {
        cwd: REPO_ROOT,
        stdio: "inherit",
      });
    },
  });
  process.exit(["up-to-date", "fast-forward", "merged"].includes(outcome) ? 0 : 1);
}
