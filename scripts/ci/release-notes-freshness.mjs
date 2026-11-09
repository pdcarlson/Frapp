#!/usr/bin/env node
// Warns, before the Deploy production approval, when a release ships app
// changes with no new What's new entry (#3804).
//
// What's new (`packages/validation/src/release-notes.ts`) is what members see
// after an update: mobile opens the newest entry by itself once. If a release
// changes the apps but nobody added an entry, the app shows nothing new and
// testers never learn what to try. Nothing else reminds anyone to write one.
//
// The test: did anything under `apps/mobile` or `apps/web` change between
// production's latest release tag and the commit being deployed (specs, docs
// and the shipped-builds registry don't count), while the newest entry's date
// stayed the same? Then it says so as a `::warning::` on the run and a line in
// the job summary, both visible on the approval screen.
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
export const APP_DIRS = ["apps/mobile/", "apps/web/"];

/**
 * The newest entry's date in `release-notes.ts`: the first `date: "…"` inside
 * `RELEASE_NOTES`, which is newest first (its spec enforces the order). `null`
 * when the file has no such list, as before What's new existed.
 */
export function newestReleaseNoteDate(source) {
  if (typeof source !== "string") return null;
  const list = source.indexOf("RELEASE_NOTES");
  if (list === -1) return null;
  const match = /\bdate:\s*["'](\d{4}-\d{2}-\d{2})["']/.exec(source.slice(list));
  return match ? match[1] : null;
}

/** Changed files a member could notice: app code, not its tests or notes. */
export function appFacingChanges(files) {
  return files.filter(
    (file) =>
      APP_DIRS.some((dir) => file.startsWith(dir)) &&
      !/\.(spec|test)\.[cm]?[jt]sx?$/.test(file) &&
      !file.endsWith(".md") &&
      !file.startsWith("apps/mobile/store/"),
  );
}

/**
 * `{stale, message}`. Stale when the apps changed and the newest entry did
 * not move past the one production already shipped.
 */
export function releaseNotesVerdict({ tag, floorDate, shipDate, changedFiles }) {
  const app = appFacingChanges(changedFiles);
  if (app.length === 0) {
    return { stale: false, message: `No app changes since ${tag}, so no new What's new entry is needed.` };
  }
  if (shipDate && (!floorDate || shipDate > floorDate)) {
    return { stale: false, message: `What's new has a new entry (${shipDate}) since ${tag}.` };
  }
  const sample = app.slice(0, 5).map((f) => `\`${f}\``).join(", ");
  return {
    stale: true,
    message:
      `${app.length} app file${app.length === 1 ? "" : "s"} changed since ${tag} (${sample}${app.length > 5 ? ", …" : ""}), ` +
      `but the newest What's new entry is still ${shipDate ?? "missing"}. Members won't see anything new after this update. ` +
      `If it changes something they'd notice, add an entry to ${RELEASE_NOTES_PATH} and deploy that commit instead.`,
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

/** Never throws: `{stale, message}`, or `{stale: false, skipped: reason}`. */
export function checkReleaseNotes({ sha, git = defaultGit }) {
  const latest = latestReleaseTag({ git });
  if (!latest.ok) return { stale: false, skipped: `production's release tag is unknown (${latest.error})` };
  try {
    const changedFiles = git(["diff", "--name-only", `${latest.tag}^{commit}`, sha])
      .split("\n")
      .map((f) => f.trim())
      .filter(Boolean);
    return releaseNotesVerdict({
      tag: latest.tag,
      floorDate: newestReleaseNoteDate(fileAt(git, latest.tag, RELEASE_NOTES_PATH)),
      shipDate: newestReleaseNoteDate(fileAt(git, sha, RELEASE_NOTES_PATH)),
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
