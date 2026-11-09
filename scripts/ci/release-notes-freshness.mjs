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
// latest release tag and the commit being deployed, while the newest entry's
// text stayed the same? "Could notice" is the apps (mobile, web and the API),
// the shared packages they bundle, and `supabase/` (migrations and data fixes),
// minus tests, test helpers, tool config, docs and the shipped-builds
// registry. "The newest entry's text" rather than its date: dates are unique,
// so a second release on one day extends that day's entry, and mobile shows
// the extended entry again (`apps/mobile/lib/whats-new.ts`). A hit is a
// `::warning::` on the run and a line in the job summary, both on the
// approval screen.
//
// A commit that isn't ahead of the release tag (a rollback) is skipped: going
// back ships nothing new to write about.
//
// A warning, not a gate. Some releases change nothing a member would notice
// (a fix to a crash nobody hit, a refactor), and blocking production on a
// changelog would be the wrong trade. It never fails the step: a git error
// says it couldn't check and exits 0, and the workflow step is also
// `continue-on-error`.
//
// Env: DEPLOY_SHA (required). Tags must be fetched first.

import { execFileSync } from "node:child_process";
import { appendFileSync } from "node:fs";

import { isInvokedDirectly } from "./lib/invoked-directly.mjs";
import { latestReleaseTag } from "./lib/release-tag.mjs";

export const RELEASE_NOTES_PATH = "packages/validation/src/release-notes.ts";
/** Where a change members could notice lives. */
export const MEMBER_FACING_DIRS = ["apps/mobile/", "apps/web/", "apps/api/", "packages/", "supabase/"];
/** Packages that only configure tools; nothing in them reaches a member. */
const TOOLING_PACKAGES = ["packages/eslint-config/", "packages/typescript-config/"];

/**
 * The newest entry of `RELEASE_NOTES` as written (newest first; its spec
 * enforces the order): from the first `date:` inside the list up to the next
 * one, or the list's end, with whitespace collapsed. `null` when the file has
 * no such list, as before What's new existed.
 */
export function newestReleaseNote(source) {
  if (typeof source !== "string") return null;
  const list = source.indexOf("RELEASE_NOTES");
  if (list === -1) return null;
  const rest = source.slice(list);
  const dates = [...rest.matchAll(/\bdate:\s*["'](\d{4}-\d{2}-\d{2})["']/g)];
  if (dates.length === 0) return null;
  const start = dates[0].index;
  const listEnd = rest.indexOf("]);", start);
  const end = dates[1]?.index ?? (listEnd === -1 ? rest.length : listEnd);
  return { date: dates[0][1], text: rest.slice(start, end).replace(/\s+/g, " ").trim() };
}

/** Changed files a member could notice: shipped code, not its tests, tooling or notes. */
export function memberFacingChanges(files) {
  return files.filter(
    (file) =>
      MEMBER_FACING_DIRS.some((dir) => file.startsWith(dir)) &&
      !TOOLING_PACKAGES.some((dir) => file.startsWith(dir)) &&
      !file.startsWith("apps/mobile/store/") &&
      !/(^|\/)(test|tests|__tests__|e2e|__mocks__)\//.test(file) &&
      !/\.(spec|test)\.[cm]?[jt]sx?$/.test(file) &&
      !/(^|\/)[^/]*\.config\.[cm]?[jt]s$/.test(file) &&
      !/(^|\/)vitest\.setup\.[cm]?[jt]sx?$/.test(file) &&
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
  if (ship && (!floor || ship.text !== floor.text)) {
    return {
      stale: false,
      message: `What's new has ${floor && ship.date === floor.date ? "new lines in its" : "a new"} entry (${ship.date}) since ${tag}.`,
    };
  }
  const sample = changes.slice(0, 5).map((f) => `\`${f}\``).join(", ");
  return {
    stale: true,
    message:
      `${changes.length} file${changes.length === 1 ? "" : "s"} members could notice changed since ${tag} (${sample}${changes.length > 5 ? ", …" : ""}), ` +
      `but the newest What's new entry (${ship?.date ?? "none"}) is unchanged. Members won't see anything new after this update. ` +
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

/** Whether `ancestor` is an ancestor of (or is) `commit`. */
function isAncestor(git, ancestor, commit) {
  try {
    git(["merge-base", "--is-ancestor", ancestor, commit]);
    return true;
  } catch {
    return false;
  }
}

/** Never throws: `{stale, message}`, or `{stale: false, skipped: reason}`. */
export function checkReleaseNotes({ sha, git = defaultGit }) {
  const latest = latestReleaseTag({ git });
  if (!latest.ok) return { stale: false, skipped: `production's release tag is unknown (${latest.error})` };
  const tagCommit = `${latest.tag}^{commit}`;
  if (!isAncestor(git, tagCommit, sha)) {
    return { stale: false, skipped: `${sha} is not ahead of production's ${latest.tag} (a rollback ships nothing new to write about)` };
  }
  try {
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
