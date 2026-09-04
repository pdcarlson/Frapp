#!/usr/bin/env node

// Build one named commit and ship it to Vercel — for web and landing, to
// either the production or the staging (preview) channel — then watch the
// deployments it created.
//
// Replaces `deploy-vercel-production.mjs` (#1578). That file created a
// deployment by POSTing `gitSource: {repoId, ref, sha}`, which asks Vercel to
// fetch the commit from GitHub itself. ADR-21 removed the Git integration, so
// there is nothing left to fetch it: the argument is inert and the call cannot
// work. CI now produces the build itself and uploads it — see the header of
// `lib/vercel-cli.mjs` for the CLI mechanics and why the token travels in the
// environment rather than in argv.
//
// This file is target-parameterised where the old one was production-only,
// because after ADR-21 *both* channels are CI's job. Staging used to be a
// side effect of the Git integration (a push to `main` produced a preview);
// nothing produces one now, so the same build-and-upload path serves both. The
// only differences are which environment's variables the build compiles
// against and whether the deployment takes production traffic — both carried by
// `target`, so the two channels cannot drift apart into two implementations.
//
// ── Why a fresh build and not `promote` ────────────────────────────────────
// Vercel's `POST /v10/projects/{id}/promote/{deploymentId}` re-points production
// traffic at an existing deployment WITHOUT rebuilding it, and `NEXT_PUBLIC_*`
// values are inlined at build time — the Infisical syncs are split Production /
// Preview (see SECRETS_MANAGEMENT.md), so a staging build carries the staging
// API URL and the staging Supabase keys. Promoting one would put the production
// dashboard on staging infrastructure while every status page said "deployed".
// `apps/web/lib/sentry/options.ts` derives its environment tag from `VERCEL_ENV`
// at build time too, so a promoted preview would also tag production errors
// `preview` forever.
//
// `vercel pull --environment=production` + `vercel build --prod` is the
// equivalent of the old `target: "production"` create call: it compiles the
// commit against Production env vars. The guard on the returned deployment's
// `target` below is what proves it actually did.
//
// ── Why `CANCELED` is a FAILURE here ───────────────────────────────────────
// This is the subtle one, and it is the reason this file exists rather than a
// second call to `verify-vercel-deploy.mjs`.
//
// That verifier calls `CANCELED` neutral when a LATER deployment on the same
// branch overtook it — the signature of Vercel auto-cancelling a build that a
// newer push superseded. That test cannot hold here, in either channel:
//
//   * Production deploys run from `main`, which has many deployments, so a
//     "was it overtaken" test is always true and every cancelled production
//     build would read as a neutral no-op — green, forever, having shipped
//     nothing. That is not hypothetical: it is exactly what run 33275321347
//     did, back when `ignoreCommand` ran `npx turbo-ignore`.
//   * A deployment CI created from prebuilt output cannot be superseded at all.
//     There is no push behind it for a newer push to cancel; the upload either
//     lands or it does not.
//
// So on this path a cancel is a failure, always. A skipped release is a fact to
// report, not a state to infer a no-op from.
//
// Env inputs:
//   VERCEL_API_KEY            — required (used as the CLI's VERCEL_TOKEN)
//   VERCEL_TEAM_ID            — required (used as the CLI's VERCEL_ORG_ID)
//   VERCEL_WEB_PROJECT_ID     — required
//   VERCEL_LANDING_PROJECT_ID — required
//   DEPLOY_SHA                — required, the commit being shipped
//   DEPLOY_TARGET             — optional, `production` (default) or `preview`
//   DEPLOY_REF                — optional, the BRANCH stamped as
//                               `meta.githubCommitRef` (default `main`). Both
//                               current callers deploy `main` and leave it
//                               unset; `wasSupersededByLaterDeployment` scopes
//                               supersession on this field, so a caller
//                               deploying some other branch must set it
//
// Semantics: the pure functions below. Unit tests:
// `scripts/ci/__tests__/deploy-vercel.test.mjs`.

import { createClock, pollUntilTerminal } from "./lib/polling.mjs";
import {
  VERCEL_NEUTRAL_TERMINAL_STATES,
  VERCEL_OVERALL_TIMEOUT_MS,
  VERCEL_POLL_INTERVAL_MS,
  VERCEL_TERMINAL_FAILURE_STATES,
  VERCEL_TERMINAL_SUCCESS_STATES,
} from "./verify-vercel-deploy.mjs";
import {
  VERCEL_TARGET_PREVIEW,
  VERCEL_TARGET_PRODUCTION,
  buildAndDeployVercelProject,
} from "./lib/vercel-cli.mjs";
import { requireEnv } from "./lib/env.mjs";
import { resilientFetch } from "./lib/http.mjs";

// Imported from the observer rather than re-declared, and re-exported so this
// file's own callers still see them. They were duplicated here with a comment
// claiming this path needed "longer than the observer's 15 minutes" — which had
// stopped being true: the observer was itself raised to 30 minutes, and its
// comment now reads "matching the production deploy path". Two files asserting
// opposite facts about each other's budgets is how someone tuning one of them
// silently breaks the other, so there is now one number.
//
// Imported AND re-exported, not `export … from`: a bare re-export does not bind
// the names in this module's scope, and the poll defaults below reference them.
export { VERCEL_POLL_INTERVAL_MS, VERCEL_OVERALL_TIMEOUT_MS };

const GET_DEPLOYMENT_URL = (deploymentId, teamId) =>
  `https://api.vercel.com/v13/deployments/${deploymentId}${teamId ? `?teamId=${teamId}` : ""}`;

function deploymentState(deployment) {
  return deployment?.state ?? deployment?.readyState;
}

/**
 * Classify a Vercel deployment state for the STRICT CI-created path. Unlike
 * the observer there is no neutral outcome — see the header on CANCELED.
 */
export function classifyVercelState(state) {
  if (VERCEL_TERMINAL_SUCCESS_STATES.has(state)) return "success";
  if (VERCEL_TERMINAL_FAILURE_STATES.has(state)) return "failure";
  if (VERCEL_NEUTRAL_TERMINAL_STATES.has(state)) return "failure";
  return "pending";
}

/**
 * What Vercel should report as a deployment's `target` for a given deploy.
 *
 * Vercel reports `null`, not `"preview"`, for a preview deployment — the field
 * names the production channel or nothing. Writing that out here rather than
 * inline keeps the assertion below honest about it; comparing against the
 * string `"preview"` would fail every staging deploy.
 */
export function expectedDeploymentTarget(target) {
  return target === VERCEL_TARGET_PRODUCTION ? "production" : null;
}

/**
 * Look one deployment up by the hostname the CLI printed.
 *
 * `GET /v13/deployments/{idOrUrl}` accepts a hostname, which is what
 * `vercel deploy` gives us. Resolving it to an id immediately is worth the one
 * extra call: the id is what the poll loop, the run log and
 * `ensure-vercel-staging-alias.mjs` all key on, and a hostname is not stable
 * vocabulary for any of them.
 */
export async function resolveDeploymentByHost({
  apiKey,
  host,
  teamId,
  label = host,
  fetchImpl = resilientFetch,
}) {
  const response = await fetchImpl(GET_DEPLOYMENT_URL(host, teamId), {
    headers: { Authorization: `Bearer ${apiKey}` },
  });

  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    throw new Error(
      `Vercel could not resolve the deployment at ${host} for ${label} ` +
        `(HTTP ${response.status})${detail ? `: ${detail.slice(0, 400)}` : ""}`,
    );
  }

  const body = await response.json();
  if (!body?.id) {
    throw new Error(
      `Vercel returned no deployment id for ${host} (${label}). Nothing can be verified ` +
        `from here, so this is a failure, not a pass.`,
    );
  }

  return {
    deploymentId: body.id,
    target: body.target ?? null,
    url: body.url ?? null,
    sha: body.meta?.githubCommitSha ?? null,
  };
}

/**
 * Build, upload and identify ONE project's deployment.
 *
 * The `target` assertion is the one that matters. We asked for a production
 * build; if Vercel recorded a preview, traffic would never move and a poll on
 * readyState alone would happily report READY — a release that shipped nothing
 * and said it worked.
 */
export async function createVercelDeployment({
  apiKey,
  projectId,
  label,
  sha,
  ref = "main",
  target,
  teamId,
  cwd,
  runCommand,
  fetchImpl = resilientFetch,
  logger = console,
}) {
  // Everything up to here can fail with NOTHING uploaded. Past it, the
  // deployment exists and — on the production path — is already taking traffic.
  // The distinction is load-bearing for `deployVercel`'s fail-fast, so it is
  // marked on the error rather than left for a caller to guess at: see the
  // `uploaded` flag below.
  const { host } = await buildAndDeployVercelProject({
    target,
    sha,
    ref,
    token: apiKey,
    orgId: teamId,
    projectId,
    label,
    cwd,
    runCommand,
    logger,
  });

  try {
    return await identifyVercelDeployment({
      apiKey,
      host,
      teamId,
      label,
      sha,
      target,
      fetchImpl,
    });
  } catch (error) {
    // The upload already happened, so this project has shipped whatever it
    // shipped. Stopping the run's REMAINING projects on this would create the
    // half-updated environment the fail-fast exists to prevent, in mirror
    // image — web live on the new commit, landing left on the old one.
    error.uploaded = true;
    throw error;
  }
}

/**
 * Resolve and validate the deployment an upload just produced.
 *
 * Split out from `createVercelDeployment` only so the throw-after-upload
 * boundary is a single, obvious `try`. Everything here runs against a
 * deployment that already exists.
 */
async function identifyVercelDeployment({
  apiKey,
  host,
  teamId,
  label,
  sha,
  target,
  fetchImpl = resilientFetch,
}) {
  const resolved = await resolveDeploymentByHost({ apiKey, host, teamId, label, fetchImpl });

  const expected = expectedDeploymentTarget(target);
  if (resolved.target !== expected) {
    throw new Error(
      `Vercel created deployment ${resolved.deploymentId} for ${label} with target ` +
        `'${resolved.target ?? "null"}', not '${expected ?? "null"}'. Refusing to treat it ` +
        `as a ${target} deploy.`,
    );
  }

  // Prove the deployment we resolved is the one we just built, and that the
  // commit metadata landed on it. Two distinct failures are caught here, and
  // the target check above catches neither:
  //
  //   * A WRONG deployment. The id came from a hostname the CLI printed, and
  //     `GET /v13/deployments/{idOrUrl}` resolves an alias to whatever
  //     deployment currently serves it. A stale alias on the production path
  //     resolves to the PREVIOUS release, which is `production` and `READY` —
  //     green, having verified nothing. `parseDeploymentHost` takes the first
  //     URL to avoid that; this is the assertion that would catch it anyway.
  //   * MISSING metadata. If `--meta` is dropped by a CLI upgrade or `sha`
  //     arrives empty, the deploy still succeeds and everything downstream
  //     that reads `githubCommitSha` degrades silently — ADR-19's named-commit
  //     guarantee first among them.
  if (resolved.sha !== sha) {
    throw new Error(
      `Vercel deployment ${resolved.deploymentId} for ${label} reports ` +
        `githubCommitSha '${resolved.sha ?? "null"}', not the commit just built ('${sha}'). ` +
        `Either the deployment metadata did not land or ${host} resolved to a different ` +
        `deployment; refusing to report either as a successful ${target} deploy.`,
    );
  }

  return { deploymentId: resolved.deploymentId, host, url: resolved.url };
}

/** Poll one deployment id to a terminal state. */
export async function pollVercelDeployment({
  apiKey,
  deploymentId,
  teamId,
  label = deploymentId,
  clock = createClock(),
  fetchImpl = resilientFetch,
  pollIntervalMs = VERCEL_POLL_INTERVAL_MS,
  overallTimeoutMs = VERCEL_OVERALL_TIMEOUT_MS,
  logger = console,
}) {
  let lastObservedState = null;

  return pollUntilTerminal({
    clock,
    pollIntervalMs,
    overallTimeoutMs,
    logger,
    fetchOne: async () => {
      // Wrapped, exactly as `verify-vercel-deploy.mjs` wraps its own fetchOne.
      // `pollUntilTerminal` does not catch, so a throw here escapes all the way
      // out of `deployVercel`'s `Promise.all` and rejects it — and the create
      // loop's careful per-project error reporting never runs. Two things
      // throw: `resilientFetch` rethrows after its attempts are exhausted (a
      // DNS blip during a 30-minute poll is ~90 requests' worth of chances),
      // and `response.json()` throws on a non-JSON body such as an HTML error
      // page returned with HTTP 200. Either would turn a release that actually
      // shipped into "Unhandled error", with both deployment ids unprinted and
      // an operator about to re-dispatch a deploy that already succeeded.
      try {
        const response = await fetchImpl(GET_DEPLOYMENT_URL(deploymentId, teamId), {
          headers: { Authorization: `Bearer ${apiKey}` },
        });
        if (!response.ok) {
          return { httpStatus: response.status };
        }
        const deployment = await response.json();
        return { state: deploymentState(deployment) };
      } catch (error) {
        return { error };
      }
    },
    classify: (fetched) => {
      if (fetched.error) {
        return {
          status: "failure",
          message:
            `Vercel API error polling deployment ${deploymentId} (${label}): ` +
            `${fetched.error.message}`,
        };
      }
      if (fetched.httpStatus) {
        return {
          status: "failure",
          message: `Vercel API returned HTTP ${fetched.httpStatus} for deployment ${deploymentId} (${label}).`,
        };
      }

      const state = fetched.state;
      lastObservedState = state;

      const verdict = classifyVercelState(state);
      if (verdict === "success") {
        return {
          status: "success",
          message: `Vercel deployment ${deploymentId} for ${label} is ${state}.`,
        };
      }
      if (verdict === "failure") {
        const cancelled = VERCEL_NEUTRAL_TERMINAL_STATES.has(state);
        return {
          status: "failure",
          message: cancelled
            ? `Vercel deployment ${deploymentId} for ${label} was ${state}. On a CI-created ` +
              `deployment a cancel is never a no-op — the build was produced on the runner and ` +
              `uploaded, so nothing could have superseded it. Nothing was shipped.`
            : `Vercel deployment ${deploymentId} for ${label} ended in ${state}.`,
        };
      }

      logger.log?.(`[${label}] Vercel deployment ${deploymentId} is ${state}...`);
      return null;
    },
    onTimeout: () => ({
      status: "failure",
      message:
        `Timed out after ${Math.round(overallTimeoutMs / 1000)}s waiting for Vercel deployment ` +
        `${deploymentId} (${label}). Last observed state: ${lastObservedState ?? "none"}.`,
    }),
  });
}

/**
 * Deploy every project, then poll them together.
 *
 * The builds are SEQUENTIAL where the old create-by-gitSource path fired both
 * requests up front. That is not a regression, it is forced: `vercel build`
 * writes `.vercel/output` in the working tree, so two concurrent builds in one
 * checkout would overwrite each other's output and each could upload the
 * other's bundle. The wall-clock cost is real and is the price of building on
 * the runner; the correctness of shipping web's build to the web project is not
 * negotiable against it.
 *
 * Polling still happens together, after both uploads, because that half has no
 * shared state.
 *
 * @param {{projects: Array<{projectId: string, label: string}>}} input
 */
export async function deployVercel({
  apiKey,
  projects,
  sha,
  ref = "main",
  target = VERCEL_TARGET_PRODUCTION,
  teamId,
  cwd,
  runCommand,
  clock = createClock(),
  fetchImpl = resilientFetch,
  pollIntervalMs = VERCEL_POLL_INTERVAL_MS,
  overallTimeoutMs = VERCEL_OVERALL_TIMEOUT_MS,
  logger = console,
}) {
  const created = [];
  let aborted = null;
  for (const project of projects) {
    // Stop at the first failure that shipped NOTHING, instead of deploying the
    // rest. The builds are sequential, so when web's build fails landing has not
    // been uploaded yet — and uploading it would put the new landing live on
    // `frapp.live` while `app.frapp.live` stays on the previous release. A
    // half-shipped production release, behind an already-applied migration, is
    // strictly worse than one that stopped: the overall result is a failure
    // either way, so the only question is how much of production moved before
    // we admitted it.
    //
    // A failure AFTER the upload is the opposite case and must not abort. The
    // deployment already exists and is already taking traffic, so stopping the
    // remaining projects would create exactly the split described above, in
    // mirror image. `createVercelDeployment` marks those errors `uploaded`.
    //
    // The skipped projects are still REPORTED, as failures with a reason. A
    // project that silently vanishes from the results is how "we deployed" and
    // "we deployed everything" come apart.
    if (aborted) {
      created.push({
        project,
        deploymentId: null,
        error:
          `Not attempted: ${aborted} failed earlier in this run, and shipping only some ` +
          `projects would leave a half-updated environment.`,
      });
      continue;
    }
    try {
      const result = await createVercelDeployment({
        apiKey,
        projectId: project.projectId,
        label: project.label,
        sha,
        ref,
        target,
        teamId,
        cwd,
        runCommand,
        fetchImpl,
        logger,
      });
      logger.log?.(
        `[${project.label}] Created Vercel ${target} deployment ${result.deploymentId} for ${sha}.`,
      );
      created.push({ project, ...result });
    } catch (error) {
      created.push({ project, deploymentId: null, error: error.message });
      if (!error.uploaded) aborted = project.label;
    }
  }

  const results = await Promise.all(
    created.map(async (entry) => {
      if (!entry.deploymentId) {
        return {
          label: entry.project.label,
          status: "failure",
          message: entry.error,
          deploymentId: null,
        };
      }
      const polled = await pollVercelDeployment({
        apiKey,
        deploymentId: entry.deploymentId,
        teamId,
        label: entry.project.label,
        clock,
        fetchImpl,
        pollIntervalMs,
        overallTimeoutMs,
        logger,
      });
      return { label: entry.project.label, deploymentId: entry.deploymentId, ...polled };
    }),
  );

  // Every project must land. A green web and a failed landing is a failed
  // deploy, not a partial success to be reported cheerfully.
  const failures = results.filter((r) => r.status !== "success");
  return { ok: failures.length === 0, results, failures };
}

/**
 * Read and validate `DEPLOY_TARGET`.
 *
 * An unrecognised value is a hard error rather than a default. Defaulting an
 * unknown target to preview would silently turn a production release into a
 * staging one; defaulting it to production would do something far worse. The
 * empty case is the only one that means "unset", and it means production —
 * matching the file this replaced, which had no target input at all.
 */
export function parseDeployTarget(raw) {
  if (!raw) return VERCEL_TARGET_PRODUCTION;
  if (raw === VERCEL_TARGET_PRODUCTION) return VERCEL_TARGET_PRODUCTION;
  if (raw === VERCEL_TARGET_PREVIEW) return VERCEL_TARGET_PREVIEW;
  throw new Error(
    `DEPLOY_TARGET must be '${VERCEL_TARGET_PRODUCTION}' or '${VERCEL_TARGET_PREVIEW}', ` +
      `got '${raw}'. Refusing to guess which channel to ship to.`,
  );
}

// ── CLI entry ───────────────────────────────────────────────────────────────

async function main() {
  const target = parseDeployTarget(process.env.DEPLOY_TARGET);

  const projects = [
    { projectId: requireEnv("VERCEL_WEB_PROJECT_ID"), label: "frapp-web" },
    { projectId: requireEnv("VERCEL_LANDING_PROJECT_ID"), label: "frapp-landing" },
  ];

  const outcome = await deployVercel({
    apiKey: requireEnv("VERCEL_API_KEY"),
    projects,
    sha: requireEnv("DEPLOY_SHA"),
    ref: process.env.DEPLOY_REF || "main",
    target,
    teamId: requireEnv("VERCEL_TEAM_ID"),
  });

  for (const result of outcome.results) {
    if (result.deploymentId) console.log(`vercel_deployment_id[${result.label}]=${result.deploymentId}`);
    if (result.status === "success") console.log(`✅ ${result.message}`);
    // `%0A` because a `::error::` annotation stops at the first newline, and
    // these messages carry a multi-line stderr tail from the CLI — the useful
    // part starts exactly where an unescaped annotation would truncate.
    else console.error(`::error::${String(result.message).replaceAll("\n", "%0A")}`);
  }

  // `process.exitCode`, not `process.exit()`. Writes to stdout/stderr are
  // asynchronous when they are pipes, which is what a runner attaches, so
  // exiting on the line after the loop can drop the annotations it just
  // queued — a red job with nothing saying why.
  process.exitCode = outcome.ok ? 0 : 1;
}

const invokedDirectly = import.meta.url === `file://${process.argv[1]}`;
if (invokedDirectly) {
  main().catch((error) => {
    console.error(`::error::${String(error.stack ?? error.message).replaceAll("\n", "%0A")}`);
    process.exitCode = 1;
  });
}
