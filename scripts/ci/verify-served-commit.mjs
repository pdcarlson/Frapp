#!/usr/bin/env node

// Prove the API at API_HEALTHCHECK_URL is serving ONE named commit and is
// ready, after a deploy of that commit took traffic (#2505).
//
// ── Why the deploy's own word is not enough ─────────────────────────────────
// The deploy moving traffic to a revision says the platform sent requests to
// it, not what the public address answers: a load balancer, a DNS record or a
// cache in front can still answer from somewhere else. The old smoke loop
// could not tell instances apart either: it polled `/health/ready` until any
// 2xx, and during a switchover the OLD instance answers that just as happily.
// So a staging deploy that never took over could still pass. (Until #5228
// this was Render's `live`, which meant only that the new instance passed
// `GET /health`.)
//
// `/health/ready` carries `commit` (`RENDER_GIT_COMMIT`, which the Cloud Run
// deploy sets on every revision under the name the API has always read, see
// `apps/api/src/infrastructure/observability/deployed-commit.ts`), so one loop
// asks both questions at once: is this response from the commit we deployed,
// and is it ready? It succeeds only on a 2xx whose `commit` equals DEPLOY_SHA.
//
// ── What each non-answer means ──────────────────────────────────────────────
// Every observation short of that keeps polling until the deadline, because
// each one is normal for a moment after the switch: the old instance still
// answering, the new one 503ing while a dependency warms, a free-plan cold
// start dropping the connection. Only the deadline is a verdict, and its
// message names the last thing seen, so the log says which it was.
//
// A response with no `commit` at all never turns into a pass: every deployed
// revision sets RENDER_GIT_COMMIT, so its absence means the URL is not the
// service this job deployed.
//
// Env inputs:
//   API_HEALTHCHECK_URL — required; the service's `/health` URL, as stored in
//                         Infisical. `/ready` is appended here.
//   DEPLOY_SHA          — required; the full commit SHA that was deployed
//   SERVICE_LABEL       — optional, for logs
//
// Exits 0 when the commit is served and ready, 1 otherwise.
// Unit tests: `scripts/ci/__tests__/verify-served-commit.test.mjs`.

import { requireEnv } from "./lib/env.mjs";
import { resilientFetch } from "./lib/http.mjs";
import { isInvokedDirectly } from "./lib/invoked-directly.mjs";
import { createClock, pollUntilTerminal } from "./lib/polling.mjs";

export const SERVED_COMMIT_POLL_INTERVAL_MS = 10 * 1000;
// The deploy moves traffic before this starts, and the switch shows within
// seconds. The rest of the budget covers readiness and a cold start.
export const SERVED_COMMIT_TIMEOUT_MS = 5 * 60 * 1000;

/** `https://host/health` or `https://host/health/` → `https://host/health/ready`. */
export function readyUrlFor(healthUrl) {
  return `${healthUrl.replace(/\/+$/, "")}/ready`;
}

/** Same commit, ignoring case. The API reports the full lowercase SHA. */
export function isSameCommit(served, sha) {
  return typeof served === "string" && served.toLowerCase() === sha.toLowerCase();
}

/** One observation, as the loop and its messages see it. */
function describe(state) {
  if (state.error) return `request failed (${state.error})`;
  const commit = state.commit ? `commit ${state.commit}` : "no commit field";
  return `HTTP ${state.httpStatus}, ${commit}`;
}

export async function verifyServedCommit({
  healthUrl,
  sha,
  label = "API",
  clock = createClock(),
  fetchImpl = resilientFetch,
  pollIntervalMs = SERVED_COMMIT_POLL_INTERVAL_MS,
  overallTimeoutMs = SERVED_COMMIT_TIMEOUT_MS,
  logger = console,
}) {
  const url = readyUrlFor(healthUrl);

  return pollUntilTerminal({
    clock,
    pollIntervalMs,
    overallTimeoutMs,
    logger,
    fetchOne: async () => {
      try {
        const response = await fetchImpl(url, { headers: { Accept: "application/json" } });
        // A 503 body is Nest's error envelope, not the health payload, so a
        // missing or unparsable body is just "no commit".
        const body = await response.json().catch(() => null);
        return { httpStatus: response.status, ok: response.ok, commit: body?.commit ?? null };
      } catch (error) {
        return { error: error?.message ?? String(error) };
      }
    },
    classify: (state) => {
      if (state.ok && isSameCommit(state.commit, sha)) {
        return { status: "success", message: `${label} is serving ${sha} and ready (${url}).` };
      }
      logger.log?.(`[${label}] Waiting for ${sha.slice(0, 12)} at ${url}: ${describe(state)}.`);
      return null;
    },
    onTimeout: (lastState) => ({
      status: "failure",
      message:
        `${label} did not serve ${sha} as ready within ${Math.round(overallTimeoutMs / 1000)}s. ` +
        `Last observation at ${url}: ${lastState ? describe(lastState) : "none"}. ` +
        `An older commit there means the new deploy never took traffic; a 503 means it did but ` +
        `a dependency is down; no commit field means this URL is not the service this job deployed.`,
    }),
  });
}

// ── CLI entry ───────────────────────────────────────────────────────────────

async function main() {
  const healthUrl = requireEnv("API_HEALTHCHECK_URL", {
    hint:
      "It comes from Infisical (docs/internal/environment/SECRETS_MANAGEMENT.md). A deploy is not " +
      "called healthy without checking it.",
  });
  const result = await verifyServedCommit({
    healthUrl,
    sha: requireEnv("DEPLOY_SHA"),
    label: process.env.SERVICE_LABEL ?? "API",
  });

  if (result.status === "success") {
    console.log(`✅ ${result.message}`);
    process.exit(0);
  }
  console.error(`::error::${result.message}`);
  process.exit(1);
}

if (isInvokedDirectly(import.meta.url)) {
  main().catch((error) => {
    console.error(`Unhandled error: ${error.stack ?? error.message}`);
    process.exit(1);
  });
}
