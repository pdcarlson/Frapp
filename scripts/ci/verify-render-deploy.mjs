#!/usr/bin/env node
// Polls the Render deploy-list API until a deploy matching the commit
// (DEPLOY_SHA, else GITHUB_SHA) reaches a terminal state. Fails on
// build_failed / update_failed / pre_deploy_failed, on "no deploy for this SHA
// after the grace window" (autoDeploy wiring red flag), and on a Render read
// that is permanently refused (401/403/404) or fails on
// RENDER_MAX_CONSECUTIVE_READ_ERRORS polls in a row. Treats `canceled` /
// `deactivated` as neutral (superseded by a newer deploy).
//
// Env inputs:
//   RENDER_API_KEY     — required
//   RENDER_SERVICE_ID  — required
//   DEPLOY_SHA         — the commit to verify. Set this one: a step-level
//                        `GITHUB_SHA:` is ignored (reserved prefix; see main())
//   GITHUB_SHA         — the fallback when DEPLOY_SHA is unset (Actions sets it)
//   SERVICE_LABEL      — optional, used only for logs
//   GITHUB_OUTPUT      — set by Actions; receives the step output `outcome`
//
// Exits 0 on success/neutral, 1 on terminal failure or overall timeout.
//
// The exit code cannot tell success from neutral, so the verdict is also
// published as the step output `outcome` (see `writeOutcomeOutput`).

import { appendFileSync } from "node:fs";

import { resilientFetch } from "./lib/http.mjs";
import { createClock, pollUntilTerminal } from "./lib/polling.mjs";
import { findRenderDeployBySha } from "./lib/providers.mjs";
import { requireEnv } from "./lib/env.mjs";

// ── State semantics ─────────────────────────────────────────────────────────
// Any of these means the deploy we were watching is now the running deploy
// (or, in the neutral case, was superseded by a newer one that will be picked
// up on the next push).
export const RENDER_TERMINAL_SUCCESS_STATES = new Set(["live"]);
export const RENDER_TERMINAL_FAILURE_STATES = new Set([
  "build_failed",
  "update_failed",
  "pre_deploy_failed",
]);
export const RENDER_NEUTRAL_TERMINAL_STATES = new Set([
  // Render uses "canceled" when a newer deploy replaces this one before it
  // finishes, and "deactivated" when a newer deploy replaced a previously
  // live one. Neither is a user-visible failure.
  "canceled",
  "deactivated",
]);

// ── Timing (named constants, no magic numbers) ──────────────────────────────
export const RENDER_NO_DEPLOY_GRACE_MS = 5 * 60 * 1000;
export const RENDER_POLL_INTERVAL_MS = 20 * 1000;
export const RENDER_OVERALL_TIMEOUT_MS = 20 * 60 * 1000;

// ── Read errors ─────────────────────────────────────────────────────────────
// Since #2431 a failure verdict files a P1 alert, so one bad read must not be
// one. `resilientFetch` re-sends a 429, a 5xx or a connection failure within a
// read, for a few seconds; what outlasts that, or fails after the headers (a
// body that resets or stalls, which it never retries), is re-asked on the next
// poll instead. Only this many failed reads IN A ROW end the run, about a
// minute of Render being unreadable at the default interval.
export const RENDER_MAX_CONSECUTIVE_READ_ERRORS = 3;

/** A 4xx other than 429 means a dead key or a wrong id: re-asking can't help. */
export function isPermanentReadError(error) {
  const status = error?.status;
  return typeof status === "number" && status >= 400 && status < 500 && status !== 429;
}

/**
 * Pure verifier. Returns `{ status, message }` where status is one of
 * "success" | "failure" | "neutral". The CLI wrapper translates that to an
 * exit code; tests assert on the return value directly.
 */
export async function verifyRenderDeploy({
  apiKey,
  serviceId,
  sha,
  label = serviceId,
  clock = createClock(),
  // Retrying, not bare `fetch`: the first layer of "one bad read is not a
  // verdict". The second is `classify` re-asking on the next poll; see
  // RENDER_MAX_CONSECUTIVE_READ_ERRORS.
  fetchImpl = resilientFetch,
  pollIntervalMs = RENDER_POLL_INTERVAL_MS,
  noDeployGraceMs = RENDER_NO_DEPLOY_GRACE_MS,
  overallTimeoutMs = RENDER_OVERALL_TIMEOUT_MS,
  maxConsecutiveReadErrors = RENDER_MAX_CONSECUTIVE_READ_ERRORS,
  logger = console,
}) {
  let lastObservedStatus = null;
  // Failed reads since the last good one, and the latest one's message.
  let readErrors = 0;
  let lastReadError = null;

  return pollUntilTerminal({
    clock,
    pollIntervalMs,
    overallTimeoutMs,
    logger,
    fetchOne: async () => {
      try {
        const { match, pagesSearched, oldestSeenMs, exhausted } = await findRenderDeployBySha({
          apiKey,
          serviceId,
          sha,
          fetchImpl,
        });
        return { match, pagesSearched, oldestSeenMs, exhausted };
      } catch (error) {
        return { error };
      }
    },
    classify: (state, { elapsedMs }) => {
      if (state.error) {
        readErrors += 1;
        lastReadError = state.error.message;
        if (isPermanentReadError(state.error) || readErrors >= maxConsecutiveReadErrors) {
          const repeated = readErrors > 1 ? ` (${readErrors} failed reads in a row)` : "";
          return {
            status: "failure",
            message: `Render API error for ${label}: ${state.error.message}${repeated}`,
          };
        }
        logger.log?.(
          `[${label}] Render API read failed (${state.error.message}); re-asking on the next poll ` +
            `(${readErrors}/${maxConsecutiveReadErrors}).`,
        );
        return null;
      }
      readErrors = 0;

      if (!state.match) {
        if (elapsedMs >= noDeployGraceMs) {
          const { pagesSearched, oldestSeenMs, exhausted } = state;
          const cutoff = oldestSeenMs != null ? new Date(oldestSeenMs).toISOString() : "the start";
          const searchNote = exhausted
            ? `searched all ${pagesSearched} page(s) of Render's deploy history for this service, ` +
              `back to ${cutoff}`
            : `searched ${pagesSearched} page(s) back to ${cutoff} — older deploys may still exist ` +
              `beyond that`;
          return {
            status: "failure",
            message:
              `No Render deploy created for ${sha} on ${label} within ` +
              `${Math.round(noDeployGraceMs / 1000)}s (${searchNote}). ` +
              `Check that Render autoDeploy is enabled and pointed at the correct branch.`,
          };
        }
        logger.log?.(`[${label}] Waiting for Render to create a deploy for ${sha}...`);
        return null;
      }

      const status = state.match.deploy.status;
      lastObservedStatus = status;

      if (RENDER_TERMINAL_SUCCESS_STATES.has(status)) {
        return {
          status: "success",
          message: `Render deploy ${state.match.deploy.id} for ${label} is ${status}.`,
        };
      }

      if (RENDER_TERMINAL_FAILURE_STATES.has(status)) {
        return {
          status: "failure",
          message: `Render deploy ${state.match.deploy.id} for ${label} ended in ${status}.`,
        };
      }

      if (RENDER_NEUTRAL_TERMINAL_STATES.has(status)) {
        return {
          status: "neutral",
          message:
            `Render deploy ${state.match.deploy.id} for ${label} was superseded (${status}); ` +
            `treating as neutral.`,
        };
      }

      logger.log?.(`[${label}] Render deploy ${state.match.deploy.id} is ${status}...`);
      return null;
    },
    onTimeout: () => ({
      status: "failure",
      message:
        `Timed out after ${Math.round(overallTimeoutMs / 1000)}s waiting for ` +
        `Render deploy on ${label}. Last observed status: ${lastObservedStatus ?? "none"}.` +
        (readErrors > 0 ? ` Last Render read failed: ${lastReadError}.` : ""),
    }),
  });
}

// ── Step output ─────────────────────────────────────────────────────────────

/** Every verdict `verifyRenderDeploy` can return. */
export const VERIFY_OUTCOMES = new Set(["success", "neutral", "failure"]);

/**
 * Appends `outcome=<status>` to `$GITHUB_OUTPUT`, for `verify-deployments.yml`'s
 * `deploy-outcome` job (#2431). That job closes the staging deploy alert, and
 * it must close it only on `success`: `neutral` also exits 0, but a superseded
 * deploy proves nothing about whether deploys work, so the exit code alone
 * would read a cancel mid-outage as a recovery.
 *
 * Only the closed-set status is written, never `message`, which can carry a
 * provider's error text. The output leaves this job: `deploy-alert.mjs`
 * classifies on it and prints it in the `deploy-outcome` step summary. A closed
 * set keeps anything a provider said confined to this job's own log.
 *
 * A no-op outside Actions (no `GITHUB_OUTPUT`). Throws on a status outside the
 * set rather than publishing it: the reader matches exact strings, so an
 * unknown value would silently read as "not confirmed".
 */
export function writeOutcomeOutput(
  status,
  { outputPath = process.env.GITHUB_OUTPUT, append = appendFileSync } = {},
) {
  if (!VERIFY_OUTCOMES.has(status)) {
    throw new Error(`Unknown verify outcome ${JSON.stringify(status)}`);
  }
  if (!outputPath) return;
  append(outputPath, `outcome=${status}\n`);
}

// ── CLI entry ───────────────────────────────────────────────────────────────

async function main() {
  const apiKey = requireEnv("RENDER_API_KEY");
  const serviceId = requireEnv("RENDER_SERVICE_ID");
  // DEPLOY_SHA wins over GITHUB_SHA so a `workflow_dispatch` caller can name the
  // commit it is deploying. `github.sha` on a dispatch is the tip of the ref the
  // workflow was dispatched on, which is NOT the commit being shipped — and
  // overriding GITHUB_SHA in a step-level `env:` collides with GitHub's reserved
  // prefix rule, so it reads correct and is undefined. An explicit variable does
  // not have that problem.
  const sha = process.env.DEPLOY_SHA || requireEnv("GITHUB_SHA");
  const label = process.env.SERVICE_LABEL ?? serviceId;

  const result = await verifyRenderDeploy({ apiKey, serviceId, sha, label });
  writeOutcomeOutput(result.status);

  if (result.status === "success") {
    console.log(`✅ ${result.message}`);
    process.exit(0);
  }
  if (result.status === "neutral") {
    console.log(`⚪ ${result.message}`);
    process.exit(0);
  }
  console.error(`❌ ${result.message}`);
  process.exit(1);
}

const invokedDirectly = import.meta.url === `file://${process.argv[1]}`;
if (invokedDirectly) {
  main().catch((error) => {
    console.error(`Unhandled error: ${error.stack ?? error.message}`);
    process.exit(1);
  });
}
