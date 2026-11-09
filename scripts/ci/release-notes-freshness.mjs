#!/usr/bin/env node
// Warns, before the Deploy production approval, when a release ships changes
// members could notice with no new What's new entry (#3804).
//
// What's new (`packages/validation/src/release-notes.ts`) is what members see
// after an update: mobile opens the newest entry by itself once. If a release
// changes what members get but nobody wrote it down, the app shows nothing new
// and testers never learn what to try. Nothing else reminds anyone to write one.
//
// The test: did anything members could notice change between production's
// latest release tag and the commit being deployed, while What's new gained
// neither a newer entry nor new lines in the newest one? "Could notice" is the
// apps (mobile, web and the API), the shared packages they bundle, and the
// parts of `supabase/` that reach a hosted project (migrations, data fixes,
// edge functions); not tests, test helpers, tool config, docs, local seed data,
// the shipped-builds registry, or the release notes themselves. "New lines"
// counts: dates are unique, so a second release on one day adds lines to that
// day's entry, and mobile shows it again then and only then (`releaseNoteVersion`
// in the notes file). A reword or a reformat is not news to members, so it
// doesn't count here either. A hit is a `::warning::` on the run and a line in
// the job summary, both on the approval screen.
//
// A commit that isn't ahead of the release tag (a rollback) is skipped: going
// back ships nothing new to write about.
//
// A warning, not a gate. Issue #3804 asked for the lightest thing that keeps
// the notes current and named a deploy-time warning. Some releases change
// nothing a member would notice (a fix to a crash nobody hit, a refactor), and
// blocking production on a changelog would be the wrong trade. It never fails
// the step: a git error says it couldn't check and exits 0, and the workflow
// step is also `continue-on-error`.
//
// It reads the notes file at each commit as text (`git show`) and never runs
// the deployed commit's code, so `date:` and `changes: [...]` stay literal
// there (its header says so).
//
// Env: DEPLOY_SHA (required). Tags must be fetched first.

import { execFileSync } from "node:child_process";
import { appendFileSync } from "node:fs";

import { isInvokedDirectly } from "./lib/invoked-directly.mjs";
import { latestReleaseTag } from "./lib/release-tag.mjs";

export const RELEASE_NOTES_PATH = "packages/validation/src/release-notes.ts";
/** Where a change members could notice lives. */
export const MEMBER_FACING_DIRS = [
  "apps/mobile/",
  "apps/web/",
  "apps/api/",
  "packages/",
  "supabase/migrations/",
  "supabase/data-fixes/",
  "supabase/functions/",
];
/** Packages that only configure tools; nothing in them reaches a member. */
const TOOLING_PACKAGES = ["packages/eslint-config/", "packages/typescript-config/"];
/** Config read by test, lint and format tools, never by a build members get. */
const TOOL_CONFIG =
  /(^|\/)(vitest|vite|eslint|playwright|jest|prettier|stylelint|knip|lint-staged)\.config\.[cm]?[jt]s$|(^|\/)vitest\.setup\.[cm]?[jt]sx?$/;

/**
 * How many string literals the array starting at `source[open]` (a `[`)
 * holds at its own depth, skipping comments, or `null` if it never closes.
 * Formatting (quotes, wrapping, trailing commas) doesn't change the count.
 */
export function countArrayStrings(source, open) {
  let depth = 0;
  let count = 0;
  for (let i = open; i < source.length; i += 1) {
    const ch = source[i];
    if (ch === "/" && source[i + 1] === "/") {
      const end = source.indexOf("\n", i);
      i = end === -1 ? source.length : end;
    } else if (ch === "/" && source[i + 1] === "*") {
      const end = source.indexOf("*/", i + 2);
      i = end === -1 ? source.length : end + 1;
    } else if (ch === '"' || ch === "'" || ch === "`") {
      if (depth === 1) count += 1;
      for (i += 1; i < source.length && source[i] !== ch; i += 1) {
        if (source[i] === "\\") i += 1;
      }
    } else if (ch === "[") {
      depth += 1;
    } else if (ch === "]") {
      depth -= 1;
      if (depth === 0) return count;
    }
  }
  return null;
}

/**
 * The newest entry of `RELEASE_NOTES` (newest first; its spec enforces the
 * order): its date and how many lines it has. `null` when the file has no
 * such list, as before What's new existed.
 */
export function newestReleaseNote(source) {
  if (typeof source !== "string") return null;
  const list = source.indexOf("RELEASE_NOTES");
  if (list === -1) return null;
  const date = /\bdate:\s*["'](\d{4}-\d{2}-\d{2})["']/.exec(source.slice(list));
  if (!date) return null;
  const from = list + date.index;
  const changes = /\bchanges:\s*\[/.exec(source.slice(from));
  const lines = changes ? countArrayStrings(source, from + changes.index + changes[0].length - 1) : null;
  return { date: date[1], lines: lines ?? 0 };
}

/** Changed files a member could notice: shipped code, not its tests, tooling or notes. */
export function memberFacingChanges(files) {
  return files.filter(
    (file) =>
      MEMBER_FACING_DIRS.some((dir) => file.startsWith(dir)) &&
      !TOOLING_PACKAGES.some((dir) => file.startsWith(dir)) &&
      file !== RELEASE_NOTES_PATH &&
      !file.startsWith("apps/mobile/store/") &&
      !/(^|\/)(test|tests|__tests__|e2e|__mocks__)\//.test(file) &&
      !/\.(spec|test)\.[cm]?[jt]sx?$/.test(file) &&
      !TOOL_CONFIG.test(file) &&
      !file.endsWith(".md"),
  );
}

/**
 * `{stale, message}`. Stale when something members could notice changed and
 * the newest entry reads exactly as it did in what production already shipped.
 */
export function releaseNotesVerdict({ tag, floor, ship, changedFiles }) {
  const changes = memberFacingChanges(changedFiles);
  if (changes.length === 0) {
    return { stale: false, message: `Nothing members could notice changed since ${tag}, so no new What's new entry is needed.` };
  }
  if (ship && (!floor || ship.date > floor.date)) {
    return { stale: false, message: `What's new has a new entry (${ship.date}) since ${tag}.` };
  }
  if (ship && floor && ship.date === floor.date && ship.lines > floor.lines) {
    return { stale: false, message: `What's new has new lines in its ${ship.date} entry since ${tag}.` };
  }
  const sample = changes.slice(0, 5).map((f) => `\`${f}\``).join(", ");
  return {
    stale: true,
    message:
      `${changes.length} file${changes.length === 1 ? "" : "s"} members could notice changed since ${tag} (${sample}${changes.length > 5 ? ", …" : ""}), ` +
      `but What's new has no new entry or lines (newest: ${ship?.date ?? "none"}). Members won't see anything new after this update. ` +
      `If it changes something they'd notice, add an entry to ${RELEASE_NOTES_PATH} (or lines to today's) and deploy that commit instead.`,
  };
}

function defaultGit(args) {
  return execFileSync("git", args, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
}

/** The file at `ref`, or null when it isn't there. */
function fileAt(git, ref, path) {
  try {
    return git(["show", `${ref}:${path}`]);
  } catch {
    return null;
  }
}

/**
 * Whether `ancestor` is an ancestor of (or is) `commit`. `git merge-base
 * --is-ancestor` exits 1 for "no" and something else (128) when it can't
 * tell, which throws here.
 */
function isAncestor(git, ancestor, commit) {
  try {
    git(["merge-base", "--is-ancestor", ancestor, commit]);
    return true;
  } catch (error) {
    if (error?.status === 1) return false;
    throw error;
  }
}

/** Never throws: `{stale, message}`, or `{stale: false, skipped: reason}`. */
export function checkReleaseNotes({ sha, git = defaultGit }) {
  const latest = latestReleaseTag({ git });
  if (!latest.ok) return { stale: false, skipped: `production's release tag is unknown (${latest.error})` };
  const tagCommit = `${latest.tag}^{commit}`;
  try {
    if (!isAncestor(git, tagCommit, sha)) {
      return { stale: false, skipped: `${sha} is not ahead of production's ${latest.tag} (a rollback ships nothing new to write about)` };
    }
    const changedFiles = git(["diff", "--name-only", tagCommit, sha])
      .split("\n")
      .map((f) => f.trim())
      .filter(Boolean);
    return releaseNotesVerdict({
      tag: latest.tag,
      floor: newestReleaseNote(fileAt(git, latest.tag, RELEASE_NOTES_PATH)),
      ship: newestReleaseNote(fileAt(git, sha, RELEASE_NOTES_PATH)),
      changedFiles,
    });
  } catch (error) {
    return { stale: false, skipped: `git could not compare ${latest.tag} with ${sha}: ${error.message}` };
  }
}

export function runCli({ env = process.env, git = defaultGit, log = console.log } = {}) {
  const sha = (env.DEPLOY_SHA ?? "").trim();
  const result = sha
    ? checkReleaseNotes({ sha, git })
    : { stale: false, skipped: "DEPLOY_SHA is empty" };
  const line = result.skipped
    ? `What's new check skipped: ${result.skipped}.`
    : result.message;
  if (result.stale) log(`::warning title=No new What's new entry::${line}`);
  else log(line);
  if (env.GITHUB_STEP_SUMMARY) {
    try {
      appendFileSync(
        env.GITHUB_STEP_SUMMARY,
        `### What's new\n\n${result.stale ? "⚠️ " : ""}${line}\n`,
      );
    } catch {
      // The warning above is already on the run.
    }
  }
  return 0;
}

if (isInvokedDirectly(import.meta.url)) {
  process.exitCode = runCli();
}
