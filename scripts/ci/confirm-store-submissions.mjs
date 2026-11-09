#!/usr/bin/env node
// Confirm the store submissions a Deploy production run started (#3483).
//
// `_mobile-build.yml`'s upload steps hand each finished build to EAS Submit
// with `--no-wait`: EAS accepts the submission and the step ends, because
// Expo's free plan queues a submission for about 47 minutes before it uploads
// anything (2026-11-05), longer than a CI step should sit holding the job.
// The `record` job records a build once EAS accepts its submission. This
// script, in the `confirm` job, then waits out the queue: it polls each
// submission until EAS reports it FINISHED, ERRORED or CANCELED, or the
// deadline passes, and writes the result to the run summary.
//
// It checks every platform whose upload step succeeded. Exits 0 only when
// each of those has a submission id and FINISHED. An upload that succeeded
// with no id (eas printed no details link), an errored or cancelled
// submission, one still queued at the deadline, or one it couldn't read
// fails the job, so the run shows red and its summary says what to do. The
// record PR has already listed that build by then: the summary says to drop
// its entry, before merging or in a PR of its own, or to upload it again by
// hand and keep it.
//
// FINISHED means the binary reached App Store Connect or Google Play, not that
// it passed their processing. App Store Connect can still reject an iOS
// binary afterwards by email (ITMS-90683 rejected iOS 0.9.1 (8) that way), and
// nothing here can see that.
//
// It reads EAS's GraphQL API with EXPO_TOKEN directly rather than through
// `eas submit:view --json`, so the job installs nothing: eas-cli's own
// dependencies aren't locked (#3118), and here they would run with the token.
// The query is the shape of eas-cli 24.8.0's `SubmissionQuery.byIdAsync`;
// recheck it when the pinned eas-cli moves. It runs from the trusted ref, so
// the token reaches no code from the built commit.
//
// Env:
//   EXPO_TOKEN          — the robot token the build job uses
//   IOS_UPLOAD          — the iOS upload step's outcome (`success` when EAS accepted it)
//   IOS_SUBMISSION      — that step's submission id, empty when none
//   IOS_BUILD           — the iOS EAS build id, for the summary's re-upload command
//   ANDROID_UPLOAD, ANDROID_SUBMISSION, ANDROID_BUILD — the same for Android
//   DEADLINE_MINUTES    — stop polling after this long (default 280)
//   POLL_SECONDS        — wait between rounds (default 60)
//   GITHUB_STEP_SUMMARY — where the summary goes

import { appendFileSync } from "node:fs";
import { setTimeout as delay } from "node:timers/promises";
import { fetchWithRetry, isRetriableStatus } from "./lib/http.mjs";
import { isInvokedDirectly } from "./lib/invoked-directly.mjs";
import { pollUntilTerminal } from "./lib/polling.mjs";

export const GRAPHQL_URL = "https://api.expo.dev/graphql";
const QUERY = `query ConfirmSubmission($id: ID!) {
  submissions {
    byId(submissionId: $id) {
      id
      status
      error { errorCode message }
    }
  }
}`;

/** EAS's terminal submission states. Anything else is still on its way. */
export const TERMINAL = new Set(["FINISHED", "ERRORED", "CANCELED"]);
/**
 * Rounds in a row a submission may fail to read, with an answer that asking
 * again won't change (a 4xx, a GraphQL error), before this job stops asking.
 * A dropped connection, a 429 or a 5xx never counts: fetchWithRetry has
 * already retried it, and an Expo API blip mustn't end the wait early.
 */
export const MAX_FAILED_READS = 10;
const DISPLAY = Object.freeze({ ios: "iOS", android: "Android" });
const STORE = Object.freeze({ ios: "TestFlight", android: "the Play internal track" });
const ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const READ_TIMEOUT_MS = 30_000;
const SUBMISSIONS_URL = "https://expo.dev/accounts/pdcarlson/projects/frapp/submissions";
// A GraphQL read changes nothing, so a lost response may be asked again.
const RETRY_POST = new Set(["POST"]);

/** One line, so text from EAS can't start a workflow command of its own. */
const oneLine = (text) => String(text).replace(/[\r\n]+/g, " ").trim();

/**
 * One read of a submission, with fetchWithRetry's bounded retry on a dropped
 * connection, a 429 or a 5xx. Returns `{ status, error }`, or `{ readError,
 * lasting }` when the API couldn't be read, `lasting` when asking again won't
 * change the answer.
 */
export async function readSubmission({ id, token, fetchImpl = fetch, sleep = delay }) {
  let res;
  try {
    res = await fetchWithRetry(
      GRAPHQL_URL,
      {
        method: "POST",
        headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
        body: JSON.stringify({ query: QUERY, variables: { id } }),
      },
      { fetchImpl, sleep, timeoutMs: READ_TIMEOUT_MS, retryMethods: RETRY_POST },
    );
  } catch (error) {
    return { readError: `request failed: ${oneLine(error.message)}` };
  }
  if (!res.ok) return { readError: `HTTP ${res.status}`, lasting: !isRetriableStatus(res.status) };
  let body;
  try {
    body = await res.json();
  } catch {
    return { readError: "the response was not JSON" };
  }
  if (Array.isArray(body?.errors) && body.errors.length > 0) {
    const lasting = !body.errors.some((e) => e?.extensions?.isTransient === true);
    return { readError: oneLine(body.errors.map((e) => e?.message ?? "unknown error").join("; ")), lasting };
  }
  const submission = body?.data?.submissions?.byId;
  if (!submission || typeof submission.status !== "string") return { readError: "the response named no submission" };
  return { status: oneLine(submission.status), error: submission.error ?? null };
}

/** A row this job has stopped asking about. */
const settled = (row) => TERMINAL.has(row.status) || row.failedReads >= MAX_FAILED_READS;

/**
 * Poll every submission until each is terminal, or has gone unread
 * MAX_FAILED_READS rounds in a row, or the deadline passes. Returns one row per
 * submission: `{ store, id, build, status, error, readError, failedReads }`,
 * with `status` the last one read (or `unread`).
 */
export async function pollSubmissions({ submissions, token, fetchImpl = fetch, deadlineMs, pollMs, now = Date.now, sleep = delay, log = console.log }) {
  const rows = submissions.map(({ store, id, build = "" }) => ({ store, id, build, status: "unread", error: null, readError: null, failedReads: 0 }));
  const readRound = async () => {
    for (const row of rows) {
      if (settled(row)) continue;
      const read = await readSubmission({ id: row.id, token, fetchImpl, sleep });
      if (read.readError) {
        row.readError = read.readError;
        if (read.lasting) row.failedReads += 1;
        const next = row.failedReads >= MAX_FAILED_READS ? `giving up after ${MAX_FAILED_READS} failed rounds` : "trying again next round";
        log(`${DISPLAY[row.store]} submission ${row.id}: couldn't read it (${read.readError}); ${next}.`);
        continue;
      }
      row.readError = null;
      row.failedReads = 0;
      if (read.status !== row.status) log(`${DISPLAY[row.store]} submission ${row.id}: ${read.status}.`);
      row.status = read.status;
      row.error = read.error;
    }
    return rows;
  };
  return pollUntilTerminal({
    fetchOne: readRound,
    classify: (state) => (state.every(settled) ? state : null),
    onTimeout: () => rows,
    clock: { now, sleep },
    pollIntervalMs: pollMs,
    overallTimeoutMs: deadlineMs,
    logger: { log },
  });
}

// The same flags CI passes, as `record-shipped-builds.mjs` gives them.
const submitCommand = (store, build) =>
  `\`npm run eas -- submit --platform ${store} --profile production --id ${build} --non-interactive${store === "ios" ? " --no-auto-testflight-setup" : ""}\` from the repo root`;

const DROP =
  "drop its entry from the record PR before merging, or, once that has merged, move it to the registry's `dropped` list with this run as the reason, in a PR of its own (`apps/mobile/store/README.md` § Shipped builds and the API contract)";

/** What a person does about one row that didn't finish. */
export function nextStep(row) {
  const name = DISPLAY[row.store];
  if (row.status === "FINISHED") return null;
  if (row.status === "no-id") {
    return `EAS accepted ${name}'s upload, but \`eas submit\` printed no submission link, so nothing checked it. Find it at ${SUBMISSIONS_URL}. If it finished, the record PR is right as it is. If it failed, ${DROP}.`;
  }
  if (row.status === "bad-id") {
    return `${name}'s submission id \`${oneLine(row.id)}\` is not an EAS id, so it couldn't be checked. Find the submission at ${SUBMISSIONS_URL}.`;
  }
  const url = `${SUBMISSIONS_URL}/${row.id}`;
  if (row.status === "ERRORED" || row.status === "CANCELED") {
    const why = row.error?.message ? `: ${oneLine(row.error.message)}${row.error.errorCode ? ` (\`${oneLine(row.error.errorCode)}\`)` : ""}` : "";
    const again = ID.test(row.build ?? "") ? `with ${submitCommand(row.store, row.build)}` : "by hand";
    return `${name}'s upload to ${STORE[row.store]} ${row.status === "ERRORED" ? "failed" : "was cancelled"}${why}. The record PR lists this build, so ${DROP}. Or, while its commit is still the latest \`v*\` tag, fix the cause, upload it again ${again} (\`docs/ops/deployment/mobile.md\` § 6.6), and keep the entry. Details: ${url}`;
  }
  if (row.failedReads >= MAX_FAILED_READS || row.status === "unread") {
    return `${name}'s submission couldn't be read${row.readError ? ` (${row.readError})` : ""}, so this job doesn't know how it ended. Check ${url}. If it finished, the record PR is right as it is; if it failed, ${DROP}.`;
  }
  return `${name}'s submission was still \`${row.status}\` when this job stopped waiting${row.readError ? ` (its last read failed: ${row.readError})` : ""}. It may still finish: check ${url}. If it finishes, the record PR is right as it is; if it fails, ${DROP}.`;
}

/** The run summary. */
export function summary(rows) {
  const lines = ["## Store uploads", "", "| Platform | Submission | Status |", "| --- | --- | --- |"];
  for (const r of rows) lines.push(`| ${DISPLAY[r.store]} | ${ID.test(r.id) ? `\`${r.id}\`` : "none"} | \`${r.status}\` |`);
  lines.push("");
  const steps = rows.map(nextStep).filter(Boolean);
  if (steps.length === 0) {
    lines.push(
      "Every upload finished. App Store Connect and Google Play still process each binary, and App Store Connect can reject an iOS one by email after this (ITMS-90683 did on 2026-11-05).",
    );
  } else {
    for (const s of steps) lines.push(`- ${s}`);
  }
  return `${lines.join("\n")}\n`;
}

/** The job's work, with its I/O injected. Returns the exit code. */
export async function confirmStoreSubmissions({ env, fetchImpl = fetch, now = Date.now, sleep = delay, writeSummary, log = console.log }) {
  const toPoll = [];
  const unchecked = [];
  for (const store of ["ios", "android"]) {
    const key = store.toUpperCase();
    const id = (env[`${key}_SUBMISSION`] ?? "").trim();
    const uploaded = env[`${key}_UPLOAD`] === "success";
    const build = (env[`${key}_BUILD`] ?? "").trim();
    if (id === "") {
      if (uploaded) unchecked.push({ store, id: "", build, status: "no-id" });
      continue;
    }
    if (!ID.test(id)) unchecked.push({ store, id, build, status: "bad-id" });
    else toPoll.push({ store, id, build });
  }
  const fail = (problem) => {
    log(`::error::${problem}`);
    writeSummary(`## Store uploads\n\n- ${problem}\n`);
    return 1;
  };
  if (toPoll.length === 0 && unchecked.length === 0) return fail("No upload succeeded and no submission id reached this job, so there is nothing to confirm.");
  if (toPoll.length > 0 && !env.EXPO_TOKEN) {
    // Still report every row, so a missing id isn't hidden behind the token.
    log("::error::EXPO_TOKEN is empty, so no submission can be read.");
    for (const r of toPoll) unchecked.push({ ...r, status: "unread", readError: "EXPO_TOKEN is empty", failedReads: MAX_FAILED_READS });
    toPoll.length = 0;
  }
  const positive = (value, fallback) => {
    const n = Number(value);
    return Number.isFinite(n) && n > 0 ? n : fallback;
  };
  const polled =
    toPoll.length === 0
      ? []
      : await pollSubmissions({
          submissions: toPoll,
          token: env.EXPO_TOKEN,
          fetchImpl,
          deadlineMs: positive(env.DEADLINE_MINUTES, 280) * 60_000,
          pollMs: positive(env.POLL_SECONDS, 60) * 1000,
          now,
          sleep,
          log,
        });
  const rows = [...polled, ...unchecked.map((r) => ({ error: null, readError: null, failedReads: 0, ...r }))];
  rows.sort((a, b) => (a.store === b.store ? 0 : a.store === "ios" ? -1 : 1));
  writeSummary(summary(rows));
  const unfinished = rows.filter((r) => r.status !== "FINISHED");
  for (const r of unfinished) log(`::error::${nextStep(r)}`);
  return unfinished.length > 0 ? 1 : 0;
}

if (isInvokedDirectly(import.meta.url)) {
  const summaryPath = process.env.GITHUB_STEP_SUMMARY;
  process.exitCode = await confirmStoreSubmissions({
    env: process.env,
    writeSummary: (text) => (summaryPath ? appendFileSync(summaryPath, text) : process.stdout.write(text)),
  });
}
