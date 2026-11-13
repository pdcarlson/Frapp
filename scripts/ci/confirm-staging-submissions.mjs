#!/usr/bin/env node
// Confirm the store uploads a "Staging app" run started, and say which finished (#4917 step 3).
//
// The build jobs hand each Frapp Staging binary to EAS Submit with `--no-wait`, because Expo's
// free plan queues a submission for about 47 minutes before it uploads anything
// (`confirm-store-submissions.mjs`, whose polling, retry of a store server error and redacted log
// tail this reuses). This waits out the queue and writes one output per platform. The job then
// uploads a marker artifact for each platform that FINISHED, which is the record
// `plan-staging-app.mjs` reads: a binary counts as uploaded only once the store has it.
//
// Its summary is its own. The production script's next steps are about the record PR and the
// `v*` tag, and neither exists for the staging app: an upload that failed here is fixed by running
// the workflow again with that platform chosen.
//
// Exits 1 when an upload the build job reported didn't finish, so the run shows red.
//
// Env: EXPO_TOKEN; IOS_UPLOAD, IOS_SUBMISSION, ANDROID_UPLOAD, ANDROID_SUBMISSION (each build
// job's upload outcome and submission id); DEADLINE_MINUTES, POLL_SECONDS; GITHUB_OUTPUT,
// GITHUB_STEP_SUMMARY.

import { appendFileSync } from "node:fs";
import { setTimeout as delay } from "node:timers/promises";
import { pollSubmissions } from "./confirm-store-submissions.mjs";
import { isInvokedDirectly } from "./lib/invoked-directly.mjs";

const ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const NAME = { ios: "iOS", android: "Android" };
const STORE = { ios: "TestFlight", android: "the Play internal track" };
const SUBMISSIONS_URL = "https://expo.dev/accounts/pdcarlson/projects/frapp/submissions";
const oneLine = (text) => String(text ?? "").replace(/\s+/g, " ").replace(/::/g, ": :").slice(0, 300);

/** One sentence per platform the build job uploaded. */
export function describe(row) {
  const name = NAME[row.store];
  if (row.status === "FINISHED") return `${name}: uploaded to ${STORE[row.store]}. The store still processes it before it shows up to install.`;
  const again = `Run **Staging app** again with build \`${row.store}\` once the cause is fixed.`;
  if (row.status === "no-id") return `${name}: EAS accepted the upload but printed no submission link, so nothing checked it. Find it at ${SUBMISSIONS_URL}. No binary was recorded, so the next run builds this platform again.`;
  if (row.status === "bad-id") return `${name}: the submission id \`${oneLine(row.id)}\` is not an EAS id, so it couldn't be checked. Find it at ${SUBMISSIONS_URL}.`;
  const url = `${SUBMISSIONS_URL}/${row.id}`;
  if (row.status === "ERRORED" || row.status === "CANCELED") {
    const why = row.error?.message ? `: ${oneLine(row.error.message)}` : "";
    return `${name}: the upload ${row.status === "ERRORED" ? "failed" : "was cancelled"}${why}. ${again} Details: ${url}`;
  }
  return `${name}: the submission was still \`${oneLine(row.status)}\` when this job stopped waiting${row.readError ? ` (${oneLine(row.readError)})` : ""}. Check ${url}. No binary was recorded, so the next run builds this platform again, even if this upload finishes.`;
}

export async function main({ env, fetchImpl = fetch, now = Date.now, sleep = delay, write = appendFileSync, log = console.log }) {
  const toPoll = [];
  const rows = [];
  for (const store of ["ios", "android"]) {
    const key = store.toUpperCase();
    const id = (env[`${key}_SUBMISSION`] ?? "").trim();
    if (env[`${key}_UPLOAD`] !== "success") continue;
    if (id === "") rows.push({ store, id, status: "no-id" });
    else if (!ID.test(id)) rows.push({ store, id, status: "bad-id" });
    else toPoll.push({ store, id });
  }
  if (toPoll.length === 0 && rows.length === 0) {
    log("::error::No upload succeeded, so there is nothing to confirm.");
    return 1;
  }
  if (toPoll.length > 0 && !env.EXPO_TOKEN) {
    log("::error::EXPO_TOKEN is empty, so no submission can be read.");
    return 1;
  }
  const positive = (value, fallback) => (Number(value) > 0 ? Number(value) : fallback);
  if (toPoll.length > 0) {
    rows.push(
      ...(await pollSubmissions({
        submissions: toPoll,
        token: env.EXPO_TOKEN,
        fetchImpl,
        deadlineMs: positive(env.DEADLINE_MINUTES, 150) * 60_000,
        pollMs: positive(env.POLL_SECONDS, 60) * 1000,
        now,
        sleep,
        log,
      })),
    );
  }
  rows.sort((a, b) => (a.store === b.store ? 0 : a.store === "ios" ? -1 : 1));
  const finished = (store) => rows.some((r) => r.store === store && r.status === "FINISHED");
  if (env.GITHUB_OUTPUT) write(env.GITHUB_OUTPUT, `ios=${finished("ios")}\nandroid=${finished("android")}\n`);
  const text = `### Store uploads\n\n${rows.map((r) => `- ${describe(r)}`).join("\n")}\n`;
  if (env.GITHUB_STEP_SUMMARY) write(env.GITHUB_STEP_SUMMARY, text);
  else log(text);
  const unfinished = rows.filter((r) => r.status !== "FINISHED");
  for (const r of unfinished) log(`::error::${describe(r)}`);
  return unfinished.length > 0 ? 1 : 0;
}

if (isInvokedDirectly(import.meta.url)) {
  process.exitCode = await main({ env: process.env });
}
