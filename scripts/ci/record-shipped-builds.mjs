#!/usr/bin/env node

// Record the store builds a Deploy production run uploaded (#3111).
//
// `_mobile-build.yml`'s `ios` and `android` jobs each build the commit
// production now serves on a GitHub runner (`eas build --local`, #5162) and
// upload it to TestFlight or the Play internal track. Every build uploaded
// there must be listed in `apps/mobile/store/shipped-builds.json` before a
// tester can install it, because that list arms the required
// `api-contract-check` gate (`apps/mobile/store/README.md` § Shipped builds
// and the API contract). This is the `record` job's whole work: it turns each
// uploaded build into one entry, opens the pull request that adds them, and
// writes the run's summary of what was built and uploaded.
//
// ── Why a pull request, opened with the base-sync App ──────────────────────
// `main` takes changes only through a pull request. One opened with the
// Actions `GITHUB_TOKEN` starts no workflow, so its required checks would sit
// at "Expected" forever. An App installation token's events do start them, so
// the job mints the same App token `pr-base-sync.yml` uses (contents and pull
// requests, write). The commit and the pull request go through the REST API,
// so nothing here needs git credentials or a push.
//
// ── What gets recorded ──────────────────────────────────────────────────────
// A build is recorded when its job reports it built (`FINISHED`) and its
// upload step succeeded. Since #3483 that step submits with `--no-wait`, so
// "succeeded" means EAS accepted the submission, which may still sit in
// Expo's queue; the run's `confirm` job reports whether each upload then
// finished. An entry for one that failed makes the contract gate stricter
// than it needs to be, but it also points each deploy's client check at a
// build nobody runs, so `confirm` says to drop it (the store README's
// exception). Anything else is reported and left out:
//   * a build that didn't finish, or whose upload failed or never ran: it is
//     on no store track, and the README's rule is to record a build when it is
//     first uploaded. Its job is already red for it, and the summary says what
//     to do next;
//   * a build from any commit but the validated SHA: refused, and this job
//     fails. That is the "never newer than production" rule failing, and it
//     must not become an entry that says otherwise. The build job refuses to
//     hand one on already; this is the second check.
// The values are the ones the build job read (`appVersion` from `app.json`,
// `appBuildVersion` from eas-cli's increment of EAS's remote build number,
// checked against the binary's Info.plist on iOS): the version and build
// number the binary sends in `X-Client-Version`. The result is validated with
// the registry's own `parseRegistry` (`lib/shipped-builds-registry.mjs`) before
// it is written.
//
// ── Why it merges itself ────────────────────────────────────────────────────
// With AUTO_MERGE `true` (`_mobile-build.yml` sets it), its `merge-record`
// job turns on squash auto-merge for this PR once `confirm` saw every upload
// finish. Paul asked for this on 2026-11-12: the next `auto` ship can't see
// a build until its entry is on `main`, and a record PR waiting on him made
// that ship build the same version again. Not here, at open: `confirm` can
// wait hours in Expo's queue, and a PR that merged first would record an
// upload that then failed (a `mobile-v*` tag for a build in no store, and an
// `auto` plan that sends that version an update no binary can take). Its
// required checks still hold it, `api-contract-check` above all. This job
// writes the PR's number as the `pr` step output for `merge-record`.
//
// ── How it fails ────────────────────────────────────────────────────────────
// Exits 1 when a build it should record can't be (no token, an API refusal, a
// wrong commit, a malformed version), and the summary then lists the entries
// to add by hand. Exits 0 when everything uploaded is recorded, including when
// nothing was uploaded: the build job's own red row carries that failure. A
// build job that succeeded but handed over no build is a wiring fault, and
// exits 1.
//
// Env inputs, for each of IOS and ANDROID (`<P>`):
//   <P>_RESULT        — `needs.<p>.result`: success, failure, cancelled, or
//                       skipped when the platform wasn't requested
//   <P>_BUILD         — the job's `build` output: `{ platform, status,
//                       appVersion, appBuildVersion, gitCommitHash }`, set
//                       only once the build step succeeded
//   <P>_UPLOAD        — the upload step's outcome, empty when it didn't run
//   <P>_TAG_MOVED     — `true` when that job's tag check found production on
//                       another commit: nothing from this run may be
//                       uploaded, by hand either
//   <P>_TAG_BEFORE_BUILD, <P>_TAG_BEFORE_UPLOAD
//                     — each tag check's outcome. A `failure` without
//                       <P>_TAG_MOVED is a failed read, not a moved production
// and once:
//   PLATFORM          — the requested platform: ios, android or all
//   DEPLOY_SHA        — the validated SHA the run shipped and built
//   GH_TOKEN          — the base-sync App token; empty when the mint failed
//   AUTO_MERGE        — `true` when `merge-record` will turn on auto-merge; only the
//                       PR body and the summary read it
//   GITHUB_OUTPUT     — where the opened PR's number goes, as `pr`
//   GITHUB_REPOSITORY — owner/repo
//   RUN_URL, RUN_ID, RUN_ATTEMPT — this run, for the branch, the PR and the summary
//   GITHUB_STEP_SUMMARY — where the summary goes

import { appendFileSync } from "node:fs";
import { ghRequest } from "./lib/github.mjs";
import { isInvokedDirectly } from "./lib/invoked-directly.mjs";
import { REGISTRY_PATH, mergeRegistry } from "./lib/shipped-builds-registry.mjs";


/** Each requested platform, and the store platforms it builds. */
export const PLATFORMS_FOR = Object.freeze({
  ios: ["ios"],
  android: ["android"],
  all: ["ios", "android"],
});

const EAS_PLATFORM = Object.freeze({ ios: "IOS", android: "ANDROID" });
const DISPLAY = Object.freeze({ ios: "iOS", android: "Android" });
const STORE = Object.freeze({ ios: "TestFlight", android: "the Play internal track" });

/**
 * A build job's `build` output as an object, or null when there is none
 * (empty, not JSON, not an object).
 */
export function parseBuild(raw) {
  if (typeof raw !== "string" || raw.trim() === "") return null;
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) return null;
  return parsed;
}

/** A job's status in the summary when it handed over no build. */
const UNBUILT = Object.freeze({ failure: "failed", cancelled: "cancelled", skipped: "not built", success: "no build reported" });

/**
 * Decide, per requested platform, what was built, what was uploaded and what
 * gets recorded.
 *
 * @param {object} args
 * @param {{ ios?: object, android?: object }} args.jobs — per platform, `{ result, build, upload }`:
 *   the job's result, its parsed `build` output (or null), and its upload step's outcome
 * @returns {{ rows: object[], entries: object[], problems: string[] }}
 *   `rows` feed the summary, one per requested platform; `entries` are the
 *   `shipped-builds.json` entries to add; `problems` fail the job.
 */
export function planRecord({ jobs, platform, sha, recorded }) {
  const rows = [];
  const entries = [];
  const problems = [];
  const requested = PLATFORMS_FOR[platform];
  if (!requested) {
    return { rows, entries, problems: [`PLATFORM must be ios, android or all; got '${platform}'.`] };
  }

  for (const store of requested) {
    const { result = "", build = null, upload = "" } = jobs[store] ?? {};
    // `planned`: an entry for this build is in `entries`. Whether it reached
    // the registry is the PR's outcome, which only `summary` knows.
    const row = { store, status: UNBUILT[result] ?? "not built", version: null, build: null, upload: upload || "not run", planned: false, refused: false };
    rows.push(row);

    if (!build) {
      if (result === "success") {
        problems.push(`The ${DISPLAY[store]} job succeeded but handed over no build (its \`build\` output is empty or not a JSON object). Nothing can be recorded from it; read that job's log for the version it built.`);
      }
      continue;
    }
    if (build.platform !== EAS_PLATFORM[store]) {
      problems.push(`The ${DISPLAY[store]} job handed over a build of '${build.platform}'. Not recorded.`);
      continue;
    }

    row.status = typeof build.status === "string" ? build.status : "unknown";
    row.version = typeof build.appVersion === "string" ? build.appVersion : null;
    row.build = typeof build.appBuildVersion === "string" ? build.appBuildVersion : null;

    // Checked before anything else about a build: a binary from another
    // commit may be newer than production, and recording it would say the
    // opposite.
    if (build.gitCommitHash !== sha) {
      row.refused = true;
      problems.push(
        `${DISPLAY[store]} was built from ${build.gitCommitHash ?? "an unreported commit"}, not the validated ${sha}. Not recorded. Don't let testers install it: it may call routes production doesn't serve.`,
      );
      continue;
    }
    if (row.status !== "FINISHED" || upload !== "success") continue;

    if (!row.version || !/^\d+\.\d+\.\d+$/.test(row.version) || !row.build || !/^[1-9]\d*$/.test(row.build)) {
      problems.push(
        `The ${DISPLAY[store]} job reported version '${row.version}' and build '${row.build}', which shipped-builds.json can't hold. Record it by hand from the binary in TestFlight or Play Console.`,
      );
      continue;
    }
    entries.push({ platform: store, version: row.version, build: row.build, sha, recorded });
    row.planned = true;
  }
  return { rows, entries, problems };
}

const label = (e) => `${DISPLAY[e.platform]} ${e.version} (${e.build})`;

export function branchName({ runId, runAttempt }) {
  return `shipped-builds/run-${runId}-${runAttempt}`;
}

export function prTitle(entries) {
  return `chore(mobile): record ${entries.map(label).join(" and ")} in shipped-builds.json`;
}

export function prBody({ entries, sha, runUrl, repo, autoMerge = false }) {
  return [
    `[Deploy production](${runUrl}) shipped \`${sha}\`, built it on GitHub's runners, and submitted these builds to the stores without releasing them:`,
    "",
    "| Platform | Version | Build | Submitted to |",
    "| --- | --- | --- | --- |",
    ...entries.map((e) => `| ${DISPLAY[e.platform]} | ${e.version} | ${e.build} | ${STORE[e.platform]} |`),
    "",
    `This adds one \`${REGISTRY_PATH}\` entry per submitted build, so this PR's \`api-contract-check\` holds the API to the contract at \`${sha}\` ([\`apps/mobile/store/README.md\` § Shipped builds and the API contract](https://github.com/${repo}/blob/main/apps/mobile/store/README.md#shipped-builds-and-the-api-contract)). ${
      autoMerge
        ? "It merges itself once the run's `confirm` job sees every upload finish and its required checks pass, so the next `auto` ship sees these builds. Until it has merged, the gate doesn't protect them."
        : "Merge it before any tester installs one of these builds: until then the gate doesn't protect them."
    }`,
    "",
    `EAS accepted each submission, and Expo may still be uploading it. [The run](${runUrl})'s \`confirm\` job says whether each upload finished. If one failed, ${
      autoMerge
        ? "that job leaves auto-merge off and comments here: drop the failed build's entry and merge this by hand, or, once this has merged,"
        : "drop its entry before merging, or, once this has merged,"
    } move it to the registry's \`dropped\` list in a PR of its own.`,
    "",
    `**If \`api-contract-check\` fails here,** \`main\` has already changed the API in a way these builds can't take (it is ahead of \`${sha}\`). Fix that on \`main\` before the next production ship, or waive a route no shipped binary calls as the README says, then re-run the check. Don't merge around it.`,
    "",
    "Opened by `_mobile-build.yml`'s `record` job; the registry entries are the only change.",
  ].join("\n");
}

/**
 * Open the pull request that adds `entries`, from `main`'s current tip.
 *
 * @returns {Promise<{ outcome: "opened", url: string, number: number, branch: string, autoMerge: boolean } | { outcome: "already-recorded" }>}
 * @throws {Error} naming the call that failed
 */
export async function openRecordPr({ token, repo, fetchImpl, entries, sha, runUrl, runId, runAttempt, autoMerge = false }) {
  const call = async (method, path, body) => {
    const res = await ghRequest({ token, fetchImpl, method, path, body, retry: method === "GET" });
    if (!res.ok) {
      const detail = typeof res.data === "string" ? res.data : res.data?.message ?? "";
      throw new Error(`${method} ${path} failed (HTTP ${res.status}${detail ? `: ${detail}` : ""}).`);
    }
    return res.data;
  };

  // One snapshot: the file is read at the commit the branch is cut from, so a
  // `main` that moves in between can't make the two disagree.
  const head = await call("GET", `/repos/${repo}/git/ref/heads/main`);
  const base = head?.object?.sha;
  if (typeof base !== "string") throw new Error("GET the main ref returned no commit SHA.");
  const file = await call("GET", `/repos/${repo}/contents/${REGISTRY_PATH}?ref=${base}`);
  if (typeof file?.content !== "string" || typeof file?.sha !== "string") {
    throw new Error(`GET ${REGISTRY_PATH} returned no file content.`);
  }
  const current = Buffer.from(file.content, "base64").toString("utf8");
  const { text, added } = mergeRegistry(current, entries);
  if (added.length === 0) return { outcome: "already-recorded" };

  const branch = branchName({ runId, runAttempt });
  await call("POST", `/repos/${repo}/git/refs`, { ref: `refs/heads/${branch}`, sha: base });
  const title = prTitle(added);
  await call("PUT", `/repos/${repo}/contents/${REGISTRY_PATH}`, {
    message: `${title}\n\nSubmitted by Deploy production: ${runUrl}`,
    content: Buffer.from(text, "utf8").toString("base64"),
    sha: file.sha,
    branch,
  });
  const pr = await call("POST", `/repos/${repo}/pulls`, {
    title,
    head: branch,
    base: "main",
    body: prBody({ entries: added, sha, runUrl, repo, autoMerge }),
  });
  if (typeof pr?.html_url !== "string") throw new Error("POST /pulls returned no pull request URL.");
  return { outcome: "opened", url: pr.html_url, number: pr.number, branch, autoMerge };
}

/**
 * What to do about one row that wasn't recorded, or null when there's nothing
 * to do. `tag`: `{ moved, beforeBuild, beforeUpload }` from that platform's
 * two tag checks. Each platform builds in its own job, so **Re-run failed
 * jobs** builds only the one that failed, and its binary isn't kept: a re-run
 * builds it again, with a new build number.
 */
export function nextStep(row, { sha, tag = {} }) {
  const name = DISPLAY[row.store];
  // A planned row is the PR's, or the "Not recorded" block's when the PR failed.
  if (row.planned || row.refused) return null;
  if (tag.moved) {
    return `${name} was not uploaded: production has shipped another commit since this run, so nothing built from \`${sha}\` may reach testers. The next store build comes from the next ship.`;
  }
  const rerun = `use **Re-run failed jobs** on this run: it builds only ${name}, with a new build number, uploads it and records it, and refuses if production has shipped another commit since`;
  if (row.status === "FINISHED" && row.upload !== "success") {
    if (tag.beforeUpload === "failure") {
      return `${name} built, and was not uploaded because the latest-tag check before uploading failed without finding production moved: it couldn't read the tags, or the latest \`v*\` tag isn't a \`vX.Y.Z\` release (its log says which). Once that's resolved, ${rerun}.`;
    }
    return `${name} built but did not upload (\`${row.upload}\`; the job's log says why). Once the cause is fixed, ${rerun}.`;
  }
  if (tag.beforeBuild === "failure") {
    return `${name} didn't start: the latest-tag check before building failed without finding production moved: it couldn't read the tags, or the latest \`v*\` tag isn't a \`vX.Y.Z\` release (its log says which). Once that's resolved, ${rerun}.`;
  }
  return `${name} didn't build (\`${row.status}\`). Once the cause is fixed, ${rerun}.`;
}

/** The run summary: what was built, uploaded and recorded, and what's left. */
export function summary({ sha, rows, entries, pr, problems, tags = {} }) {
  const lines = [`### Store builds — \`${sha}\``, ""];
  lines.push("| Platform | Status | Version (build) | Upload | Recorded |");
  lines.push("| --- | --- | --- | --- | --- |");
  // From the PR's outcome, not the plan: a planned entry whose PR never
  // opened is not recorded, and the block below lists it.
  const recordedAs = (r) => {
    if (!r.planned) return "no";
    if (pr?.outcome === "opened") return "in the PR";
    if (pr?.outcome === "already-recorded") return "already listed";
    return "**no**, see below";
  };
  for (const r of rows) {
    const version = r.version || r.build ? `${r.version ?? "?"} (${r.build ?? "?"})` : "—";
    lines.push(`| ${DISPLAY[r.store]} | \`${r.status}\` | ${version} | \`${r.upload}\` | ${recordedAs(r)} |`);
  }
  lines.push("");
  lines.push("> Production and the version tag don't depend on anything here: a failure leaves both as they are.", "");
  const uploaded = rows.some((r) => r.upload === "success");
  if (pr?.outcome === "opened" && pr.autoMerge) {
    lines.push(`**Recorded in ${pr.url}.** It merges itself once the \`confirm\` job sees every upload finish.`, "");
  } else if (pr?.outcome === "opened") {
    lines.push(`**Recorded in ${pr.url}.** Merge it before any tester installs these builds.`, "");
  } else if (pr?.outcome === "already-recorded") {
    lines.push(`Every submitted build is already listed in \`${REGISTRY_PATH}\` on \`main\`; no PR was needed.`, "");
  } else if (!uploaded) {
    lines.push("Nothing was uploaded, so nothing was recorded.", "");
  }
  for (const r of rows) {
    const step = nextStep(r, { sha, tag: tags[r.store] });
    if (step) lines.push(`- ${step}`);
  }
  if (problems.length > 0) {
    lines.push("", "**Problems:**", ...problems.map((p) => `- ${p}`));
  }
  if (entries.length > 0 && pr?.outcome !== "opened" && pr?.outcome !== "already-recorded") {
    lines.push(
      "",
      `**Not recorded.** Add these entries to \`${REGISTRY_PATH}\` in a PR before any tester installs the builds:`,
      "",
      "```json",
      ...entries.map((e) => JSON.stringify(e)),
      "```",
    );
  }
  return `${lines.join("\n")}\n`;
}

/** The job's work, with its I/O injected. Returns the exit code. */
export async function recordShippedBuilds({ env, fetchImpl = fetch, now = new Date(), writeSummary, writeOutput = () => {}, log = console.log }) {
  const sha = env.DEPLOY_SHA ?? "";
  if (!/^[0-9a-f]{40}$/.test(sha)) {
    log(`::error::DEPLOY_SHA must be a full 40-character commit SHA; got '${sha}'.`);
    return 1;
  }
  const jobs = {};
  const tags = {};
  for (const store of ["ios", "android"]) {
    const key = store.toUpperCase();
    jobs[store] = { result: env[`${key}_RESULT`] ?? "", build: parseBuild(env[`${key}_BUILD`]), upload: env[`${key}_UPLOAD`] ?? "" };
    tags[store] = {
      moved: env[`${key}_TAG_MOVED`] === "true",
      beforeBuild: env[`${key}_TAG_BEFORE_BUILD`],
      beforeUpload: env[`${key}_TAG_BEFORE_UPLOAD`],
    };
  }
  const plan = planRecord({ jobs, platform: env.PLATFORM, sha, recorded: now.toISOString().slice(0, 10) });
  const problems = [...plan.problems];

  let pr = null;
  if (plan.entries.length > 0) {
    if (!env.GH_TOKEN) {
      problems.push("No base-sync App token (its mint step failed), so the PR could not be opened.");
    } else {
      try {
        pr = await openRecordPr({
          token: env.GH_TOKEN,
          repo: env.GITHUB_REPOSITORY,
          fetchImpl,
          entries: plan.entries,
          sha,
          runUrl: env.RUN_URL,
          runId: env.RUN_ID,
          runAttempt: env.RUN_ATTEMPT,
          autoMerge: env.AUTO_MERGE === "true",
        });
      } catch (error) {
        problems.push(`The shipped-builds PR could not be opened: ${error.message}`);
      }
    }
  }

  writeSummary(summary({ sha, rows: plan.rows, entries: plan.entries, pr, problems, tags }));
  for (const problem of problems) log(`::error::${problem}`);
  if (pr?.outcome === "opened") log(`Opened ${pr.url} from ${pr.branch}.`);
  if (pr?.outcome === "opened" && Number.isInteger(pr.number)) writeOutput(`pr=${pr.number}\n`);
  return problems.length > 0 ? 1 : 0;
}

async function main() {
  const summaryPath = process.env.GITHUB_STEP_SUMMARY;
  const outputPath = process.env.GITHUB_OUTPUT;
  const code = await recordShippedBuilds({
    env: process.env,
    writeSummary: (text) => (summaryPath ? appendFileSync(summaryPath, text) : process.stdout.write(text)),
    writeOutput: (text) => outputPath && appendFileSync(outputPath, text),
  });
  process.exitCode = code;
}

if (isInvokedDirectly(import.meta.url)) {
  await main();
}
