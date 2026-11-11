#!/usr/bin/env node
// Posts to the team's Dev log channel in Frapp (#4145): when work starts on an
// issue, when a pull request merges, once a day, and when an update ships.
//
// This script gathers facts from GitHub and sends them to
// `POST /v1/integrations/dev-log`. The API writes the words and the links and
// picks the channel (`apps/api/src/application/services/dev-log.service.ts`),
// and it drops a repeat of the same event, so re-running a job posts nothing
// twice and the POST is safe to retry.
//
// What is skipped: an event from a bot account (Dependabot, an App), an issue
// or pull request labelled `routine-state` or `incident`, a daily summary with
// nothing merged and nothing in progress, and a Deploy production run that did
// not ship (a dry run, a migrations-only run, a failed deploy).
//
// "Who" is the person whose account did it: the one who added `in-progress`,
// or the pull request's author. Agent sessions act under their user's account,
// so that is the person whose chat it was. The GitHub profile name is used
// when the account has one, the login otherwise.
//
// Env:
//   DEV_LOG_EVENT      work_started | pr_merged | daily_summary | update_pushed
//   DEV_LOG_TOKEN      the `automation` environment secret. Empty: says so and
//                      exits 0, so the workflow is green before it is set up.
//   DEV_LOG_API_URL    optional; defaults to production's API.
//   GITHUB_TOKEN, GITHUB_REPOSITORY
//   GITHUB_EVENT_PATH  work_started: the `issues` event payload.
//   GITHUB_SHA         pr_merged: the commit pushed to main.
//   WORKFLOW_RUN_ID    update_pushed: the Deploy production run that finished.
//                      What it shipped is read off that run's jobs.
//
// Exit: 0 posted, skipped, or not set up; 1 the post or a GitHub read failed.
//
// Unit tests: scripts/ci/__tests__/dev-log.test.mjs (`npm run test:ci-scripts`).

import { readFileSync } from "node:fs";

import { requireEnv } from "./lib/env.mjs";
import { ghRequest } from "./lib/github.mjs";
import { fetchWithRetry } from "./lib/http.mjs";
import { isInvokedDirectly } from "./lib/invoked-directly.mjs";

export const DEFAULT_API_URL = "https://api.frapp.live";
export const IN_PROGRESS_LABEL = "in-progress";
/** Labels that mark an item as machinery, not the team's work. */
export const SKIPPED_LABELS = ["routine-state", "incident"];

/**
 * Job names in `deploy-production.yml` and the workflows it calls, as the jobs
 * API reports them (`<caller job> / <called job>`). The tag is minted only
 * after a live `full` ship, so its success is "an update went out"; a dry run
 * and a migrations-only run never reach it. dev-log.test.mjs fails when one of
 * these names leaves its workflow.
 */
export const SHIPPED_JOB = "Mint v* tag (does not roll back a live ship)";
export const STORE_BUILD_JOB = "Build on EAS, then upload to TestFlight / Play internal";
export const OTA_UPDATE_JOB = "Publish the OTA update to the production channel";
const AREA_PREFIX = "area:";

/** The API's caps (`apps/api/src/interface/dtos/dev-log.dto.ts`). */
const TITLE_MAX = 300;
const ACTOR_MAX = 80;
const AREA_MAX = 40;
const AREAS_MAX = 10;
const ALSO_IN_AREA_MAX = 5;
const SUMMARY_ITEMS_MAX = 60;
const MERGED_BY_MAX = 30;
/** The search API returns at most 1000 results, 100 a page. */
const SEARCH_PAGES_MAX = 10;

const DAY_MS = 24 * 60 * 60 * 1000;

const labelNames = (item) =>
  (item?.labels ?? []).map((label) => (typeof label === "string" ? label : label?.name)).filter(Boolean);

export const isBot = (user) => !user || user.type === "Bot" || String(user.login ?? "").endsWith("[bot]");

export const isSkipped = (item) => labelNames(item).some((name) => SKIPPED_LABELS.includes(name));

/** `area:chat` → `chat`, capped to what the API accepts. */
export function areasOf(item) {
  return labelNames(item)
    .filter((name) => name.startsWith(AREA_PREFIX))
    .map((name) => name.slice(AREA_PREFIX.length).slice(0, AREA_MAX))
    .filter(Boolean)
    .slice(0, AREAS_MAX);
}

const clip = (value, max) => String(value ?? "").slice(0, max);

/**
 * GitHub reads, bound to one token and repository. `get` throws on a failed
 * read: a post built from half the facts would be wrong, and a red run says so.
 */
export function createGitHub({ token, repo, fetchImpl = fetch, retryOptions } = {}) {
  const names = new Map();

  async function get(path) {
    const res = await ghRequest({ token, fetchImpl, path, retry: true, retryOptions });
    if (!res.ok) throw new Error(`GitHub GET ${path} failed: HTTP ${res.status}`);
    return res.data;
  }

  /** The profile name, or the login when there is none or the read fails. */
  async function displayName(login) {
    if (!login) return undefined;
    if (!names.has(login)) {
      const res = await ghRequest({ token, fetchImpl, path: `/users/${encodeURIComponent(login)}`, retry: true, retryOptions });
      const name = res.ok && typeof res.data?.name === "string" ? res.data.name.trim() : "";
      names.set(login, clip(name || login, ACTOR_MAX));
    }
    return names.get(login);
  }

  /** Who last added `in-progress` to an issue, or its first assignee. */
  async function startedBy(issue) {
    const events = await get(`/repos/${repo}/issues/${issue.number}/events?per_page=100`);
    const labeled = (Array.isArray(events) ? events : [])
      .filter((event) => event.event === "labeled" && event.label?.name === IN_PROGRESS_LABEL && !isBot(event.actor))
      .at(-1);
    return labeled?.actor?.login ?? issue.assignees?.[0]?.login;
  }

  /** Open issues (not pull requests) carrying `in-progress`, machinery excluded. */
  async function inProgressIssues() {
    const issues = await get(`/repos/${repo}/issues?state=open&labels=${IN_PROGRESS_LABEL}&per_page=100`);
    return (Array.isArray(issues) ? issues : []).filter((issue) => !issue.pull_request && !isSkipped(issue));
  }

  return { get, displayName, startedBy, inProgressIssues };
}

async function issueItem(gh, issue) {
  const item = { number: issue.number, title: clip(issue.title, TITLE_MAX) };
  const actor = await gh.displayName(await gh.startedBy(issue));
  if (actor) item.actor = actor;
  const areas = areasOf(issue);
  if (areas.length > 0) item.areas = areas;
  return item;
}

/** `{ payload }` to post, or `{ skip: reason }`. */
export async function buildWorkStarted({ event, gh }) {
  const issue = event?.issue;
  if (!issue || event.label?.name !== IN_PROGRESS_LABEL) return { skip: "not an in-progress label event" };
  if (issue.pull_request) return { skip: "a pull request, not an issue" };
  if (isSkipped(issue)) return { skip: "a routine-state or incident issue" };
  if (isBot(event.sender)) return { skip: "labelled by a bot" };

  const areas = areasOf(issue);
  const payload = {
    event: "work_started",
    number: issue.number,
    title: clip(issue.title, TITLE_MAX),
    actor: await gh.displayName(event.sender.login),
  };
  if (areas.length > 0) {
    payload.areas = areas;
    // Who is already in the same area: the reason this post helps with merge
    // conflicts. Area labels are as fine as the tracker knows.
    const others = (await gh.inProgressIssues())
      .filter((other) => other.number !== issue.number && areasOf(other).some((area) => areas.includes(area)))
      .slice(0, ALSO_IN_AREA_MAX);
    if (others.length > 0) {
      payload.also_in_area = [];
      for (const other of others) payload.also_in_area.push(await issueItem(gh, other));
    }
  }
  return { payload };
}

export async function buildPrMerged({ sha, repo, gh }) {
  const pulls = await gh.get(`/repos/${repo}/commits/${sha}/pulls?per_page=100`);
  const pr = (Array.isArray(pulls) ? pulls : []).find((pull) => pull.merged_at && pull.merge_commit_sha === sha);
  if (!pr) return { skip: "no merged pull request for this commit" };
  if (isBot(pr.user)) return { skip: "a bot's pull request" };
  if (isSkipped(pr)) return { skip: "a routine-state or incident pull request" };
  return {
    payload: {
      event: "pr_merged",
      number: pr.number,
      title: clip(pr.title, TITLE_MAX),
      actor: await gh.displayName(pr.user.login),
    },
  };
}

export async function buildDailySummary({ repo, gh, now = new Date() }) {
  const since = new Date(now.getTime() - DAY_MS).toISOString().slice(0, 19) + "Z";
  const query = encodeURIComponent(`repo:${repo} is:pr is:merged base:main merged:>=${since}`);
  // Counts per person, not a list: each merge already has its own post.
  const counts = new Map();
  let total = 0;
  for (let page = 1; page <= SEARCH_PAGES_MAX; page += 1) {
    const found = await gh.get(`/search/issues?q=${query}&per_page=100&page=${page}`);
    const items = found?.items ?? [];
    for (const pr of items) {
      if (isBot(pr.user) || isSkipped(pr)) continue;
      total += 1;
      counts.set(pr.user.login, (counts.get(pr.user.login) ?? 0) + 1);
    }
    if (items.length < 100) break;
  }
  const mergedBy = [];
  for (const [login, count] of [...counts].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).slice(0, MERGED_BY_MAX)) {
    mergedBy.push({ actor: await gh.displayName(login), count });
  }

  const inProgress = [];
  for (const issue of (await gh.inProgressIssues()).slice(0, SUMMARY_ITEMS_MAX)) {
    inProgress.push(await issueItem(gh, issue));
  }

  if (total === 0 && inProgress.length === 0) return { skip: "nothing merged and nothing in progress" };
  return {
    payload: {
      event: "daily_summary",
      date: now.toISOString().slice(0, 10),
      merged_total: total,
      merged_by: mergedBy,
      in_progress: inProgress,
    },
  };
}

export async function buildUpdatePushed({ runId, repo, gh }) {
  if (!/^[1-9]\d*$/.test(String(runId ?? ""))) return { skip: "no Deploy production run id" };
  const found = await gh.get(`/repos/${repo}/actions/runs/${runId}/jobs?filter=latest&per_page=100`);
  const succeeded = (name) =>
    (found?.jobs ?? []).some((job) => job.conclusion === "success" && String(job.name ?? "").includes(name));
  if (!succeeded(SHIPPED_JOB)) return { skip: "that run did not ship an update" };
  const payload = { event: "update_pushed", run_id: String(runId) };
  if (succeeded(STORE_BUILD_JOB)) payload.store_build = true;
  if (succeeded(OTA_UPDATE_JOB)) payload.ota_update = true;
  return { payload };
}

/** Sends one post. Returns the API's `status`; throws on anything but 200. */
export async function postDevLog({ apiUrl, token, payload, fetchImpl = fetch, retryOptions = {} }) {
  const response = await fetchWithRetry(
    `${apiUrl.replace(/\/+$/, "")}/v1/integrations/dev-log`,
    {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    },
    // Safe to re-send: the API keys each event and drops a repeat.
    { fetchImpl, retryMethods: new Set(["POST"]), ...retryOptions },
  );
  const text = await response.text();
  if (response.status !== 200) {
    // The body is the API's validation message or error code, never the token.
    throw new Error(`Dev log post failed: HTTP ${response.status} ${text.slice(0, 500)}`);
  }
  try {
    return JSON.parse(text).status;
  } catch {
    return "posted";
  }
}

export async function main({ env = process.env, fetchImpl = fetch, log = console.log, now = new Date(), retryOptions } = {}) {
  const kind = env.DEV_LOG_EVENT;
  const token = env.DEV_LOG_TOKEN;
  if (!token) {
    log("::notice::DEV_LOG_TOKEN is not set in the automation environment, so nothing was posted to the Dev log.");
    return 0;
  }

  const repo = env.GITHUB_REPOSITORY;
  const gh = createGitHub({ token: env.GITHUB_TOKEN, repo, fetchImpl, retryOptions });

  let built;
  if (kind === "work_started") {
    built = await buildWorkStarted({ event: JSON.parse(readFileSync(env.GITHUB_EVENT_PATH, "utf8")), gh });
  } else if (kind === "pr_merged") {
    built = await buildPrMerged({ sha: env.GITHUB_SHA, repo, gh });
  } else if (kind === "daily_summary") {
    built = await buildDailySummary({ repo, gh, now });
  } else if (kind === "update_pushed") {
    built = await buildUpdatePushed({ runId: env.WORKFLOW_RUN_ID, repo, gh });
  } else {
    throw new Error(`Unknown DEV_LOG_EVENT: ${kind}`);
  }

  if (built.skip) {
    log(`Dev log: skipped (${built.skip}).`);
    return 0;
  }
  const status = await postDevLog({
    apiUrl: env.DEV_LOG_API_URL || DEFAULT_API_URL,
    token,
    payload: built.payload,
    fetchImpl,
    retryOptions,
  });
  log(`Dev log: ${kind} ${status}.`);
  return 0;
}

if (isInvokedDirectly(import.meta.url)) {
  requireEnv("DEV_LOG_EVENT");
  main().then(
    (code) => process.exit(code),
    (error) => {
      console.error(`::error::${error.message}`);
      process.exit(1);
    },
  );
}
