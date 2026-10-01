#!/usr/bin/env node

// Record the store builds a Deploy production run uploaded (#3111).
//
// `_mobile-build.yml`'s `build` job builds the commit production now serves on
// EAS and uploads it to TestFlight and the Play internal track. Every build
// uploaded there must be listed in `apps/mobile/store/shipped-builds.json`
// before a tester can install it, because that list arms the required
// `api-contract-check` gate (`apps/mobile/store/README.md` § Shipped builds and
// the API contract). This is the `record` job's whole work: it turns each
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
// A build is recorded when EAS reports it `FINISHED` and its upload step
// succeeded. Anything else is reported and left out:
//   * a build that didn't finish, or whose upload failed or never ran: it is
//     on no store track, and the README's rule is to record a build when it is
//     first uploaded. The build job is already red for it, and the summary
//     says how to finish by hand;
//   * a build EAS made from any commit but the validated SHA: refused, and
//     this job fails. That is the "never newer than production" rule failing,
//     and it must not become an entry that says otherwise.
// The values are EAS's own (`appVersion`, `appBuildVersion`), the version and
// build number the binary sends in `X-Client-Version`, and the result is
// validated with the checker's own `parseRegistry` before it is written.
//
// ── How it fails ────────────────────────────────────────────────────────────
// Exits 1 when a build it should record can't be (no token, an API refusal, a
// wrong commit, a malformed version), and the summary then lists the entries
// to add by hand. Exits 0 when everything uploaded is recorded, including when
// nothing was uploaded: the build job's own red row carries that failure. A
// build job that succeeded but handed over no builds is a wiring fault, and
// exits 1.
//
// Env inputs:
//   EAS_BUILDS_IOS, EAS_BUILDS_ANDROID
//                     — `needs.build.outputs.ios-builds` / `android-builds`:
//                       each platform's `eas build --json` list, cut to
//                       `{ id, platform, status, appVersion, appBuildVersion,
//                       gitCommitHash }`; empty when that build listed nothing
//                       or didn't run
//   BUILD_RESULT      — `needs.build.result`
//   PLATFORM          — the requested platform: ios, android or all
//   IOS_UPLOAD        — the iOS upload step's outcome, empty when it didn't run
//   ANDROID_UPLOAD    — the Android upload step's outcome, the same
//   DEPLOY_SHA        — the validated SHA the run shipped and built
//   GH_TOKEN          — the base-sync App token; empty when the mint failed
//   GITHUB_REPOSITORY — owner/repo
//   RUN_URL, RUN_ID, RUN_ATTEMPT — this run, for the branch, the PR and the summary
//   GITHUB_STEP_SUMMARY — where the summary goes

import { appendFileSync } from "node:fs";
import { parseRegistry } from "../check-api-breaking-changes.mjs";
import { ghRequest } from "./lib/github.mjs";
import { isInvokedDirectly } from "./lib/invoked-directly.mjs";

export const REGISTRY_PATH = "apps/mobile/store/shipped-builds.json";

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
 * One platform's build list as an array, or null when there is no usable
 * list (empty, not JSON, not an array of objects).
 */
export function parseBuilds(raw) {
  if (typeof raw !== "string" || raw.trim() === "") return null;
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!Array.isArray(parsed)) return null;
  if (!parsed.every((b) => b !== null && typeof b === "object" && !Array.isArray(b))) return null;
  return parsed;
}

/**
 * Decide, per requested platform, what was built, what was uploaded and what
 * gets recorded.
 *
 * @returns {{ rows: object[], entries: object[], problems: string[] }}
 *   `rows` feed the summary, one per requested platform; `entries` are the
 *   `shipped-builds.json` entries to add; `problems` fail the job.
 */
export function planRecord({ builds, platform, uploads, sha, recorded, buildResult }) {
  const rows = [];
  const entries = [];
  const problems = [];
  const requested = PLATFORMS_FOR[platform];
  if (!requested) {
    return { rows, entries, problems: [`PLATFORM must be ios, android or all; got '${platform}'.`] };
  }
  if (builds === null && buildResult === "success") {
    problems.push(
      "The build job succeeded but handed over no build list (`needs.build.outputs.ios-builds` and `android-builds` are empty or not JSON arrays). Nothing can be recorded from them; read the build job's log for the EAS build ids.",
    );
  }

  for (const store of requested) {
    const matches = (builds ?? []).filter((b) => b.platform === EAS_PLATFORM[store]);
    const upload = uploads[store] || "not run";
    const row = { store, buildId: null, status: "not built", version: null, build: null, upload, recorded: false, refused: false };
    rows.push(row);

    if (matches.length > 1) {
      problems.push(`EAS listed ${matches.length} ${DISPLAY[store]} builds for one run; expected one.`);
      continue;
    }
    const [found] = matches;
    if (!found) {
      if (builds !== null && buildResult === "success") {
        problems.push(`${DISPLAY[store]} was requested, and the build job reported no ${DISPLAY[store]} build.`);
      }
      continue;
    }

    row.buildId = typeof found.id === "string" ? found.id : null;
    row.status = typeof found.status === "string" ? found.status : "unknown";
    row.version = typeof found.appVersion === "string" ? found.appVersion : null;
    row.build = typeof found.appBuildVersion === "string" ? found.appBuildVersion : null;

    // Checked before anything else about a build: a binary from another
    // commit may be newer than production, and recording it would say the
    // opposite.
    if (found.gitCommitHash !== sha) {
      row.refused = true;
      problems.push(
        `EAS built ${DISPLAY[store]} (${row.buildId ?? "no id"}) from ${found.gitCommitHash ?? "an unreported commit"}, not the validated ${sha}. Not recorded. Don't let testers install it: it may call routes production doesn't serve.`,
      );
      continue;
    }
    if (row.status !== "FINISHED" || upload !== "success") continue;

    if (!row.version || !/^\d+\.\d+\.\d+$/.test(row.version) || !row.build || !/^[1-9]\d*$/.test(row.build)) {
      problems.push(
        `EAS reported ${DISPLAY[store]} version '${row.version}' and build '${row.build}' for ${row.buildId}, which shipped-builds.json can't hold. Record it by hand from the EAS build page.`,
      );
      continue;
    }
    entries.push({ platform: store, version: row.version, build: row.build, sha, recorded });
    row.recorded = true;
  }
  return { rows, entries, problems };
}

/** The `<platform>/<version>+<build>` key the checker uses for a duplicate. */
const keyOf = (b) => `${b.platform}/${b.version}+${b.build}`;

/**
 * The registry with `entries` appended, as file text, and which entries were
 * new. An entry already listed (a re-run after the PR merged) is not added
 * twice. Throws when the current file or the result fails `parseRegistry`.
 */
export function mergeRegistry(text, entries) {
  const { builds } = parseRegistry(text);
  const listed = new Set(builds.map(keyOf));
  const added = entries.filter((e) => !listed.has(keyOf(e)));
  const merged = { builds: [...builds, ...added] };
  const next = `${JSON.stringify(merged, null, 2)}\n`;
  parseRegistry(next);
  return { text: next, added };
}

const label = (e) => `${DISPLAY[e.platform]} ${e.version} (${e.build})`;

export function branchName({ runId, runAttempt }) {
  return `shipped-builds/run-${runId}-${runAttempt}`;
}

export function prTitle(entries) {
  return `chore(mobile): record ${entries.map(label).join(" and ")} in shipped-builds.json`;
}

export function prBody({ entries, rows, sha, runUrl, repo }) {
  const byStore = new Map(rows.map((r) => [r.store, r]));
  return [
    `[Deploy production](${runUrl}) shipped \`${sha}\`, built it on EAS, and uploaded these builds without releasing them:`,
    "",
    "| Platform | Version | Build | Uploaded to | EAS build |",
    "| --- | --- | --- | --- | --- |",
    ...entries.map(
      (e) => `| ${DISPLAY[e.platform]} | ${e.version} | ${e.build} | ${STORE[e.platform]} | \`${byStore.get(e.platform)?.buildId ?? "unknown"}\` |`,
    ),
    "",
    `This adds one \`${REGISTRY_PATH}\` entry per uploaded build, so this PR's \`api-contract-check\` holds the API to the contract at \`${sha}\` ([\`apps/mobile/store/README.md\` § Shipped builds and the API contract](https://github.com/${repo}/blob/main/apps/mobile/store/README.md#shipped-builds-and-the-api-contract)). Merge it before any tester installs one of these builds: until then the gate doesn't protect them.`,
    "",
    `**If \`api-contract-check\` fails here,** \`main\` has already changed the API in a way these builds can't take (it is ahead of \`${sha}\`). Fix that on \`main\` before the next production ship, or waive a route no shipped binary calls as the README says, then re-run the check. Don't merge around it.`,
    "",
    "Opened by `_mobile-build.yml`'s `record` job; the registry entries are the only change.",
  ].join("\n");
}

/**
 * Open the pull request that adds `entries`, from `main`'s current tip.
 *
 * @returns {Promise<{ outcome: "opened", url: string, branch: string } | { outcome: "already-recorded" }>}
 * @throws {Error} naming the call that failed
 */
export async function openRecordPr({ token, repo, fetchImpl, entries, rows, sha, runUrl, runId, runAttempt }) {
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
    message: `${title}\n\nUploaded by Deploy production: ${runUrl}`,
    content: Buffer.from(text, "utf8").toString("base64"),
    sha: file.sha,
    branch,
  });
  const pr = await call("POST", `/repos/${repo}/pulls`, {
    title,
    head: branch,
    base: "main",
    body: prBody({ entries: added, rows, sha, runUrl, repo }),
  });
  if (typeof pr?.html_url !== "string") throw new Error("POST /pulls returned no pull request URL.");
  return { outcome: "opened", url: pr.html_url, branch };
}

/** The run summary: what was built, uploaded and recorded, and what's left. */
export function summary({ sha, rows, entries, pr, problems }) {
  const lines = [`### Store builds — \`${sha}\``, ""];
  lines.push("| Platform | EAS build | Status | Version (build) | Upload | Recorded |");
  lines.push("| --- | --- | --- | --- | --- | --- |");
  for (const r of rows) {
    const version = r.version || r.build ? `${r.version ?? "?"} (${r.build ?? "?"})` : "—";
    lines.push(
      `| ${DISPLAY[r.store]} | ${r.buildId ? `\`${r.buildId}\`` : "—"} | \`${r.status}\` | ${version} | \`${r.upload}\` | ${r.recorded ? "yes" : "no"} |`,
    );
  }
  lines.push("");
  lines.push(
    "> Production and the version tag don't depend on anything here: a failure leaves both as they are.",
    "",
  );
  if (pr?.outcome === "opened") {
    lines.push(`**Recorded in ${pr.url}.** Merge it before any tester installs these builds.`, "");
  } else if (pr?.outcome === "already-recorded") {
    lines.push(`Every uploaded build is already listed in \`${REGISTRY_PATH}\` on \`main\`; no PR was needed.`, "");
  } else if (entries.length === 0) {
    lines.push("Nothing was uploaded, so nothing was recorded.", "");
  }
  for (const r of rows) {
    if (r.recorded || r.refused || r.status !== "FINISHED" || r.upload === "success" || !r.buildId) continue;
    lines.push(
      `- ${DISPLAY[r.store]} built but did not upload (\`${r.upload}\`). After fixing the cause, upload it by hand with \`eas submit --platform ${r.store} --profile production --id ${r.buildId}\` from \`apps/mobile\`, then record it as \`apps/mobile/store/README.md\` § Shipped builds says.`,
    );
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
export async function recordShippedBuilds({ env, fetchImpl = fetch, now = new Date(), writeSummary, log = console.log }) {
  const sha = env.DEPLOY_SHA ?? "";
  if (!/^[0-9a-f]{40}$/.test(sha)) {
    log(`::error::DEPLOY_SHA must be a full 40-character commit SHA; got '${sha}'.`);
    return 1;
  }
  const lists = [parseBuilds(env.EAS_BUILDS_IOS), parseBuilds(env.EAS_BUILDS_ANDROID)];
  const builds = lists.every((l) => l === null) ? null : lists.flatMap((l) => l ?? []);
  const plan = planRecord({
    builds,
    platform: env.PLATFORM,
    uploads: { ios: env.IOS_UPLOAD, android: env.ANDROID_UPLOAD },
    sha,
    recorded: now.toISOString().slice(0, 10),
    buildResult: env.BUILD_RESULT,
  });
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
          rows: plan.rows,
          sha,
          runUrl: env.RUN_URL,
          runId: env.RUN_ID,
          runAttempt: env.RUN_ATTEMPT,
        });
      } catch (error) {
        problems.push(`The shipped-builds PR could not be opened: ${error.message}`);
      }
    }
  }

  writeSummary(summary({ sha, rows: plan.rows, entries: plan.entries, pr, problems }));
  for (const problem of problems) log(`::error::${problem}`);
  if (pr?.outcome === "opened") log(`Opened ${pr.url} from ${pr.branch}.`);
  return problems.length > 0 ? 1 : 0;
}

async function main() {
  const summaryPath = process.env.GITHUB_STEP_SUMMARY;
  const code = await recordShippedBuilds({
    env: process.env,
    writeSummary: (text) => (summaryPath ? appendFileSync(summaryPath, text) : process.stdout.write(text)),
  });
  process.exitCode = code;
}

if (isInvokedDirectly(import.meta.url)) {
  await main();
}
