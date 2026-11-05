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
// Exits 0 only when every submission it was given FINISHED. An errored or
// cancelled submission, one still queued at the deadline, or one it could
// never read, fails the job, so the run shows red and its summary says what to
// do. The record PR has already listed that build by then: the summary says to
// drop its entry before merging, or to upload it again by hand.
//
// FINISHED means the binary reached App Store Connect or Google Play, not that
// it passed their processing. App Store Connect can still reject an iOS
// binary afterwards by email (ITMS-90683 rejected iOS 0.9.1 (8) that way), and
// nothing here can see that.
//
// It reads EAS's GraphQL API with EXPO_TOKEN directly, because eas-cli 24.8
// has no command that shows one submission (`eas build:view` omits them). It
// runs from the trusted ref with no install, so the token reaches no code
// from the built commit and no installed package.
//
// Env:
//   EXPO_TOKEN          — the robot token the build job uses
//   IOS_SUBMISSION      — the iOS upload step's submission id, empty when none
//   ANDROID_SUBMISSION  — the Android upload step's submission id, the same
//   DEADLINE_MINUTES    — stop polling after this long (default 280)
//   POLL_SECONDS        — wait between rounds (default 60)
//   GITHUB_STEP_SUMMARY — where the summary goes

import { appendFileSync } from "node:fs";
import { setTimeout as delay } from "node:timers/promises";
import { isInvokedDirectly } from "./lib/invoked-directly.mjs";

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
const DISPLAY = Object.freeze({ ios: "iOS", android: "Android" });
const STORE = Object.freeze({ ios: "TestFlight", android: "the Play internal track" });
const ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const READ_TIMEOUT_MS = 30_000;

/**
 * One read of a submission. Returns `{ status, error }`, or `{ readError }`
 * when the API couldn't be read; a read error is retried on the next round.
 */
export async function readSubmission({ id, token, fetchImpl = fetch }) {
  let res;
  try {
    res = await fetchImpl(GRAPHQL_URL, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
      body: JSON.stringify({ query: QUERY, variables: { id } }),
      signal: AbortSignal.timeout(READ_TIMEOUT_MS),
    });
  } catch (error) {
    return { readError: `request failed: ${error.message}` };
  }
  if (!res.ok) return { readError: `HTTP ${res.status}` };
  let body;
  try {
    body = await res.json();
  } catch {
    return { readError: "the response was not JSON" };
  }
  if (Array.isArray(body?.errors) && body.errors.length > 0) {
    return { readError: body.errors.map((e) => e?.message ?? "unknown error").join("; ") };
  }
  const submission = body?.data?.submissions?.byId;
  if (!submission || typeof submission.status !== "string") return { readError: "the response named no submission" };
  return { status: submission.status, error: submission.error ?? null };
}

/**
 * Poll every submission until each is terminal or the deadline passes.
 * Returns one row per submission: `{ store, id, status, error, readError }`,
 * with `status` the last one read (or `unread`).
 */
export async function pollSubmissions({ submissions, token, fetchImpl = fetch, deadlineMs, pollMs, now = Date.now, sleep = delay, log = console.log }) {
  const rows = submissions.map(({ store, id }) => ({ store, id, status: "unread", error: null, readError: null }));
  const stopAt = now() + deadlineMs;
  for (;;) {
    for (const row of rows) {
      if (TERMINAL.has(row.status)) continue;
      const read = await readSubmission({ id: row.id, token, fetchImpl });
      if (read.readError) {
        row.readError = read.readError;
        log(`${DISPLAY[row.store]} submission ${row.id}: couldn't read it (${read.readError}); trying again next round.`);
        continue;
      }
      row.readError = null;
      if (read.status !== row.status) log(`${DISPLAY[row.store]} submission ${row.id}: ${read.status}.`);
      row.status = read.status;
      row.error = read.error;
    }
    if (rows.every((r) => TERMINAL.has(r.status))) return rows;
    if (now() + pollMs > stopAt) return rows;
    await sleep(pollMs);
  }
}

/** What a person does about one row that didn't finish. */
export function nextStep(row) {
  const name = DISPLAY[row.store];
  const url = `https://expo.dev/accounts/pdcarlson/projects/frapp/submissions/${row.id}`;
  if (row.status === "FINISHED") return null;
  if (row.status === "ERRORED" || row.status === "CANCELED") {
    const why = row.error?.message ? `: ${row.error.message}${row.error.errorCode ? ` (\`${row.error.errorCode}\`)` : ""}` : "";
    return `${name}'s upload to ${STORE[row.store]} ${row.status === "ERRORED" ? "failed" : "was cancelled"}${why}. The record PR lists this build, so drop its entry before merging, or upload it again by hand (\`docs/ops/deployment/mobile.md\` § 6.6) and keep it. Details: ${url}`;
  }
  return `${name}'s submission was still \`${row.status}\` when this job stopped waiting${row.readError ? ` (last read failed: ${row.readError})` : ""}. It may still finish: check ${url}. If it finishes, the record PR is right as it is; if it fails, drop its entry before merging.`;
}

/** The run summary. */
export function summary(rows) {
  const lines = ["## Store uploads", "", "| Platform | Submission | Status |", "| --- | --- | --- |"];
  for (const r of rows) lines.push(`| ${DISPLAY[r.store]} | \`${r.id}\` | \`${r.status}\` |`);
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
  const submissions = [];
  const problems = [];
  for (const store of ["ios", "android"]) {
    const id = (env[`${store.toUpperCase()}_SUBMISSION`] ?? "").trim();
    if (id === "") continue;
    if (!ID.test(id)) problems.push(`${DISPLAY[store]}'s submission id '${id}' is not an EAS id, so it can't be checked.`);
    else submissions.push({ store, id });
  }
  if (!env.EXPO_TOKEN) problems.push("EXPO_TOKEN is empty, so no submission can be read.");
  if (problems.length > 0 || submissions.length === 0) {
    if (submissions.length === 0 && problems.length === 0) problems.push("No submission id reached this job, so there is nothing to confirm.");
    for (const p of problems) log(`::error::${p}`);
    writeSummary(`## Store uploads\n\n${problems.map((p) => `- ${p}`).join("\n")}\n`);
    return 1;
  }
  const minutes = (value, fallback) => {
    const n = Number(value);
    return Number.isFinite(n) && n > 0 ? n : fallback;
  };
  const rows = await pollSubmissions({
    submissions,
    token: env.EXPO_TOKEN,
    fetchImpl,
    deadlineMs: minutes(env.DEADLINE_MINUTES, 280) * 60_000,
    pollMs: minutes(env.POLL_SECONDS, 60) * 1000,
    now,
    sleep,
    log,
  });
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
